import { Injectable } from '@nestjs/common';
import { addSeconds } from 'date-fns';
import { Prisma, RunTrace } from '../generated/prisma/client';
import {
  PolicyDecisionSource,
  RunBudgetClass,
  RunOrigin,
  RunStatus,
} from '../generated/prisma/enums';
import { isUniqueViolation } from '../platform/db/prisma-errors';
import { PrismaService } from '../platform/db/prisma.service';
import { storedJson } from '../platform/db/stored-json';
import { EffectsReport, RefusedCall } from './run-effects';
import { RunObservation, RunReport, RunResult } from './run-outcome';
import { pageOf, TriggerEnvelope } from './trigger-envelope';

/** An admission request. There is no run yet, only what the run will come with. */
export interface Admission {
  readonly envelope: TriggerEnvelope;
  readonly origin: RunOrigin;
  readonly originId?: string;
  readonly budgetClass: RunBudgetClass;
  /** How many runs are allowed at once. There are as many slots. */
  readonly concurrency: number;
  /** How long the ticket stays valid if the run has not reported. */
  readonly ticketSeconds: number;
}

/** The ticket of an admitted run: the id it runs under and the time until which it is valid. */
export interface Ticket {
  readonly id: string;
  readonly expiresAt: Date;
}

/**
 * What the trace records about a run that has ended: the runner's outcome together with what the
 * App did with its effects.
 *
 * The split is the same as in `RunOutcome`, with two differences. The status can be stricter than
 * the runner's outcome: a completed run whose effects were not applied is recorded as a failure.
 * And a deferral already includes the time to wait until, not only what the run knew.
 */
export type Conclusion =
  | {
      readonly status: 'completed';
      readonly latencyMs: number;
      readonly report: RunReport;
      readonly observation: RunObservation;
      readonly result: RunResult;
      readonly effects: EffectsReport;
    }
  | {
      readonly status: 'failed';
      readonly latencyMs: number;
      readonly error: string;
      /**
       * A failure solely because Notion is unavailable: a person's snooze, which does not wait
       * (ADR 0045). The breaker does not count it, because what broke is not the run path.
       */
      readonly notionUnavailable?: boolean;
      /**
       * The row waited for Notion longer than the limit, so the failure is an ordinary one, and the
       * breaker sees it (ADR 0045).
       */
      readonly notionHoldExpired?: boolean;
      readonly report?: RunReport;
      readonly observation?: RunObservation;
      readonly result?: RunResult;
      readonly effects?: EffectsReport;
    }
  | {
      readonly status: 'deferred';
      /** The cause is the plan quota (ADR 0012): the run gates for all runs wait until `until`. */
      readonly cause: 'plan_quota';
      readonly latencyMs: number;
      readonly reason: string;
      readonly until: Date;
      readonly report?: RunReport;
      readonly observation?: RunObservation;
      readonly effects?: EffectsReport;
    }
  | {
      readonly status: 'deferred';
      /** The run did not reach Notion (ADR 0045), so only its row waits. */
      readonly cause: 'notion';
      readonly latencyMs: number;
      readonly reason: string;
      readonly report?: RunReport;
      readonly observation?: RunObservation;
      readonly result?: RunResult;
      readonly effects?: EffectsReport;
    };

/**
 * Returns the trace columns that hold the trigger envelope: the envelope itself, a document read
 * only as a whole (`INV-083`), and the run's page, by which the trace is looked up.
 */
export function traceTrigger(envelope: TriggerEnvelope): {
  readonly trigger: Prisma.InputJsonValue;
  readonly pageId: string | null;
} {
  return { trigger: storedJson(envelope.trigger), pageId: pageOf(envelope) };
}

/**
 * The run ledger and the sole writer of the trace: a row for each **launched** run, and at the
 * conclusion the run's snapshot, its lists and the applied effects.
 *
 * A budget denial creates no row: it is not a run, and counting denials as spending would exhaust
 * the limit with the very thing that guards it.
 *
 * All the limits are read from the ledger: the plan quota, the daily limit, the circuit breaker
 * and concurrency. Which fields the trace has, and from which point each is required, is set out
 * in `contracts/canonical.yaml`, key `run_trace_fields`. The dispatcher writes the run's conclusion
 * and its report here: the runner hands them over through a port and does not see the trace.
 */
@Injectable()
export class RunTraceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Admission and the ledger row are one act, but the ticket is the **slot**, not the row.
   *
   * `null` means “no free slot”: all are occupied by runs whose ticket is still valid. A partial
   * unique index enforces atomicity: of two simultaneous admissions to the same slot, one gets a
   * conflict, whereas a “count and insert” check would let both through.
   */
  async admit(run: Admission): Promise<Ticket | null> {
    await this.retireAbandoned();

    for (let slot = 0; slot < run.concurrency; slot += 1) {
      const admitted = await this.tryAdmit(run, slot);
      if (admitted) {
        return admitted;
      }
    }

    return null;
  }

  /**
   * Retires a run that did not report by the end of its ticket and frees its slot.
   *
   * The status is separate from `failed`, because a process killed from outside is not a model
   * failure, and the circuit breaker does not see it. A record of it stays in the ledger: a row is
   * never deleted.
   */
  async retireAbandoned(): Promise<number> {
    const { count } = await this.prisma.runTrace.updateMany({
      where: { status: 'running', expiresAt: { lt: new Date() } },
      data: {
        status: 'abandoned',
        finishedAt: new Date(),
        reason: 'run never reported — ticket expired',
      },
    });

    return count;
  }

  private async tryAdmit(run: Admission, slot: number): Promise<Ticket | null> {
    try {
      return await this.prisma.runTrace.create({
        data: {
          mode: run.envelope.mode,
          // The App keeps the ledger, and only the run dispatcher creates a row in it, that is, a
          // run launched by the application. The enum's other value exists for chat runs, which
          // do not pass through the App and do not write here; a parameter with a single possible
          // value would only pretend to be a choice.
          executionSurface: 'app_triggered',
          ...traceTrigger(run.envelope),
          originKind: run.origin,
          originId: run.originId ?? null,
          budgetClass: run.budgetClass,
          slot,
          expiresAt: addSeconds(new Date(), run.ticketSeconds),
        },
        select: { id: true, expiresAt: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;

      throw error;
    }
  }

  /**
   * The conclusion is written only to a row that is still `running`.
   *
   * The ticket may have been revoked while the run was in progress: `retireAbandoned` retires a
   * run that did not report by its ticket's expiry, and frees the slot. Without the predicate, a
   * zombie that came back to life after that would rewrite itself to `completed` and **would close
   * the circuit breaker**, because the breaker counts `completed` and `failed` rows: one false
   * success would disarm the safeguard, the only one between a broken path and forty spent runs a
   * day.
   *
   * This is the same fence that the other queues enforce with a lease. Here the status serves as
   * the fence, because the ticket is the status.
   *
   * The report of a run whose ticket was revoked is lost along with the status: an `abandoned` row
   * says “the run did not report”, and an appended report would make that false. The tokens spent
   * by a run with a revoked ticket are therefore not counted. The case is rare, because the
   * dispatcher aborts the run before the ticket expires.
   *
   * The verdict, the snapshot and the effects are one transaction, and the snapshot is written only
   * after the fenced verdict. The trace therefore appears whole or not at all, and a run whose
   * ticket was revoked has nowhere to append even a part.
   *
   * The rules between the trace tables are deferred to the end of the transaction, so the
   * intermediate state between statements does not violate them. They are checked before the
   * commit, with `SET CONSTRAINTS ALL IMMEDIATE`, because a violation then arrives as a statement
   * error with the rule's name, whereas a failed commit is reported by Prisma as a closed
   * transaction and loses the cause.
   */
  conclude(id: string, conclusion: Conclusion): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.runTrace.updateMany({
        where: { id, status: 'running' },
        data: { ...verdictOf(conclusion), latencyMs: conclusion.latencyMs, finishedAt: new Date() },
      });

      if (count !== 1) {
        return false;
      }

      const snapshot = snapshotOf(conclusion);
      if (snapshot) {
        await tx.runSnapshot.create({ data: { runId: id, ...snapshot } });
      }

      const applied = conclusion.effects?.applied ?? [];
      if (applied.length > 0) {
        await tx.runAppliedEffect.createMany({
          data: applied.map((effect, position) => ({
            runId: id,
            position,
            kind: effect.kind,
            recordId: effect.id,
          })),
        });
      }

      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;

      return true;
    });
  }

  /**
   * Counts the runs charged to the daily limit since `from`.
   *
   * A run deferred because of the plan quota is not charged to it (ADR 0012): counting it would
   * mean that an exhausted plan quota exhausts the daily limit as well. A run deferred because of
   * Notion is charged if it reached the model (the snapshot has a result message): the plan has
   * already consumed that run, and a Notion API failure must not eat it silently (ADR 0045).
   */
  countBudgetedSince(from: Date): Promise<number> {
    return this.prisma.runTrace.count({
      where: {
        budgetClass: 'budgeted',
        createdAt: { gte: from },
        OR: [
          { status: { not: 'deferred' } },
          { notionUnavailable: true, snapshot: { model: { not: null } } },
        ],
      },
    });
  }

  /**
   * Returns the verdicts of the last finished runs, the newest first.
   *
   * `running` is not counted: an unfinished run is not a failure, and counting it as one would
   * open the breaker in the middle of normal operation.
   */
  async lastVerdicts(take: number): Promise<RunStatus[]> {
    const rows = await this.prisma.runTrace.findMany({
      // `abandoned` is not included here: a run killed from outside says nothing about whether the
      // next one will fail, and that is what the breaker asks. `deferred` is not included either,
      // because an exhausted plan quota is not a fault in the run path. Nor is a failure caused by
      // an unavailable Notion (ADR 0045): what broke is not the run path.
      where: { status: { in: ['completed', 'failed'] }, notionUnavailable: false },
      orderBy: { createdAt: 'desc' },
      take,
      select: { status: true },
    });

    return rows.map((row) => row.status);
  }

  /**
   * Returns the last finished run, the same one the breaker looks at last. When the breaker is
   * open, that is the failed run that opened it.
   */
  lastFinished(): Promise<Pick<RunTrace, 'id' | 'reason' | 'pageId'> | null> {
    return this.prisma.runTrace.findFirst({
      where: { status: { in: ['completed', 'failed'] }, notionUnavailable: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, pageId: true },
    });
  }

  /**
   * Counts the slots that are currently occupied, that is, the runs whose ticket is still valid.
   *
   * An expired ticket holds no slot, even if the row has not yet been retired as `abandoned`:
   * admission retires it before taking a slot.
   */
  occupiedSlots(): Promise<number> {
    return this.prisma.runTrace.count({
      where: { status: 'running', expiresAt: { gt: new Date() } },
    });
  }

  /**
   * Returns the time until which the plan quota is still exhausted, or `null` if it no longer is.
   *
   * The time is the latest of the deferred runs' times that has not yet come: until it comes, any
   * new run would hit the same quota. Only the plan quota writes the time: a run deferred because
   * of Notion waits through its row, not through the run gates (ADR 0045).
   */
  async quotaBlockedUntil(): Promise<Date | null> {
    const { _max } = await this.prisma.runTrace.aggregate({
      where: { status: 'deferred', deferredUntil: { gt: new Date() } },
      _max: { deferredUntil: true },
    });

    return _max.deferredUntil;
  }
}

/**
 * Returns the verdict for a ledger row: the status, the reason, the reset time for the plan quota,
 * and whether the run ended because Notion was unavailable.
 */
function verdictOf(
  conclusion: Conclusion,
): Pick<
  Prisma.RunTraceUpdateManyMutationInput,
  'status' | 'reason' | 'deferredUntil' | 'notionUnavailable'
> {
  switch (conclusion.status) {
    case 'completed':
      return { status: 'completed' };

    case 'failed':
      return {
        status: 'failed',
        reason: conclusion.error,
        notionUnavailable: conclusion.notionUnavailable === true,
      };

    case 'deferred':
      return conclusion.cause === 'plan_quota'
        ? { status: 'deferred', reason: conclusion.reason, deferredUntil: conclusion.until }
        : { status: 'deferred', reason: conclusion.reason, notionUnavailable: true };
  }
}

type SnapshotParts = Omit<Prisma.RunSnapshotUncheckedCreateInput, 'runId'>;

/**
 * Builds the run snapshot: the parts the run reached, with their lists.
 *
 * Returns `undefined` when the run has nothing to record: it failed before init and did not reach
 * the result message. Then there is no snapshot at all, because a snapshot with no part would say
 * “the run reported” while saying nothing.
 */
function snapshotOf(conclusion: Conclusion): SnapshotParts | undefined {
  const { report, observation } = conclusion;
  // A run deferred by the plan quota has no result; one deferred by Notion keeps it for audit.
  const result =
    conclusion.status === 'deferred' && conclusion.cause === 'plan_quota'
      ? undefined
      : conclusion.result;

  if (!report && !observation && !result) {
    return undefined;
  }

  return {
    ...(observation && observationPart(observation, conclusion.effects?.refused ?? [])),
    ...(report && reportPart(report)),
    ...(result && { result: storedJson(result) }),
  };
}

/**
 * Returns the report of the result message, whole and with each model's tokens. The snapshot's
 * `CHECK` rejects a partial report.
 */
function reportPart(report: RunReport): SnapshotParts {
  return {
    model: report.model,
    numTurns: report.numTurns,
    durationMs: report.durationMs,
    terminalReason: report.terminalReason ?? null,
    modelUsage: nested(
      Object.entries(report.modelUsage).map(([model, tokens]) => ({
        model,
        canonicalModel: tokens.canonicalModel ?? null,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheReadInputTokens: tokens.cacheReadInputTokens,
        cacheCreationInputTokens: tokens.cacheCreationInputTokens,
      })),
    ),
  };
}

/**
 * Returns the init snapshot together with what the run did after init and what it was refused.
 *
 * App refusals are written here, not separately: there are no tool calls before init, so a
 * refusal without an init snapshot would mean a runner error, not one more state.
 */
function observationPart(
  observation: RunObservation,
  refused: readonly RefusedCall[],
): SnapshotParts {
  const decisions: Omit<Prisma.RunPolicyDecisionCreateManySnapshotInput, 'position'>[] = [
    ...observation.permissionDenials.map((tool) => ({
      source: PolicyDecisionSource.perimeter,
      tool,
    })),
    ...refused.map((refusal) => ({ source: PolicyDecisionSource.app, ...refusal })),
  ];

  return {
    init: storedJson(observation.init),
    toolCalls: nested(
      observation.toolCalls.map((call, position) => ({
        position,
        server: call.server ?? null,
        tool: call.tool,
        ok: call.ok,
      })),
    ),
    policyDecisions: nested(decisions.map((decision, position) => ({ ...decision, position }))),
  };
}

/**
 * Turns a snapshot list into a nested write. An empty list means no rows, not an instruction:
 * there is nothing to write.
 */
function nested<T>(data: T[]): { createMany: { data: T[] } } | undefined {
  return data.length > 0 ? { createMany: { data } } : undefined;
}
