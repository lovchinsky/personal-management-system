import { Injectable } from '@nestjs/common';
import { Prisma, RunModelUsage, RunPolicyDecision, RunToolCall } from '../generated/prisma/client';
import {
  PolicyDecisionSource,
  RunBudgetClass,
  RunOrigin,
  RunStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../platform/db/prisma.service';
import { AppliedEffect } from './run-effects';
import { ModelTokens, RunInit, runInitSchema, ToolCall } from './run-outcome';

/** The whole run trace: the snapshot with its lists and the applied effects, each list in order. */
const WHOLE_TRACE = {
  snapshot: {
    include: {
      toolCalls: { orderBy: { position: 'asc' } },
      policyDecisions: { orderBy: { position: 'asc' } },
      modelUsage: { orderBy: { model: 'asc' } },
    },
  },
  appliedEffects: { orderBy: { position: 'asc' } },
} satisfies Prisma.RunTraceInclude;

type TraceRow = Prisma.RunTraceGetPayload<{ include: typeof WHOLE_TRACE }>;

/**
 * The statuses of a run that has reached a conclusion and recorded what was applied along with it.
 */
const CONCLUDED: ReadonlySet<RunStatus> = new Set<RunStatus>(['completed', 'failed', 'deferred']);

/** The perimeter's or the App's decision about a call, as the trace recorded it. */
interface PolicyDecision {
  readonly source: PolicyDecisionSource;
  readonly tool: string;
  readonly reason?: string;
}

/**
 * A run trace as seen by someone who did not admit the run: the verdict, the snapshot and the
 * lists, without the admission bookkeeping.
 *
 * A `null` list is not recorded; an empty list is recorded and empty. Calls and refusals are
 * recorded when there is an init, tokens when there is a model, applied effects when the run
 * reached a conclusion (`docs/2-system.md` § “Implementation inventory”).
 */
export interface TraceView {
  readonly id: string;
  readonly status: RunStatus;
  readonly origin: RunOrigin;
  readonly budgetClass: RunBudgetClass;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly latencyMs: number | null;
  /** Why the run failed, was deferred or was abandoned. */
  readonly reason: string | null;
  readonly deferredUntil: Date | null;
  readonly init: RunInit | null;
  readonly toolCalls: readonly ToolCall[] | null;
  readonly policyDecisions: readonly PolicyDecision[] | null;
  readonly model: string | null;
  readonly modelUsage: Readonly<Record<string, ModelTokens>> | null;
  readonly numTurns: number | null;
  readonly durationMs: number | null;
  readonly terminalReason: string | null;
  readonly result: unknown;
  readonly runtimeEffects: readonly AppliedEffect[] | null;
}

/**
 * Read access to the trace for those who do not admit runs: gate commands, diagnostics and the
 * sweep, which asks whether anyone has already seen a page.
 *
 * The trace is read and written only by `runs/` (`INV-079`): the rest of the App sees a run
 * through this projection, not through the tables. The init snapshot is parsed with the same shape
 * it was recorded with: a document this version does not recognize is an error, not a silently
 * truncated view. The rest of the shape is enforced by the database itself.
 */
@Injectable()
export class RunTraces {
  constructor(private readonly prisma: PrismaService) {}

  async find(id: string): Promise<TraceView | null> {
    const row = await this.prisma.runTrace.findUnique({ where: { id }, include: WHOLE_TRACE });

    return row && viewOf(row);
  }

  /**
   * Checks whether a run about one of these pages that started no earlier than `since` has
   * reached a conclusion. That run read the page after `since` and saw its state as it was then. A
   * run's page is stored in the column `page_id`, which is derived from its envelope.
   */
  async concludedAbout(pageIds: readonly string[], since: Date): Promise<boolean> {
    if (pageIds.length === 0) return false;

    const found = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT 1
        FROM "run_traces"
       WHERE "status" = 'completed'::"RunStatus"
         AND "created_at" >= ${since}
         AND "page_id" = ANY(${[...pageIds]}::text[])
       LIMIT 1
    `);

    return found.length > 0;
  }
}

function viewOf(row: TraceRow): TraceView {
  return {
    id: row.id,
    status: row.status,
    origin: row.originKind,
    budgetClass: row.budgetClass,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    latencyMs: row.latencyMs,
    reason: row.reason,
    deferredUntil: row.deferredUntil,
    ...(row.snapshot === null ? NO_SNAPSHOT : snapshotView(row.snapshot)),
    runtimeEffects: CONCLUDED.has(row.status)
      ? row.appliedEffects.map((effect) => ({ kind: effect.kind, id: effect.recordId }))
      : null,
  };
}

/** The parts of the trace that the run's snapshot holds. */
type SnapshotView = Pick<
  TraceView,
  | 'init'
  | 'toolCalls'
  | 'policyDecisions'
  | 'model'
  | 'modelUsage'
  | 'numTurns'
  | 'durationMs'
  | 'terminalReason'
  | 'result'
>;

/** A run without a snapshot recorded none of its parts and none of the lists that go with them. */
const NO_SNAPSHOT: SnapshotView = {
  init: null,
  toolCalls: null,
  policyDecisions: null,
  model: null,
  modelUsage: null,
  numTurns: null,
  durationMs: null,
  terminalReason: null,
  result: null,
};

/**
 * A snapshot list is recorded when the part it is derived from is recorded: calls and refusals
 * depend on the init, tokens on the report of the result message.
 */
function snapshotView(snapshot: NonNullable<TraceRow['snapshot']>): SnapshotView {
  const init = snapshot.init === null ? null : runInitSchema.parse(snapshot.init);

  return {
    init,
    toolCalls: init === null ? null : snapshot.toolCalls.map(toolCallOf),
    policyDecisions: init === null ? null : snapshot.policyDecisions.map(decisionOf),
    model: snapshot.model,
    modelUsage:
      snapshot.model === null
        ? null
        : Object.fromEntries(snapshot.modelUsage.map((usage) => [usage.model, tokensOf(usage)])),
    numTurns: snapshot.numTurns,
    durationMs: snapshot.durationMs,
    terminalReason: snapshot.terminalReason,
    result: snapshot.result,
  };
}

/**
 * A tool of the harness itself has no server, so the view has none either, as in the runner's
 * record.
 */
function toolCallOf(call: RunToolCall): ToolCall {
  return { ...(call.server ? { server: call.server } : {}), tool: call.tool, ok: call.ok };
}

/** The perimeter does not report a reason: the field is absent, not empty. */
function decisionOf(decision: RunPolicyDecision): PolicyDecision {
  return {
    source: decision.source,
    tool: decision.tool,
    ...(decision.reason === null ? {} : { reason: decision.reason }),
  };
}

function tokensOf(usage: RunModelUsage): ModelTokens {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    ...(usage.canonicalModel === null ? {} : { canonicalModel: usage.canonicalModel }),
  };
}
