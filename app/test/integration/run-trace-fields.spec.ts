import { addHours } from 'date-fns';
import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { canonical, RequiredWhen } from '../contract/contracts';
import { connectToTestDatabase, truncateAll } from './database';
import {
  abandonedRun,
  completedRun,
  deferredRun,
  failedRun,
  INIT_PART,
  insertTrace,
  REPORT_PART,
  Row,
  runningRun,
  withSnapshot,
} from './ledger-rows';

/**
 * The database enforces which trace fields are required — and enforces them according to the
 * contract.
 *
 * Each field of `run_trace_fields` has `required_when`: the point in the run from which it must
 * be in the trace. A field lives in a ledger column, in a snapshot column or as rows of a list.
 * For a column, the test takes a trace in a state where the field is required and removes
 * just that column from it, and the database must refuse. A list may be empty: “there were
 * none” is an answer too. A list is recorded by the part it is counted from. The database must
 * refuse list rows without that part, and must refuse the removal of the part while rows exist.
 * The database accepts the same traces when they are whole: otherwise the refusal would prove
 * nothing.
 *
 * The check runs against the database, not against the text of the migration: a grep would not
 * notice a rule that was never applied or that a later migration removed.
 */
type LedgerColumn = Prisma.RunTraceScalarFieldEnum;
type SnapshotColumn = Prisma.RunSnapshotScalarFieldEnum;
type List = 'toolCalls' | 'policyDecisions' | 'modelUsage' | 'appliedEffects';

type ColumnStorage =
  | { readonly kind: 'ledger'; readonly column: LedgerColumn }
  | { readonly kind: 'snapshot'; readonly column: SnapshotColumn };

type Storage = ColumnStorage | { readonly kind: 'list'; readonly list: List };

const isColumn = (storage: Storage): storage is ColumnStorage => storage.kind !== 'list';

const ledger = (column: LedgerColumn): ColumnStorage => ({ kind: 'ledger', column });
const snapshot = (column: SnapshotColumn): ColumnStorage => ({ kind: 'snapshot', column });
const list = (name: List): Storage => ({ kind: 'list', list: name });

/**
 * Where a trace keeps each stored field. The `derived` and `not_collected` fields deliberately
 * have no place.
 */
const STORAGE: Readonly<Record<string, readonly Storage[]>> = {
  trigger: [ledger('trigger')],
  mode: [ledger('mode')],
  execution_surface: [ledger('executionSurface')],
  behavior_contract_version: [snapshot('init')],
  model: [snapshot('model')],
  mcp_servers_attached: [snapshot('init')],
  tool_calls: [list('toolCalls')],
  source_references: [snapshot('result')],
  structured_detections: [snapshot('result')],
  proposed_actions: [list('appliedEffects')],
  policy_decisions: [list('policyDecisions')],
  runtime_effects: [list('appliedEffects')],
  latency: [ledger('latencyMs'), snapshot('durationMs')],
  token_usage: [list('modelUsage')],
  technical_errors: [ledger('reason')],
};

/**
 * Column names in the database: the schema's `@map`. A new column without a name here will not
 * build.
 */
const LEDGER_COLUMNS: Readonly<Record<LedgerColumn, string>> = {
  id: 'id',
  mode: 'mode',
  executionSurface: 'execution_surface',
  trigger: 'trigger',
  pageId: 'page_id',
  originKind: 'origin_kind',
  originId: 'origin_id',
  status: 'status',
  slot: 'slot',
  expiresAt: 'expires_at',
  budgetClass: 'budget_class',
  latencyMs: 'latency_ms',
  reason: 'reason',
  deferredUntil: 'deferred_until',
  notionUnavailable: 'notion_unavailable',
  createdAt: 'created_at',
  finishedAt: 'finished_at',
};

const SNAPSHOT_COLUMNS: Readonly<Record<SnapshotColumn, string>> = {
  runId: 'run_id',
  init: 'init',
  model: 'model',
  numTurns: 'num_turns',
  durationMs: 'duration_ms',
  terminalReason: 'terminal_reason',
  result: 'result',
};

const inAnHour = (): Date => addHours(new Date(), 1);

/**
 * Traces in which a field with this `required_when` is already required.
 *
 * For `init` and `result` the trace is a failure that reached them. The status says nothing
 * there, and the rules of the snapshot itself enforce the snapshot part.
 */
const STAGES: Readonly<Record<RequiredWhen, () => readonly Row[]>> = {
  admitted: () => [runningRun(0, inAnHour())],
  init: () => [failedRun(0, withSnapshot(INIT_PART))],
  result: () => [failedRun(0, withSnapshot(INIT_PART, REPORT_PART))],
  completed: () => [completedRun(0)],
  failed: () => [failedRun(0), deferredRun(0, inAnHour()), abandonedRun(0)],
  derived: () => [],
  not_collected: () => [],
};

const REJECTED = /violates (check|not-null) constraint/;

describe('required trace fields', () => {
  const fields = canonical.runTraceFields();
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  const create = (row: Row): Promise<string> => insertTrace(prisma, row);

  /** Clears a column in a trace the database has already accepted. */
  const clear = async (row: Row, storage: ColumnStorage): Promise<number> => {
    const id = await create(row);

    switch (storage.kind) {
      case 'ledger':
        return prisma.$executeRaw(
          Prisma.sql`UPDATE "run_traces" SET ${Prisma.raw(`"${LEDGER_COLUMNS[storage.column]}"`)} = NULL WHERE "id" = ${id}`,
        );

      case 'snapshot':
        return prisma.$executeRaw(
          Prisma.sql`UPDATE "run_snapshots" SET ${Prisma.raw(`"${SNAPSHOT_COLUMNS[storage.column]}"`)} = NULL WHERE "run_id" = ${id}`,
        );
    }
  };

  it('every stored field has a place and the rest do not', () => {
    const stored = fields
      .filter(
        (field) => field.required_when !== 'derived' && field.required_when !== 'not_collected',
      )
      .map((field) => field.id);

    expect(Object.keys(STORAGE).sort()).toEqual([...stored].sort());
  });

  const columnCases = (): [string, RequiredWhen, string, ColumnStorage, number][] =>
    fields.flatMap((field) =>
      (STORAGE[field.id] ?? [])
        .filter(isColumn)
        .flatMap((storage) =>
          STAGES[field.required_when]().map(
            (_, index): [string, RequiredWhen, string, ColumnStorage, number] => [
              field.id,
              field.required_when,
              storage.column,
              storage,
              index,
            ],
          ),
        ),
    );

  it.each(columnCases())(
    '%s (%s): the database rejects a trace without %s',
    async (_, stage, _column, storage, index) => {
      const row = STAGES[stage]()[index];

      await expect(clear(row, storage)).rejects.toThrow(REJECTED);
    },
  );

  const STORED: readonly RequiredWhen[] = ['admitted', 'init', 'result', 'completed', 'failed'];

  it.each(STORED)('the database accepts a whole trace in state %s', async (stage) => {
    for (const row of STAGES[stage]()) {
      await truncateAll(prisma);
      await expect(create(row)).resolves.toBeDefined();
    }
  });

  /**
   * A list is recorded when the part it is counted from is recorded: calls and refusals are
   * counted from init, tokens from the model, applied effects from the conclusion of the run.
   * Without that part, the view would either hide a row of that list or report it as false.
   */
  describe('lists', () => {
    interface ListRule {
      readonly list: List;
      /** A trace whose list is not recorded: the part that records it is missing. */
      readonly unrecorded: () => Row;
      /** A trace with a non-empty list. */
      readonly recorded: () => Row;
      /** A list row of the run. */
      readonly add: (runId: string) => Promise<unknown>;
      /** Removes the part that records the list, and only that part. */
      readonly unrecord: (runId: string) => Promise<unknown>;
    }

    const RULES: readonly ListRule[] = [
      {
        list: 'toolCalls',
        unrecorded: () => failedRun(0, withSnapshot(REPORT_PART)),
        recorded: () => failedRun(0, withSnapshot(INIT_PART, REPORT_PART)),
        add: (runId) =>
          prisma.runToolCall.create({
            data: { runId, position: 0, server: 'notion', tool: 'notion-fetch', ok: true },
          }),
        // The report stays, so the snapshot is not empty: the list rule is what refuses.
        unrecord: (runId) =>
          prisma.$executeRaw`UPDATE "run_snapshots" SET "init" = NULL WHERE "run_id" = ${runId}`,
      },
      {
        list: 'policyDecisions',
        unrecorded: () => failedRun(0, withSnapshot(REPORT_PART)),
        recorded: () =>
          failedRun(
            0,
            withSnapshot(INIT_PART, REPORT_PART, {
              policyDecisions: {
                create: [
                  { position: 0, source: 'perimeter', tool: 'mcp__notion__notion-create-pages' },
                ],
              },
            }),
          ),
        add: (runId) =>
          prisma.runPolicyDecision.create({
            data: {
              runId,
              position: 0,
              source: 'app',
              tool: 'queue_notification',
              reason: 'quiet',
            },
          }),
        unrecord: (runId) =>
          prisma.$executeRaw`UPDATE "run_snapshots" SET "init" = NULL WHERE "run_id" = ${runId}`,
      },
      {
        list: 'modelUsage',
        unrecorded: () => failedRun(0, withSnapshot(INIT_PART)),
        recorded: () => failedRun(0, withSnapshot(INIT_PART, REPORT_PART)),
        add: (runId) =>
          prisma.runModelUsage.create({
            data: {
              runId,
              model: 'claude-opus-5-5',
              inputTokens: 1,
              outputTokens: 1,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          }),
        // The report is removed whole and init stays: the `CHECK`s of the snapshot are satisfied,
        // and the list rule is what refuses.
        unrecord: (runId) => prisma.$executeRaw`
          UPDATE "run_snapshots"
             SET "model" = NULL, "num_turns" = NULL, "duration_ms" = NULL, "terminal_reason" = NULL
           WHERE "run_id" = ${runId}`,
      },
      {
        list: 'appliedEffects',
        unrecorded: () => runningRun(0, inAnHour()),
        recorded: () =>
          failedRun(0, {
            appliedEffects: { create: [{ position: 0, kind: 'delivery', recordId: 'outbox-1' }] },
          }),
        add: (runId) =>
          prisma.runAppliedEffect.create({
            data: { runId, position: 0, kind: 'delivery', recordId: 'outbox-1' },
          }),
        unrecord: (runId) =>
          prisma.$executeRaw`UPDATE "run_traces" SET "status" = 'abandoned' WHERE "id" = ${runId}`,
      },
    ];

    it('every stored list has a rule', () => {
      const lists = Object.values(STORAGE)
        .flat()
        .flatMap((storage) => (storage.kind === 'list' ? [storage.list] : []));

      expect(RULES.map((rule) => rule.list).sort()).toEqual([...new Set(lists)].sort());
    });

    it.each(RULES)(
      '$list: the database rejects a row when the part that records the list is missing',
      async (rule) => {
        const runId = await create(rule.unrecorded());

        await expect(rule.add(runId)).rejects.toThrow(REJECTED);
      },
    );

    it.each(RULES)(
      '$list: the database does not let the part that records a non-empty list be removed',
      async (rule) => {
        const runId = await create(rule.recorded());

        await expect(rule.unrecord(runId)).rejects.toThrow(REJECTED);
      },
    );

    it.each(RULES)(
      '$list: the database accepts a trace in which the list is recorded',
      async (rule) => {
        await expect(create(rule.recorded())).resolves.toBeDefined();
      },
    );
  });

  /**
   * Recording of the plan quota, of the conclusion and of the snapshot itself: not trace fields,
   * but rules about the trace.
   */
  describe('recording outside the trace fields', () => {
    it('the database rejects a deferred run without a reset time', async () => {
      await expect(clear(deferredRun(0, inAnHour()), ledger('deferredUntil'))).rejects.toThrow(
        REJECTED,
      );
    });

    it('the database rejects a reset time on a run that is not deferred', async () => {
      await expect(create(completedRun(0, { deferredUntil: inAnHour() }))).rejects.toThrow(
        REJECTED,
      );
    });

    it('the database rejects a run that reached a conclusion without a conclusion time', async () => {
      await expect(clear(failedRun(0), ledger('finishedAt'))).rejects.toThrow(REJECTED);
    });

    it('the database rejects an unfinished run with a conclusion time', async () => {
      await expect(create(runningRun(0, inAnHour(), { finishedAt: new Date() }))).rejects.toThrow(
        REJECTED,
      );
    });

    it('the database rejects a reason on a completed run', async () => {
      await expect(create(completedRun(0, { reason: 'looked fine' }))).rejects.toThrow(REJECTED);
    });

    it('the database rejects `terminal_reason` without the rest of the report', async () => {
      await expect(
        create(failedRun(0, withSnapshot(INIT_PART, { terminalReason: 'max_turns' }))),
      ).rejects.toThrow(REJECTED);
    });

    it('the database rejects a snapshot with no part at all', async () => {
      await expect(create(failedRun(0, withSnapshot()))).rejects.toThrow(REJECTED);
    });

    /** The report of a run whose ticket is revoked is lost together with its status. */
    it.each([
      ['unfinished', (): Row => runningRun(0, inAnHour(), withSnapshot(INIT_PART))],
      ['abandoned', (): Row => abandonedRun(0, withSnapshot(INIT_PART))],
    ])('the database rejects a snapshot of an %s run', async (_, row) => {
      await expect(create(row())).rejects.toThrow(REJECTED);
    });

    it('the database does not let the snapshot of a completed run be deleted', async () => {
      const runId = await create(completedRun(0));

      await expect(
        prisma.$executeRaw`DELETE FROM "run_snapshots" WHERE "run_id" = ${runId}`,
      ).rejects.toThrow(REJECTED);
    });

    it('the database rejects negative tokens', async () => {
      const runId = await create(failedRun(0, withSnapshot(INIT_PART, REPORT_PART)));

      await expect(
        prisma.$executeRaw`UPDATE "run_model_usage" SET "output_tokens" = -1 WHERE "run_id" = ${runId}`,
      ).rejects.toThrow(REJECTED);
    });

    /**
     * Foreign keys exist only inside a trace, and deleting the ledger row removes the whole trace:
     * the rules between tables do not get in the way of that deletion.
     */
    it('deleting the ledger row takes the whole trace with it', async () => {
      const runId = await create(
        completedRun(0, {
          appliedEffects: { create: [{ position: 0, kind: 'delivery', recordId: 'outbox-1' }] },
        }),
      );

      await prisma.runTrace.delete({ where: { id: runId } });

      await expect(
        Promise.all([
          prisma.runSnapshot.count(),
          prisma.runToolCall.count(),
          prisma.runModelUsage.count(),
          prisma.runAppliedEffect.count(),
        ]),
      ).resolves.toEqual([0, 0, 0, 0]);
    });
  });
});
