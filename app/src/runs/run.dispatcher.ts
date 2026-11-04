import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  addDays,
  addHours,
  addSeconds,
  differenceInMilliseconds,
  isAfter,
  min,
  subSeconds,
} from 'date-fns';
import { messageOf } from '../platform/error/message-of';
import { budgetConfig, type BudgetConfig } from './budget.config';
import { NOTION_WAIT_NOTICE, type NotionWait, type NotionWaitNotice } from './notion-wait-notice';
import { budgetClassOf, isPersonsSnooze } from './provenance';
// `import type` is required: the interface appears in a decorated constructor signature, and
// `emitDecoratorMetadata` together with `isolatedModules` demands that a type that does not exist
// at runtime be marked as a type.
import { RUN_EFFECTS, type RunEffects, type RunEffectsSession } from './run-effects';
import { GateDenial, RunGates } from './run-gates';
import { RunOutcome } from './run-outcome';
import { RunRequest } from './run-source';
import { Conclusion, RunTraceRepository, Ticket } from './run-trace.repository';
import { DEADLINE_REACHED, RUN_LAUNCHER, type RunLauncher, type RunShape } from './run.launcher';
import { runsConfig, type RunsConfig } from './runs.config';

export interface DispatchRequest extends RunRequest {
  /**
   * Records that the origin row caused the run.
   *
   * It is called between admission and launch, the one point where it is already known that the
   * run will happen and not yet known how it will end (`contracts/canonical.yaml`, key
   * `scheduled_check`).
   *
   * It is a hook, not two steps exposed to callers. The sequence “run gates → admission →
   * recording → launch” must remain one sequence, because a copy in every caller would drift
   * apart.
   */
  readonly recordAttempt: () => Promise<void>;
  /**
   * What the run has beyond its mode. An ordinary run has nothing; only the gate command supplies
   * it.
   */
  readonly shape?: RunShape;
}

/** Why the run did not happen: the run gates are closed or no slot was available. */
type DispatchDenial = GateDenial | 'concurrency';

/**
 * The longest plan-quota window is seven days. A reset time beyond it is an error in the report,
 * not a quota.
 */
const LONGEST_PLAN_WINDOW_DAYS = 7;

/**
 * What to do with the origin row after the run: conclude it, fail it, refund the attempt until the
 * plan quota resets, or refund the attempt and wait for Notion.
 */
type Verdict = 'completed' | 'failed' | 'plan_quota' | 'notion';

/**
 * What became of the origin.
 *
 * A run that took place ends in one of four verdicts. The ledger keeps the time to wait until
 * after the plan quota (`deferred_until`): until the reset the run gates let no run through, and
 * the origin row stays as it was (`INV-084`). A run that did not reach Notion waits through its
 * row, not through the gates (ADR 0045). `notionReached` means the run reached Notion and does not
 * wait itself: Notion answers.
 */
export type DispatchResult =
  | {
      readonly started: true;
      readonly traceId: string;
      readonly verdict: Verdict;
      readonly notionReached: boolean;
    }
  | {
      readonly started: false;
      readonly denial: DispatchDenial;
    };

/**
 * A single entry into a run for all origins.
 *
 * The queues differ: the debounce window and continuations live separately, because they have
 * different envelopes. But the limits must be shared: otherwise each queue would count the day in
 * its own way, and “forty runs” would stop meaning forty.
 *
 * The order of the steps matters. First the run gates: the runner and its readiness, the plan
 * quota, and for autonomous work the breaker and the daily limit (`RunGates`). The scheduler asks
 * the same gates before taking a row, and here they are checked once more, right before admission:
 * the state may have changed, and the gate command comes here without passing through the
 * scheduler. Only then comes admission, because admission creates the ledger row, that is,
 * spends the limit.
 *
 * App effects belong here too, not to the runner: whether to apply a run's writes is decided by
 * the outcome together with the deadline, and both are known only here (ADR 0014).
 */
@Injectable()
export class RunDispatcher {
  private readonly logger = new Logger(RunDispatcher.name);

  constructor(
    private readonly gates: RunGates,
    private readonly traces: RunTraceRepository,
    @Inject(budgetConfig.KEY) private readonly budget: BudgetConfig,
    @Inject(runsConfig.KEY) private readonly runs: RunsConfig,
    @Inject(RUN_LAUNCHER) private readonly launcher: RunLauncher,
    @Inject(RUN_EFFECTS) private readonly effects: RunEffects,
    @Inject(NOTION_WAIT_NOTICE) private readonly notionWait: NotionWaitNotice,
  ) {
    // A ticket shorter than the wind-down allowance would abort every run right after it starts,
    // and silently, because the timer would simply fire with zero. This is a configuration error,
    // and it belongs at startup, not in the ledger.
    if (runs.ticketSeconds <= runs.windDownSeconds) {
      throw new Error(
        `runs.ticketSeconds must exceed the ${runs.windDownSeconds}s wind-down (runs.windDownSeconds)`,
      );
    }

    // A runner without the App MCP would launch runs with nowhere to write, and each would fail
    // right at init, spending the budget. This is an error in the wiring of the application, and
    // it too belongs at startup.
    if (launcher.available && !effects.available) {
      throw new Error('a runner is wired without App MCP: runs would have nowhere to write');
    }
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const closed = await this.gates.check(request.provenance);
    if (closed) {
      return this.denied(closed.denial, request);
    }

    const ticket = await this.traces.admit({
      envelope: request.envelope,
      origin: request.provenance.origin,
      originId: request.originId,
      budgetClass: budgetClassOf(request.provenance),
      concurrency: this.budget.concurrency,
      ticketSeconds: this.runs.ticketSeconds,
    });

    if (!ticket) {
      return this.denied('concurrency', request);
    }

    const { conclusion, notionReached } = await this.runAdmitted(ticket, request);

    // The ticket may have been revoked while the run was in progress. Then the conclusion is
    // written nowhere, and it must not pass unreported: someone else has already taken the slot,
    // and this run has vanished from what the circuit breaker sees.
    const recorded = await this.traces.conclude(ticket.id, conclusion);

    this.warnIfRetired(ticket.id, recorded);

    if (conclusion.status === 'deferred') {
      this.logger.warn(
        conclusion.cause === 'plan_quota'
          ? `${ticket.id}: plan limit reached — runs wait until ${conclusion.until.toISOString()}`
          : `${ticket.id}: Notion was not reached — the row waits (${conclusion.reason})`,
      );
    }

    // The conclusion of a run whose ticket was revoked is not reported to the person: their window
    // has most likely already been taken by another run.
    if (recorded) await this.tellWaitingPerson(request, conclusion);

    return {
      started: true,
      traceId: ticket.id,
      verdict: verdictOf(conclusion),
      notionReached: notionReached && verdictOf(conclusion) !== 'notion',
    };
  }

  /**
   * Takes a run that has a ticket from the App MCP session to its conclusion.
   *
   * A run that ended in an exception must leave the same record as a run that reported a failure:
   * otherwise the breaker would not see it, and the slot would stay occupied until the ticket
   * expires. Its writes are not applied.
   */
  private async runAdmitted(
    ticket: Ticket,
    request: DispatchRequest,
  ): Promise<{ readonly conclusion: Conclusion; readonly notionReached: boolean }> {
    const startedAt = new Date();
    const deadline = this.deadlineOf(ticket.expiresAt);
    let session: RunEffectsSession | undefined;

    try {
      session = this.effects.open({
        runId: ticket.id,
        mode: request.envelope.mode,
        provenance: request.provenance,
        cause: request.envelope.trigger.event_id,
        startedAt,
        expiresAt: ticket.expiresAt,
        deadline: deadline.signal,
      });

      await request.recordAttempt();

      const outcome = await this.launcher.launch({
        id: ticket.id,
        envelope: request.envelope,
        provenance: request.provenance,
        expiresAt: ticket.expiresAt,
        signal: deadline.signal,
        app: { url: session.url, bearer: session.bearer },
        shape: request.shape,
      });

      const conclusion = await this.settle(
        outcome,
        request,
        session,
        deadline.signal,
        differenceInMilliseconds(new Date(), startedAt),
      );

      return { conclusion, notionReached: reachedNotion(outcome) };
    } catch (error) {
      const effects = await session?.discard();

      this.warnIfRetired(
        ticket.id,
        await this.traces.conclude(ticket.id, {
          status: 'failed',
          latencyMs: differenceInMilliseconds(new Date(), startedAt),
          error: messageOf(error),
          effects,
        }),
      );

      throw error;
    } finally {
      deadline.release();
    }
  }

  /**
   * The runner's outcome becomes the ledger's conclusion and decides the fate of the run's writes.
   *
   * App writes are applied only for a valid result that arrived before the deadline (ADR 0014). A
   * run aborted by the deadline is marked failed, because it did not fit within its ticket, even
   * if the outcome arrived in time: its writes would be applied when the ticket is already handing
   * the slot to the next run. A completed run whose writes were not applied is a failure too: the
   * message it composed may have announced them.
   */
  private async settle(
    outcome: RunOutcome,
    request: DispatchRequest,
    session: RunEffectsSession,
    signal: AbortSignal,
    latencyMs: number,
  ): Promise<Conclusion> {
    switch (outcome.status) {
      case 'completed': {
        if (signal.aborted) {
          return {
            ...outcome,
            status: 'failed',
            latencyMs,
            error: DEADLINE_REACHED,
            effects: await session.discard(),
          };
        }

        const effects = await session.commit();
        if (effects.failure === undefined) {
          return { ...outcome, latencyMs, effects };
        }

        return {
          ...outcome,
          status: 'failed',
          latencyMs,
          error: `App effects not applied: ${effects.failure}`,
          effects,
        };
      }

      case 'failed':
        return { ...outcome, latencyMs, effects: await session.discard() };

      case 'deferred': {
        const effects = await session.discard();

        return outcome.cause === 'plan_quota'
          ? {
              status: 'deferred',
              cause: 'plan_quota',
              latencyMs,
              reason: outcome.reason,
              until: this.deferralEnd(outcome.resetsAt),
              report: outcome.report,
              observation: outcome.observation,
              effects,
            }
          : this.unreached(outcome, request, latencyMs, effects);
      }
    }
  }

  /**
   * Decides the conclusion of a run that did not reach Notion (ADR 0045). The writes have already
   * been discarded: a run that read nothing writes nothing.
   *
   * - A person's snooze does not wait: a reminder comes on time or not at all, and past the attempt
   *   limit the App tells the person (`INV-108`). The breaker does not count its failure, because
   *   what broke is not the run path.
   * - A row that has waited for Notion longer than the limit waits no longer: the failure is an
   *   ordinary one, and the breaker sees it. The failure signals a long outage.
   * - The rest wait through their row: the attempt is refunded, and other rows proceed as usual.
   */
  private unreached(
    outcome: Extract<RunOutcome, { status: 'deferred'; cause: 'notion' }>,
    request: DispatchRequest,
    latencyMs: number,
    effects: Conclusion['effects'],
  ): Conclusion {
    const { reason, report, observation, result } = outcome;

    if (isPersonsSnooze(request.provenance)) {
      return {
        status: 'failed',
        notionUnavailable: true,
        latencyMs,
        error: reason,
        report,
        observation,
        result,
        effects,
      };
    }

    const since = request.notionHeldSince;
    const limit = this.runs.notionHoldLimitHours;

    if (since && !isAfter(addHours(since, limit), new Date())) {
      return {
        status: 'failed',
        notionHoldExpired: true,
        latencyMs,
        error: `Notion was not reached for ${limit}h: ${reason}`,
        report,
        observation,
        result,
        effects,
      };
    }

    return {
      status: 'deferred',
      cause: 'notion',
      latencyMs,
      reason,
      report,
      observation,
      result,
      effects,
    };
  }

  /**
   * Notifies a person who replied in the channel and is waiting when the run of their window did
   * not reach Notion. The person is told that the reply will come as soon as Notion works again or,
   * when the window has waited a day, that there will be no reply and they should write again
   * (ADR 0045). A notice failure does not break the deferral: it is cosmetic on top of an honest
   * conclusion, and the next deferral will try again with the same key.
   */
  private async tellWaitingPerson(request: DispatchRequest, conclusion: Conclusion): Promise<void> {
    const wait = waitOf(request);
    if (!wait) return;

    const waiting = conclusion.status === 'deferred' && conclusion.cause === 'notion';
    const gaveUp = conclusion.status === 'failed' && conclusion.notionHoldExpired === true;

    if (!waiting && !gaveUp) return;

    try {
      await (waiting ? this.notionWait.waiting(wait) : this.notionWait.gaveUp(wait));
    } catch (error) {
      this.logger.warn(
        `${wait.windowId}: the person was not told that Notion is unavailable — ${messageOf(error)}`,
      );
    }
  }

  /**
   * Returns the time until which to wait after the plan quota.
   *
   * The run itself supplies the reset time, from the quota event. An unknown reset time, or one
   * already past, means an hour (ADR 0012). A time beyond the longest plan window is an error in
   * the report, not a quota: without the ceiling one such error would silently stop all runs,
   * because none starts before that time.
   */
  private deferralEnd(resetsAt: Date | undefined): Date {
    const now = new Date();

    if (resetsAt === undefined || !isAfter(resetsAt, now)) {
      return addSeconds(now, this.runs.planQuotaBackoffSeconds);
    }

    return min([resetsAt, addDays(now, LONGEST_PLAN_WINDOW_DAYS)]);
  }

  /**
   * Creates a signal that aborts the run earlier than its ticket expires.
   *
   * The ticket frees the slot by itself when it expires, and the run's process has no timeout of
   * its own. Without the abort, a run that outlived its ticket would work alongside the next one,
   * and the concurrency limit would stop being a limit.
   */
  private deadlineOf(expiresAt: Date): {
    readonly signal: AbortSignal;
    readonly release: () => void;
  } {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException(DEADLINE_REACHED, 'TimeoutError')),
      Math.max(
        0,
        differenceInMilliseconds(subSeconds(expiresAt, this.runs.windDownSeconds), new Date()),
      ),
    );

    timer.unref();

    return { signal: controller.signal, release: () => clearTimeout(timer) };
  }

  /**
   * Warns that the run outlived its own ticket and the conclusion was written nowhere.
   *
   * The row has already been retired as `abandoned`, the slot is freed, and rewriting it back is
   * not allowed, because a false success would close the circuit breaker. What is left is to say
   * so explicitly: a silent loss of the conclusion makes the run look as if it had never happened.
   */
  private warnIfRetired(traceId: string, recorded: boolean): void {
    if (recorded) return;

    this.logger.warn(`${traceId}: ticket was retired before the run reported back`);
  }

  private denied(denial: DispatchDenial, request: DispatchRequest): DispatchResult {
    this.logger.log(`run denied (${denial}): ${request.envelope.trigger.type}`);

    return { started: false, denial };
  }
}

/** Derives the verdict for the origin row from the ledger's conclusion. */
function verdictOf(conclusion: Conclusion): Verdict {
  return conclusion.status === 'deferred' ? conclusion.cause : conclusion.status;
}

/** Checks whether the run reached Notion: at least one of its Notion calls succeeded. */
function reachedNotion(outcome: RunOutcome): boolean {
  return (
    outcome.observation?.toolCalls.some((call) => call.server === 'notion' && call.ok) ?? false
  );
}

/**
 * Returns the window of a person's reply in the channel. Only that kind of window awaits the notice
 * about an unavailable Notion. `undefined` means the run is not about a window of that kind. A
 * channel window always has a thread (`contracts/canonical.yaml`, key `evaluation_window`); without
 * one the person would have nowhere to reply.
 */
function waitOf(request: DispatchRequest): NotionWait | undefined {
  const { trigger } = request.envelope;

  if (request.provenance.origin !== 'channel_inbound' || !request.originId) return undefined;
  if (!('page_id' in trigger) || !trigger.page_id) return undefined;
  if (!('discussion_id' in trigger) || !trigger.discussion_id) return undefined;

  return {
    windowId: request.originId,
    discussionId: trigger.discussion_id,
    pageId: trigger.page_id,
  };
}
