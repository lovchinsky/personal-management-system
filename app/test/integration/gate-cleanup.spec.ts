import { addHours } from 'date-fns';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { emptyResidue, GateCleanup } from '../gate/gate-cleanup';
import { connectToTestDatabase, truncateAll } from './database';

const DASHED = '0f1e2d3c-4b5a-4968-8776-655443322110';
const COMPACT = '0f1e2d3c4b5a49688776655443322110';
const FOREIGN_PAGE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GATE_FOREIGN_CHECK = '01990000-0000-7000-8000-000000000001';
const PRODUCTION_CHECK = '01990000-0000-7000-8000-000000000002';

/**
 * Gate cleanup against a real database: its conditions apply to exactly the gate's rows.
 * The main rows beside them, with another page, thread, key and run, stay.
 * `app_db` writes ids in the canonical form (with hyphens), while the gate may have taken a page
 * from a URL without them, so a residue in the non-canonical form finds its rows too.
 */
describe('gate cleanup in app_db', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let trashed: string[];
  let cleanup: GateCleanup;

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);

    trashed = [];
    cleanup = new GateCleanup({
      outbox: prisma.notificationOutbox,
      continuations: prisma.scheduledCheck,
      windows: prisma.evaluationWindow,
      proposals: prisma.pendingAction,
      occurrences: prisma.reviewOccurrence,
      discussions: prisma.systemDiscussion,
      sweepMarks: prisma.sweepMark,
      reconciliations: prisma.discussionReconciliation,
      inTrash: () => Promise.resolve(false),
      trash: (id) => {
        trashed.push(id);

        return Promise.resolve();
      },
      gbrain: { deletePage: () => Promise.resolve() },
    });
  });

  async function seed(): Promise<void> {
    await prisma.notificationOutbox.createMany({
      data: [
        { idempotencyKey: 'event:gate-m5-1', channel: 'telegram', payload: {} },
        {
          idempotencyKey: 'other-key',
          discussionId: 'gate-thread',
          channel: 'telegram',
          payload: {},
        },
        { idempotencyKey: 'event:production-1', channel: 'telegram', payload: {} },
        {
          idempotencyKey: 'production-thread',
          discussionId: 'other-thread',
          channel: 'telegram',
          payload: {},
        },
      ],
    });
    await prisma.scheduledCheck.createMany({
      data: [
        {
          id: GATE_FOREIGN_CHECK,
          notionPageId: FOREIGN_PAGE,
          runAt: addHours(new Date(), 1),
          reasonCode: 'user_snooze',
        },
        {
          id: PRODUCTION_CHECK,
          notionPageId: FOREIGN_PAGE,
          runAt: addHours(new Date(), 1),
          reasonCode: 'safety_recheck',
        },
        {
          notionPageId: DASHED,
          runAt: addHours(new Date(), 1),
          reasonCode: 'await_external_event',
        },
        {
          notionPageId: FOREIGN_PAGE,
          discussionId: 'gate-thread',
          runAt: addHours(new Date(), 1),
          reasonCode: 'await_external_event',
        },
        {
          notionPageId: FOREIGN_PAGE,
          discussionId: 'other-thread',
          runAt: addHours(new Date(), 1),
          reasonCode: 'await_external_event',
        },
      ],
    });
    await prisma.evaluationWindow.createMany({
      data: [DASHED, FOREIGN_PAGE].map((pageId) => ({
        pageId,
        latestEventId: `telegram:${pageId}`,
        latestEventType: 'telegram.message',
        latestEventAt: new Date(),
        notBefore: new Date(),
      })),
    });
    await prisma.pendingAction.createMany({
      data: ['gate-run', 'production-run'].map((proposedByRunId) => ({
        proposedByRunId,
        notionPageId: FOREIGN_PAGE,
        fingerprint: proposedByRunId,
        effects: [],
        preconditions: [],
      })),
    });
    await prisma.systemDiscussion.createMany({
      data: [
        { discussionId: 'gate-thread', pageId: FOREIGN_PAGE, mode: 'event_evaluation' },
        { discussionId: 'on-gate-page', pageId: DASHED, mode: 'event_evaluation' },
        { discussionId: 'other-thread', pageId: FOREIGN_PAGE, mode: 'event_evaluation' },
      ],
    });
  }

  const gateResidue = {
    ...emptyResidue(),
    pages: [COMPACT],
    outboxKeys: ['event:gate-m5-1'],
    threads: ['gate-thread'],
    runs: ['gate-run'],
    // A continuation that a run scheduled on a foreign page with no thread, which neither the
    // page nor the thread selects.
    continuations: [GATE_FOREIGN_CHECK],
  };

  it('cleans the gate rows in all queues and leaves the main ones', async () => {
    await seed();

    expect(await cleanup.clean(gateResidue)).toEqual([]);

    expect(
      (await prisma.notificationOutbox.findMany({ orderBy: { idempotencyKey: 'asc' } })).map(
        (row) => row.idempotencyKey,
      ),
    ).toEqual(['event:production-1', 'production-thread']);
    expect(
      (await prisma.scheduledCheck.findMany({ orderBy: { id: 'asc' } })).map((row) => row.id),
    ).toEqual([PRODUCTION_CHECK, expect.any(String)]);
    expect(
      (await prisma.scheduledCheck.findMany({ where: { discussionId: { not: null } } })).map(
        (row) => row.discussionId,
      ),
    ).toEqual(['other-thread']);
    expect((await prisma.evaluationWindow.findMany()).map((row) => row.pageId)).toEqual([
      FOREIGN_PAGE,
    ]);
    expect((await prisma.pendingAction.findMany()).map((row) => row.proposedByRunId)).toEqual([
      'production-run',
    ]);
    expect((await prisma.systemDiscussion.findMany()).map((row) => row.discussionId)).toEqual([
      'other-thread',
    ]);
    expect(trashed).toEqual([COMPACT]);
  });

  it('an empty residue touches nothing', async () => {
    await seed();

    expect(await cleanup.clean(emptyResidue())).toEqual([]);

    expect(await prisma.notificationOutbox.count()).toBe(4);
    expect(await prisma.scheduledCheck.count()).toBe(5);
    expect(await prisma.evaluationWindow.count()).toBe(2);
    expect(await prisma.pendingAction.count()).toBe(2);
    expect(await prisma.systemDiscussion.count()).toBe(3);
  });
});
