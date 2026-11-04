import { addHours, isAfter, subDays, subHours, subMinutes } from 'date-fns';
import { SAFETY_RECHECK_MAX_AGE_DAYS } from '../../src/continuations/scheduled-check.rows';
import { SweepRule } from '../../src/generated/prisma/enums';
import { sweepConfig } from '../../src/sweeps/sweep.config';
import { Candidate } from '../../src/sweeps/sweep.finder';
import { truncateAll } from './database';
import { completedRun, eventAbout, failedRun } from './ledger-rows';
import { SweepsWorld, sweepsWorld } from './sweeps.harness';

/**
 * The periodic safety sweep against a real database: whom it wakes, whom it does not, and how
 * many (`docs/2-system.md` § “Periodic safety sweep”).
 */
describe('periodic safety sweep', () => {
  const config = sweepConfig();
  let world: SweepsWorld;

  beforeAll(async () => {
    world = await sweepsWorld();
  });

  beforeEach(async () => {
    await truncateAll(world.prisma);
    world.finder.candidates = [];
    world.launcher.reset();
  });

  afterAll(async () => {
    await world.close();
  });

  const candidate = (pageId: string, overrides: Partial<Candidate> = {}): Candidate => ({
    pageId,
    rule: 'check_date_reached',
    basis: 'date:2026-10-15/',
    since: subHours(new Date(), 3),
    pages: [pageId],
    ...overrides,
  });

  const rechecks = (): Promise<{ notionPageId: string; discussionId: string | null }[]> =>
    world.prisma.scheduledCheck.findMany({
      where: { reasonCode: 'safety_recheck', status: { in: ['pending', 'running'] } },
      select: { notionPageId: true, discussionId: true },
      orderBy: { createdAt: 'asc' },
    });

  it('wakes a page with a `safety_recheck` continuation with no thread, due immediately', async () => {
    world.finder.candidates = [candidate('page-1')];

    await expect(world.sweep.sweep()).resolves.toBe(1);

    const [row] = await world.prisma.scheduledCheck.findMany();

    expect(row).toMatchObject({
      notionPageId: 'page-1',
      discussionId: null,
      reasonCode: 'safety_recheck',
      status: 'pending',
    });
    expect(isAfter(row.runAt, new Date())).toBe(false);
  });

  /**
   * Without that memory, an overdue `Waiting For` would wake a run on every tick until the person
   * changes the date.
   */
  it('does not wake twice on the same basis, even when no run took place', async () => {
    world.finder.candidates = [candidate('page-1')];

    await world.sweep.sweep();
    await world.prisma.scheduledCheck.updateMany({ data: { status: 'failed' } });

    await expect(world.sweep.sweep()).resolves.toBe(0);
  });

  it('a new basis for the same page is a new situation', async () => {
    world.finder.candidates = [candidate('page-1', { basis: 'near:2026-10-17/' })];
    await world.sweep.sweep();
    await world.prisma.scheduledCheck.updateMany({ data: { status: 'failed' } });

    world.finder.candidates = [candidate('page-1', { basis: 'passed:2026-10-17/' })];

    await expect(world.sweep.sweep()).resolves.toBe(1);
  });

  it('leaves a situation older than the recency threshold to a review', async () => {
    world.finder.candidates = [
      candidate('page-1', { since: subHours(new Date(), config.recencyHours + 1) }),
    ];

    await expect(world.sweep.sweep()).resolves.toBe(0);
    await expect(rechecks()).resolves.toEqual([]);
  });

  describe('the page is already being worked on', () => {
    it('an open continuation of any thread', async () => {
      await world.prisma.scheduledCheck.create({
        data: {
          discussionId: 'discussion-1',
          notionPageId: 'page-1',
          runAt: addHours(new Date(), 24),
          reasonCode: 'await_external_event',
        },
      });
      world.finder.candidates = [candidate('page-1')];

      await expect(world.sweep.sweep()).resolves.toBe(0);
    });

    it('an open proposal', async () => {
      await world.prisma.pendingAction.create({
        data: { notionPageId: 'page-1', fingerprint: 'fp-1', effects: [], preconditions: [] },
      });
      world.finder.candidates = [candidate('page-1')];

      await expect(world.sweep.sweep()).resolves.toBe(0);
    });

    /** No mark is written: if the window closes without a run, the situation can still be woken. */
    it('an open evaluation window, and once it is closed the page is woken', async () => {
      const window = await world.prisma.evaluationWindow.create({
        data: {
          pageId: 'page-1',
          latestEventId: 'event-1',
          latestEventType: 'page.properties_updated',
          latestEventAt: new Date(),
          notBefore: new Date(),
        },
      });
      world.finder.candidates = [candidate('page-1')];

      await expect(world.sweep.sweep()).resolves.toBe(0);

      await world.prisma.evaluationWindow.update({
        where: { id: window.id },
        data: { status: 'failed' },
      });

      await expect(world.sweep.sweep()).resolves.toBe(1);
    });
  });

  describe('a run has already seen the situation', () => {
    const traceAbout = (pageId: string, createdAt: Date, completed = true): Promise<unknown> =>
      world.prisma.runTrace.create({
        data: (completed ? completedRun : failedRun)(0, { createdAt }, eventAbout(pageId)),
      });

    it('a run about a page of the situation after the situation arose does not wake the page', async () => {
      await traceAbout('task-2', subHours(new Date(), 1));
      world.finder.candidates = [candidate('project-1', { pages: ['project-1', 'task-2'] })];

      await expect(world.sweep.sweep()).resolves.toBe(0);
    });

    it('a run from before the situation arose wakes the page', async () => {
      await traceAbout('project-1', subHours(new Date(), 5));
      world.finder.candidates = [candidate('project-1')];

      await expect(world.sweep.sweep()).resolves.toBe(1);
    });

    it('does not count a failed run', async () => {
      await traceAbout('project-1', subHours(new Date(), 1), false);
      world.finder.candidates = [candidate('project-1')];

      await expect(world.sweep.sweep()).resolves.toBe(1);
    });
  });

  describe('limits', () => {
    const many = (count: number, rule: SweepRule): Candidate[] =>
      Array.from({ length: count }, (_, index) => candidate(`${rule}-${index}`, { rule }));

    it('per tick at most the limit, deadlines first', async () => {
      world.finder.candidates = [
        ...many(4, 'project_closure'),
        ...many(2, 'check_date_reached'),
        ...many(2, 'deadline_signal'),
      ];

      await expect(world.sweep.sweep()).resolves.toBe(config.wakesPerTick);

      const woken = (await rechecks()).map((row) => row.notionPageId);

      expect(woken.slice(0, 4).sort()).toEqual([
        'check_date_reached-0',
        'check_date_reached-1',
        'deadline_signal-0',
        'deadline_signal-1',
      ]);
      expect(woken[4]).toMatch(/^project_closure-/);
    });

    it('per day at most the limit, together with those already woken', async () => {
      await world.prisma.sweepMark.createMany({
        data: Array.from({ length: config.wakesPerDay - 2 }, (_, index) => ({
          pageId: `earlier-${index}`,
          rule: 'check_date_reached' as const,
          basisHash: `hash-${index}`,
          wokeAt: subMinutes(new Date(), 1),
        })),
      });
      world.finder.candidates = many(4, 'deadline_signal');

      await expect(world.sweep.sweep()).resolves.toBe(2);
    });

    it('when the daily limit is exhausted the tick does not read Notion', async () => {
      await world.prisma.sweepMark.createMany({
        data: Array.from({ length: config.wakesPerDay }, (_, index) => ({
          pageId: `earlier-${index}`,
          rule: 'check_date_reached' as const,
          basisHash: `hash-${index}`,
          wokeAt: subMinutes(new Date(), 1),
        })),
      });
      world.finder.candidates = many(4, 'deadline_signal');
      world.finder.asked = 0;

      await expect(world.sweep.sweep()).resolves.toBe(0);
      expect(world.finder.asked).toBe(0);
    });

    it('forgets marks older than the recency threshold', async () => {
      await world.prisma.sweepMark.create({
        data: {
          pageId: 'page-1',
          rule: 'check_date_reached',
          basisHash: 'old',
          wokeAt: subHours(new Date(), config.recencyHours + 1),
        },
      });

      await world.sweep.sweep();

      await expect(world.prisma.sweepMark.count()).resolves.toBe(0);
    });
  });

  it('when the run gates are closed to an autonomous run the tick does not proceed', async () => {
    world.launcher.ready = { ready: false, reason: 'notion: needs-auth' };
    world.finder.candidates = [candidate('page-1')];

    await expect(world.sweep.sweep()).resolves.toBe(0);
    await expect(world.prisma.sweepMark.count()).resolves.toBe(0);
  });

  /**
   * What accumulates beyond the daily limit would otherwise use up that limit on the day the run
   * gates open.
   */
  describe('a wake with no thread that produced no run', () => {
    const recheck = (
      notionPageId: string,
      runAt: Date,
      discussionId: string | null = null,
    ): Promise<{ id: string }> =>
      world.prisma.scheduledCheck.create({
        data: { discussionId, notionPageId, runAt, reasonCode: 'safety_recheck' },
        select: { id: true },
      });

    const statusOf = async (id: string): Promise<string | undefined> =>
      (await world.prisma.scheduledCheck.findUnique({ where: { id } }))?.status;

    it('is retired when the limit has passed since its scheduled time', async () => {
      const stale = await recheck('page-1', subDays(new Date(), SAFETY_RECHECK_MAX_AGE_DAYS + 1));
      const fresh = await recheck('page-2', subDays(new Date(), SAFETY_RECHECK_MAX_AGE_DAYS - 1));

      await world.checks.retire();

      await expect(statusOf(stale.id)).resolves.toBe('failed');
      await expect(statusOf(fresh.id)).resolves.toBe('pending');
    });

    it('a thread continuation does not age', async () => {
      const threaded = await recheck(
        'page-1',
        subDays(new Date(), SAFETY_RECHECK_MAX_AGE_DAYS + 1),
        'discussion-1',
      );

      await world.checks.retire();

      await expect(statusOf(threaded.id)).resolves.toBe('pending');
    });
  });
});
