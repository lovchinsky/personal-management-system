import { APIErrorCode } from '@notionhq/client';
import { subDays, subMinutes } from 'date-fns';
import { sweepConfig } from '../../src/sweeps/sweep.config';
import { notionAnswer } from '../fixtures/notion-answer.fixture';
import { truncateAll } from './database';
import { SweepsWorld, sweepsWorld } from './sweeps.harness';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const BLOCK = '4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f';
const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const COMMENT = '3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e';

/**
 * Resolved-thread reconciliation against a real database, Notion stubbed
 * (`docs/2-system.md` § “Resolved-thread reconciliation”, ADR 0038).
 */
describe('INV-102 closure is requested only for a resolved thread with a known anchor, and again only after the thread has been seen open again', () => {
  const { horizonDays, anchorsPerTick } = sweepConfig().reconciliation;
  let world: SweepsWorld;

  beforeAll(async () => {
    world = await sweepsWorld();
  });

  beforeEach(async () => {
    await truncateAll(world.prisma);
    world.comments.reset();
  });

  afterAll(async () => {
    await world.close();
  });

  /**
   * Records a thread the system commented in, so the registry knows the anchor and the last
   * comment.
   */
  const written = (
    overrides: Partial<{
      discussionId: string;
      pageId: string;
      blockId: string | null;
      lastCommentId: string | null;
      lastWrittenAt: Date;
    }> = {},
  ): Promise<unknown> =>
    world.prisma.systemDiscussion.create({
      data: {
        discussionId: THREAD,
        pageId: PAGE,
        mode: 'event_evaluation',
        blockId: null,
        lastCommentId: COMMENT,
        lastWrittenAt: subMinutes(new Date(), 30),
        ...overrides,
      },
    });

  const closures = (): Promise<{ discussionId: string | null; notionPageId: string }[]> =>
    world.prisma.scheduledCheck.findMany({
      where: { reasonCode: 'resolution_reconciliation' },
      select: { discussionId: true, notionPageId: true },
    });

  /** The closure run has taken place: the row is concluded. */
  const concludeClosures = (): Promise<unknown> =>
    world.prisma.scheduledCheck.updateMany({ data: { status: 'done' } });

  it('closure when the thread is not among the unresolved and the system comment is readable', async () => {
    await written();
    world.comments.open.set(PAGE, []);
    world.comments.readable.add(COMMENT);

    await expect(world.reconciler.reconcile()).resolves.toBe(1);
    await expect(closures()).resolves.toEqual([{ discussionId: THREAD, notionPageId: PAGE }]);
  });

  it('no closure when the thread is among the unresolved', async () => {
    await written();
    world.comments.open.set(PAGE, [THREAD]);
    world.comments.readable.add(COMMENT);

    await expect(world.reconciler.reconcile()).resolves.toBe(0);
    await expect(closures()).resolves.toEqual([]);
  });

  it('no closure when the system comment is not readable: the thread has been deleted', async () => {
    await written();
    world.comments.open.set(PAGE, []);

    await expect(world.reconciler.reconcile()).resolves.toBe(0);
    await expect(closures()).resolves.toEqual([]);
  });

  /** A listing by page does not see the threads of a block: “none” there would mean nothing. */
  it('looks for a thread on a block by the block', async () => {
    await written({ blockId: BLOCK });
    world.comments.open.set(BLOCK, [THREAD]);
    world.comments.open.set(PAGE, []);
    world.comments.readable.add(COMMENT);

    await expect(world.reconciler.reconcile()).resolves.toBe(0);
    expect(world.comments.asked).toEqual([BLOCK]);
  });

  it('does not judge a thread with no known system comment and does not ask about it', async () => {
    await written({ lastCommentId: null });
    world.comments.open.set(PAGE, []);

    await expect(world.reconciler.reconcile()).resolves.toBe(0);
    expect(world.comments.asked).toEqual([]);
  });

  it('does not repeat a failed closure until it sees the thread open again', async () => {
    await written();
    world.comments.open.set(PAGE, []);
    world.comments.readable.add(COMMENT);

    await world.reconciler.reconcile();
    await world.prisma.scheduledCheck.updateMany({ data: { status: 'failed' } });

    await expect(world.reconciler.reconcile()).resolves.toBe(0);

    world.comments.open.set(PAGE, [THREAD]);
    await world.reconciler.reconcile();
    world.comments.open.set(PAGE, []);

    await expect(world.reconciler.reconcile()).resolves.toBe(1);
  });

  it('closes again a thread resolved a second time after a completed closure', async () => {
    await written();
    world.comments.readable.add(COMMENT);
    world.comments.open.set(PAGE, []);
    await world.reconciler.reconcile();
    await concludeClosures();

    world.comments.open.set(PAGE, [THREAD]);
    await world.reconciler.reconcile();
    world.comments.open.set(PAGE, []);

    await expect(world.reconciler.reconcile()).resolves.toBe(1);
    await expect(closures()).resolves.toHaveLength(2);
  });

  it('when Notion does not answer, the tick says nothing about the thread', async () => {
    await written();
    world.comments.readable.add(COMMENT);
    world.comments.failure = notionAnswer(APIErrorCode.RateLimited, 429);

    await expect(world.reconciler.reconcile()).resolves.toBe(0);

    world.comments.failure = undefined;
    world.comments.open.set(PAGE, []);

    await expect(world.reconciler.reconcile()).resolves.toBe(1);
  });

  /**
   * An anchor is a unit of work: an anchor on which the read fails does not stop the tick, and
   * the question about it counts as asked, so it does not become first again and does not block
   * the rest.
   */
  it('an anchor on which the read fails does not stop the tick and does not become first again', async () => {
    const OTHER_PAGE = '5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a';
    const OTHER_THREAD = '6e7f8a9b-0c1d-4e2f-9a3b-4c5d6e7f8a9b';
    const OTHER_COMMENT = '7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b0c';

    await written();
    await written({ discussionId: OTHER_THREAD, pageId: OTHER_PAGE, lastCommentId: OTHER_COMMENT });
    world.comments.failing.set(PAGE, new TypeError('broken response'));
    world.comments.open.set(OTHER_PAGE, []);
    world.comments.readable.add(OTHER_COMMENT);

    await expect(world.reconciler.reconcile()).resolves.toBe(1);
    await expect(closures()).resolves.toEqual([
      { discussionId: OTHER_THREAD, notionPageId: OTHER_PAGE },
    ]);
    await expect(
      world.prisma.discussionReconciliation.findUniqueOrThrow({ where: { discussionId: THREAD } }),
    ).resolves.toMatchObject({ checkedAt: expect.any(Date) });
  });

  describe('scope', () => {
    it('a thread the system has not commented in for a long time is out of scope', async () => {
      await written({ lastWrittenAt: subDays(new Date(), horizonDays + 1) });
      world.comments.open.set(PAGE, []);
      world.comments.readable.add(COMMENT);

      await expect(world.reconciler.reconcile()).resolves.toBe(0);
      expect(world.comments.asked).toEqual([]);
    });

    /**
     * A thread awaiting the person's reply has no continuation: the age of the write keeps it in
     * scope.
     */
    it('an old thread with an open continuation is in scope', async () => {
      await written({ lastWrittenAt: subDays(new Date(), horizonDays + 1) });
      await world.prisma.scheduledCheck.create({
        data: {
          discussionId: THREAD,
          notionPageId: PAGE,
          runAt: subDays(new Date(), -3),
          reasonCode: 'await_external_event',
        },
      });
      world.comments.open.set(PAGE, []);
      world.comments.readable.add(COMMENT);

      await expect(world.reconciler.reconcile()).resolves.toBe(1);
    });

    it('an old thread with an open proposal is in scope', async () => {
      await written({ lastWrittenAt: subDays(new Date(), horizonDays + 1) });
      await world.prisma.pendingAction.create({
        data: {
          discussionId: THREAD,
          notionPageId: PAGE,
          fingerprint: 'fp-1',
          effects: [],
          preconditions: [],
        },
      });
      world.comments.open.set(PAGE, []);
      world.comments.readable.add(COMMENT);

      await expect(world.reconciler.reconcile()).resolves.toBe(1);
    });

    it('prunes the memory of a thread that is out of scope', async () => {
      await world.prisma.discussionReconciliation.create({
        data: { discussionId: 'gone-thread', seenOpenAt: new Date() },
      });

      await world.reconciler.reconcile();

      await expect(world.prisma.discussionReconciliation.count()).resolves.toBe(0);
    });
  });

  it('asks about no more than the limit of anchors per tick, first those it asked about longest ago', async () => {
    const pages = Array.from(
      { length: anchorsPerTick + 2 },
      (_, index) => `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );

    for (const [index, page] of pages.entries()) {
      await written({ discussionId: `thread-${index}`, pageId: page });
      world.comments.open.set(page, [`thread-${index}`]);
    }

    await world.reconciler.reconcile();
    expect(world.comments.asked).toHaveLength(anchorsPerTick);

    const first = new Set(world.comments.asked);

    world.comments.asked.length = 0;
    await world.reconciler.reconcile();

    expect(world.comments.asked.filter((anchor) => !first.has(anchor))).toHaveLength(2);
  });
});
