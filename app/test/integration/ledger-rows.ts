import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { storedJson } from '../../src/platform/db/stored-json';
import { budgetConfig } from '../../src/runs/budget.config';
import { traceTrigger } from '../../src/runs/run-trace.repository';
import { eventEnvelope, EventMode, TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { A_REPORT, A_RESULT, AN_OBSERVATION } from '../fixtures/run-outcome.fixture';

/**
 * Traces that tests insert by hand, in the states the database accepts.
 *
 * The database enforces which trace fields are required (`contracts/canonical.yaml`, key
 * `run_trace_fields`): the `CHECK`s of each table and the constraint triggers between them, so
 * it rejects a trace put together at random. Each function yields one state with exactly what
 * that state requires. A run that reached a conclusion releases its slot. The snapshot is
 * written as a nested write: the ledger row, the snapshot and the lists land in one
 * transaction, as the conclusion writes them.
 */
export type Row = Prisma.RunTraceCreateInput;

/**
 * What a test can set on a trace itself: only the writer sets the trigger envelope
 * (`traceTrigger`).
 */
type Overrides = Partial<Omit<Row, 'trigger' | 'pageId'>>;

/** Returns the envelope of an event about a page, in the form the ingress builds. */
export function eventAbout(pageId: string, mode: EventMode = 'event_evaluation'): TriggerEnvelope {
  return eventEnvelope(mode, {
    type: 'page.properties_updated',
    event_types: ['page.properties_updated'],
    event_id: `event:${pageId}`,
    timestamp: '2026-10-01T00:00:00.000Z',
    entity_id: pageId,
    page_id: pageId,
    updated_property_ids: [],
  });
}

/** The default envelope: an event about a page the test is not interested in. */
const ANY_EVENT = eventAbout('page-0');

/** A part of the run snapshot: what is appended to it by a nested write. */
type SnapshotPart = Prisma.RunSnapshotCreateWithoutRunInput;

/** The init snapshot and the calls the run made after init. */
export const INIT_PART: SnapshotPart = {
  init: storedJson(AN_OBSERVATION.init),
  toolCalls: {
    create: AN_OBSERVATION.toolCalls.map((call, position) => ({
      position,
      server: call.server ?? null,
      tool: call.tool,
      ok: call.ok,
    })),
  },
};

/** The report of the result message with the tokens of each model. */
export const REPORT_PART: SnapshotPart = {
  model: A_REPORT.model,
  numTurns: A_REPORT.numTurns,
  durationMs: A_REPORT.durationMs,
  terminalReason: A_REPORT.terminalReason,
  modelUsage: {
    create: Object.entries(A_REPORT.modelUsage).map(([model, tokens]) => ({ model, ...tokens })),
  },
};

/** A result that passed the schema. */
const RESULT_PART: SnapshotPart = { result: storedJson(A_RESULT) };

/** Composes a snapshot from the parts the run reached. */
export function withSnapshot(...parts: readonly SnapshotPart[]): Pick<Row, 'snapshot'> {
  return {
    snapshot: { create: parts.reduce<SnapshotPart>((whole, part) => ({ ...whole, ...part }), {}) },
  };
}

/**
 * Writes a trace the way the conclusion writes it: in one transaction that checks the rules
 * between tables before commit.
 *
 * A trace the database accepts can be inserted with a plain `create` too. This path is for a
 * trace the database must reject: Prisma reports a deferred rule violated at commit as a closed
 * transaction, and the test would not see which rule fired.
 */
export function insertTrace(prisma: PrismaService, row: Row): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const { id } = await tx.runTrace.create({ data: row, select: { id: true } });

    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;

    return id;
  });
}

function admitted(slot: number, envelope: TriggerEnvelope): Row {
  return {
    mode: envelope.mode,
    executionSurface: 'app_triggered',
    ...traceTrigger(envelope),
    originKind: 'evaluation_window',
    budgetClass: 'budgeted',
    slot,
    expiresAt: new Date(),
  };
}

/** Builds a completed run, whose snapshot has all three parts. */
export function completedRun(
  slot: number,
  overrides: Overrides = {},
  envelope: TriggerEnvelope = ANY_EVENT,
): Row {
  return {
    ...admitted(slot, envelope),
    status: 'completed',
    finishedAt: new Date(),
    latencyMs: 20_000,
    ...withSnapshot(INIT_PART, REPORT_PART, RESULT_PART),
    ...overrides,
  };
}

/** Builds a failed run that never got as far as init: it has a reason and no snapshot. */
export function failedRun(
  slot: number,
  overrides: Overrides = {},
  envelope: TriggerEnvelope = ANY_EVENT,
): Row {
  return {
    ...admitted(slot, envelope),
    status: 'failed',
    finishedAt: new Date(),
    latencyMs: 1_000,
    reason: 'mcp server notion: needs-auth',
    ...overrides,
  };
}

/** Builds an abandoned run: the ticket expired before the run reported. */
export function abandonedRun(slot: number, overrides: Overrides = {}): Row {
  return {
    ...admitted(slot, ANY_EVENT),
    status: 'abandoned',
    finishedAt: new Date(),
    reason: 'run never reported — ticket expired',
    ...overrides,
  };
}

/** Builds a run that is still going and holds its slot until `expiresAt`. */
export function runningRun(slot: number, expiresAt: Date, overrides: Overrides = {}): Row {
  return { ...admitted(slot, ANY_EVENT), status: 'running', expiresAt, ...overrides };
}

/** Builds a run that hit the plan quota and holds all runs back until `until`. */
export function deferredRun(slot: number, until: Date, overrides: Overrides = {}): Row {
  return {
    ...admitted(slot, ANY_EVENT),
    status: 'deferred',
    finishedAt: new Date(),
    latencyMs: 5_000,
    deferredUntil: until,
    reason: 'plan limit reached',
    ...overrides,
  };
}

/**
 * Builds a run that did not reach Notion (ADR 0045): its row waits, not the run gates, so no
 * deferral time is recorded.
 */
export function notionDeferredRun(slot: number, overrides: Overrides = {}): Row {
  return {
    ...admitted(slot, ANY_EVENT),
    status: 'deferred',
    finishedAt: new Date(),
    latencyMs: 5_000,
    notionUnavailable: true,
    reason: 'no Notion read succeeded',
    ...overrides,
  };
}

/**
 * Fills the day with one run per slot, starting from zero. The slots stay free, because the runs
 * are completed, not still going.
 */
export async function fillRuns(
  prisma: PrismaService,
  count: number,
  row: (slot: number) => Row = completedRun,
): Promise<void> {
  for (let slot = 0; slot < count; slot += 1) {
    await prisma.runTrace.create({ data: row(slot) });
  }
}

/** Exhausts the daily limit with as many runs as the contract allows the system to start itself. */
export function fillDay(
  prisma: PrismaService,
  row: (slot: number) => Row = completedRun,
): Promise<void> {
  return fillRuns(prisma, budgetConfig().dailyLimit, row);
}
