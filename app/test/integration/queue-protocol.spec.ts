import { Logger } from '@nestjs/common';
import { addHours, addMinutes, subMinutes, subSeconds } from 'date-fns';
import { EvaluationWindow, NotificationOutbox, Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { Leased } from '../../src/platform/queue/lease';
import { LeaseQueue } from '../../src/platform/queue/lease-queue';
import { afterAttempts, RetirementRule, TRACKS_UPDATES } from '../../src/platform/queue/queue.sql';
import { connectToTestDatabase, truncateAll } from './database';

/** What a test can replace in the window queue: what is open and when a row is retired. */
interface Conditions {
  readonly open: Prisma.Sql;
  readonly retireWhen: readonly RetirementRule[];
}

/**
 * The queue protocol on its own terms.
 *
 * This checks what no repository shows. The first is that **selection and retirement are
 * derived from one declaration.** Two expressions of the same fact — a positive one in
 * retirement and a negated one in selection — would drift apart with every new rule. The check
 * asks the question so that the answer does not depend on whether retirement managed to run
 * before the selection.
 *
 * The second is the disposition of a claimed row. The lease-owner fence, the release of the lease
 * and the transition timestamp live in one place, so they are checked here, once. The rules of a
 * run row — conclusion, failure, refund of the attempt — are checked by `run-row-source.spec.ts`
 * over the description of each run queue.
 */
describe('queue protocol', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  /** The window queue conditions that a test can replace with its own. */
  const STANDARD: Conditions = {
    open: Prisma.sql`"status" = ANY(ARRAY['pending', 'running']::"EvaluationWindowStatus"[])`,
    retireWhen: [afterAttempts(3)],
  };

  /** How many rows a batch claim takes in these tests. */
  const LIMIT = 5;

  const window = (attemptCount: number, pageId = `page-${attemptCount}`) =>
    prisma.evaluationWindow.create({
      data: {
        pageId,
        updatedProperties: [],
        eventTypes: ['page.properties_updated'],
        latestEventId: 'evt-1',
        latestEventType: 'page.properties_updated',
        latestEventAt: new Date(),
        notBefore: subSeconds(new Date(), 1),
        attemptCount,
      },
    });

  const row = (id: string): Promise<EvaluationWindow> =>
    prisma.evaluationWindow.findUniqueOrThrow({ where: { id } });

  /**
   * Prisma maintains `updated_at`, so the test backdates it with a raw statement. Otherwise the
   * write that sets the age would itself overwrite it with the current time.
   */
  const age = (id: string, days = 1): Promise<number> => prisma.$executeRaw`
    UPDATE "evaluation_windows"
       SET "updated_at" = now() - make_interval(days => ${days}::int)
     WHERE "id" = ${id}
  `;

  /** Checks whether the timestamp was set just now, not by creating the row a day ago. */
  const touchedJustNow = (at: Date): boolean => at.getTime() > subMinutes(new Date(), 1).getTime();

  const readWindows = (ids: string[]): Promise<EvaluationWindow[]> =>
    prisma.evaluationWindow.findMany({ where: { id: { in: ids } } });

  const windowQueue = (
    read: (ids: string[]) => Promise<EvaluationWindow[]> = readWindows,
    conditions: Conditions = STANDARD,
  ): LeaseQueue<EvaluationWindow, 'evaluation_windows'> =>
    new LeaseQueue(prisma, {
      table: 'evaluation_windows',
      open: conditions.open,
      due: Prisma.sql`"not_before" <= now()`,
      dueAt: Prisma.sql`"not_before"`,
      order: Prisma.sql`"not_before"`,
      onAttempt: [Prisma.sql`"status" = 'running'`],
      settings: () => ({ retireWhen: conditions.retireWhen, leaseSeconds: 60 }),
      read,
    });

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  describe('selection and retirement', () => {
    it('selection does not yield a row that a retirement rule would call dead', async () => {
      const doomed = await window(3);

      // Retirement is deliberately **not** called: the assertion is that selection does not rely
      // on its order.
      await expect(windowQueue().claim(doomed.id)).resolves.toBeNull();
      await expect(windowQueue().heads(Prisma.sql`"page_id"`)).resolves.toEqual([]);

      const untouched: Pick<EvaluationWindow, 'status'> = { status: 'pending' };

      await expect(row(doomed.id)).resolves.toMatchObject(untouched);
    });

    it('selection yields a row that no rule points at', async () => {
      const alive = await window(0);

      const claimed = await windowQueue().claimDue(LIMIT);

      expect(claimed.map((lease) => lease.id)).toEqual([alive.id]);
    });

    /**
     * The reason consists of two facts: why the row died and what it last failed on. Without the
     * first, “exhausted the limit” and “aged out” would read the same in the row.
     */
    it('retirement names its own reason and keeps the earlier one', async () => {
      const doomed = await window(3);

      await prisma.evaluationWindow.update({
        where: { id: doomed.id },
        data: { lastError: 'run reported failure' },
      });

      await windowQueue().retire();

      const retired: Pick<EvaluationWindow, 'status' | 'lastError'> = {
        status: 'failed',
        lastError: 'attempt limit reached (last: run reported failure)',
      };

      await expect(row(doomed.id)).resolves.toMatchObject(retired);
    });

    it('retirement without an earlier reason does not invent one', async () => {
      const doomed = await window(3);

      await windowQueue().retire();

      const retired: Pick<EvaluationWindow, 'lastError'> = { lastError: 'attempt limit reached' };

      await expect(row(doomed.id)).resolves.toMatchObject(retired);
    });

    it('retirement marks the transition', async () => {
      const doomed = await window(3);

      await age(doomed.id);
      await windowQueue().retire();

      expect(touchedJustNow((await row(doomed.id)).updatedAt)).toBe(true);
    });
  });

  describe('lease queue', () => {
    const outboxQueue = (): LeaseQueue<NotificationOutbox, 'notification_outbox'> =>
      new LeaseQueue(prisma, {
        table: 'notification_outbox',
        open: Prisma.sql`"status" = 'pending'`,
        due: Prisma.sql`("next_attempt_at" IS NULL OR "next_attempt_at" <= now())`,
        dueAt: Prisma.sql`"next_attempt_at"`,
        order: Prisma.sql`"created_at"`,
        settings: () => ({ retireWhen: [afterAttempts(8)], leaseSeconds: 60 }),
        read: (ids) => prisma.notificationOutbox.findMany({ where: { id: { in: ids } } }),
      });

    const expire = (id: string): Promise<EvaluationWindow> =>
      prisma.evaluationWindow.update({
        where: { id },
        data: { lockedUntil: subSeconds(new Date(), 1) },
      });

    /** Returns a claimed row whose transition timestamp is already old. */
    const claimOne = async (): Promise<EvaluationWindow & Leased> => {
      await window(0);

      const [claimed] = await windowQueue().claimDue(LIMIT);

      await age(claimed.id);

      return claimed;
    };

    /** Returns the same row for two leaseholders: the first is already a zombie. */
    const reclaim = async (): Promise<[EvaluationWindow & Leased, EvaluationWindow & Leased]> => {
      await window(0);

      const [first] = await windowQueue().claimDue(LIMIT);

      await expire(first.id);

      const [second] = await windowQueue().claimDue(LIMIT);

      expect(second.id).toBe(first.id);
      await age(first.id);

      return [first, second];
    };

    describe('claim', () => {
      it('yields a row with the stamp the claim set and marks the transition', async () => {
        const created = await window(0);

        await age(created.id);

        const [claimed] = await windowQueue().claimDue(LIMIT);
        const stored = await row(created.id);

        expect(claimed.lockedUntil.getTime()).toBe(stored.lockedUntil?.getTime());
        expect(touchedJustNow(stored.updatedAt)).toBe(true);
      });

      /**
       * The owner token is taken from the claim, not from the read that follows. In between, the
       * lease could have expired and the row gone to another worker: a run from that row would
       * be a second run of the same work.
       */
      const stolen: [string, Date | null][] = [
        ["another worker's stamp", addMinutes(new Date(), 10)],
        ['no stamp', null],
      ];

      it.each(stolen)(
        'a row whose lease changed before the read (%s) is not yielded',
        async (_, lock) => {
          await window(0);

          const racing = windowQueue(async (ids) => {
            await prisma.evaluationWindow.updateMany({ data: { lockedUntil: lock } });

            return readWindows(ids);
          });

          await expect(racing.claimDue(LIMIT)).resolves.toEqual([]);
        },
      );
    });

    /**
     * Run queues do not take a batch: the scheduler reads the heads, decides which row goes into
     * a run, and only then claims it — by id and under the same condition as the batch claim.
     */
    describe('heads and claim by id', () => {
      const RETRIED = Prisma.sql`"attempt_count" > 0`;

      const due = (id: string, secondsAgo: number): Promise<EvaluationWindow> =>
        prisma.evaluationWindow.update({
          where: { id },
          data: { notBefore: subSeconds(new Date(), secondsAgo) },
        });

      it('the head for each partition value is the first in queue order', async () => {
        const late = await window(0, 'late');
        const early = await window(0, 'early');
        const retried = await window(1, 'retried');

        await due(late.id, 1);
        await due(early.id, 10);
        await due(retried.id, 20);

        const heads = await windowQueue().heads(RETRIED);

        expect(heads.map((head) => head.id).sort()).toEqual([early.id, retried.id].sort());
      });

      it('heads are only the rows that can be claimed currently', async () => {
        const leased = await window(0, 'leased');
        const notYet = await window(0, 'not-yet');

        await window(3, 'spent');
        await prisma.evaluationWindow.update({
          where: { id: leased.id },
          data: { lockedUntil: addMinutes(new Date(), 10) },
        });
        await prisma.evaluationWindow.update({
          where: { id: notYet.id },
          data: { notBefore: addMinutes(new Date(), 10) },
        });

        await expect(windowQueue().heads(RETRIED)).resolves.toEqual([]);
      });

      it('a claim by id yields the claim stamp and leaves the status untouched', async () => {
        const created = await window(0);

        const claimed = await windowQueue().claim(created.id);
        const stored = await row(created.id);

        expect(claimed?.lockedUntil.getTime()).toBe(stored.lockedUntil?.getTime());
        expect(stored.status).toBe('pending');
      });

      const unclaimable: [string, Prisma.EvaluationWindowUpdateInput][] = [
        ['under a live lease', { lockedUntil: addMinutes(new Date(), 10) }],
        ['not yet due', { notBefore: addMinutes(new Date(), 10) }],
        ['already concluded', { status: 'done' }],
        ['that has used up its attempts', { attemptCount: 3 }],
      ];

      it.each(unclaimable)('a row %s is not claimed', async (_, data) => {
        const created = await window(0);

        await prisma.evaluationWindow.update({ where: { id: created.id }, data });

        await expect(windowQueue().claim(created.id)).resolves.toBeNull();
      });

      it('an expired lease allows a new claim with a new stamp', async () => {
        const created = await window(0);
        const first = await windowQueue().claim(created.id);

        await expire(created.id);

        const second = await windowQueue().claim(created.id);

        expect(first).not.toBeNull();
        expect(second?.lockedUntil.getTime()).toBeGreaterThan(first?.lockedUntil.getTime() ?? 0);
      });

      it('a row whose lease changed before the read is not yielded', async () => {
        const created = await window(0);
        const racing = windowQueue(async (ids) => {
          await prisma.evaluationWindow.updateMany({
            data: { lockedUntil: addMinutes(new Date(), 10) },
          });

          return readWindows(ids);
        });

        await expect(racing.claim(created.id)).resolves.toBeNull();
      });
    });

    describe('dispositions under the fence', () => {
      it('writes its own changes, releases the lease and marks the transition', async () => {
        const claimed = await claimOne();

        await expect(
          windowQueue().fenced(claimed, [Prisma.sql`"last_error" = 'settled'`]),
        ).resolves.toBe(true);

        const after = await row(claimed.id);
        const expected: Pick<EvaluationWindow, 'lockedUntil' | 'lastError'> = {
          lockedUntil: null,
          lastError: 'settled',
        };

        expect(after).toMatchObject(expected);
        expect(touchedJustNow(after.updatedAt)).toBe(true);
      });

      it('a stale stamp applies nothing', async () => {
        const [first, second] = await reclaim();

        await expect(
          windowQueue().fenced(first, [Prisma.sql`"last_error" = 'zombie'`]),
        ).resolves.toBe(false);

        const after = await row(first.id);

        expect(after.lockedUntil?.getTime()).toBe(second.lockedUntil.getTime());
        expect(after.lastError).toBeNull();
        expect(touchedJustNow(after.updatedAt)).toBe(false);
      });

      it('a false condition leaves both the row and the lease', async () => {
        const claimed = await claimOne();

        await expect(
          windowQueue().fenced(
            claimed,
            [Prisma.sql`"last_error" = 'settled'`],
            [Prisma.sql`FALSE`],
          ),
        ).resolves.toBe(false);

        const after = await row(claimed.id);

        expect(after.lockedUntil?.getTime()).toBe(claimed.lockedUntil.getTime());
        expect(after.lastError).toBeNull();
      });

      /**
       * The delivery queue has no `updated_at`, and writing the timestamp there would be a query
       * error. Every statement that writes to the table is checked: retirement, claim, attempt,
       * disposition.
       */
      it('writes no timestamp in a table without `updated_at`', async () => {
        const outbox = outboxQueue();

        await prisma.notificationOutbox.createMany({
          data: [
            { idempotencyKey: 'live', channel: 'telegram', payload: {} },
            { idempotencyKey: 'spent', channel: 'telegram', payload: {}, attemptCount: 8 },
          ],
        });

        const [claimed] = await outbox.claimDue(LIMIT);

        await expect(outbox.recordAttempt(claimed)).resolves.toBe(1);
        await expect(outbox.fenced(claimed, [Prisma.sql`"status" = 'sent'`])).resolves.toBe(true);

        const statuses = await prisma.notificationOutbox.findMany({
          select: { idempotencyKey: true, status: true },
          orderBy: { idempotencyKey: 'asc' },
        });
        const expected: Pick<NotificationOutbox, 'idempotencyKey' | 'status'>[] = [
          { idempotencyKey: 'live', status: 'sent' },
          { idempotencyKey: 'spent', status: 'failed' },
        ];

        expect(statuses).toEqual(expected);
      });
    });

    /**
     * A disposition that was not applied because the lease expired leaves a log entry: silence
     * would be the only place where the fact that the work was most likely done twice gets lost.
     * The log entry is left by the queue itself, not by the code that issued the disposition.
     */
    describe('lost lease', () => {
      let warned: jest.SpyInstance;

      beforeEach(() => {
        warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      const zombies: [
        string,
        string,
        (
          queue: LeaseQueue<EvaluationWindow, 'evaluation_windows'>,
          zombie: Leased,
        ) => Promise<unknown>,
      ][] = [
        ['disposition', 'settle', (queue, zombie) => queue.dispose(zombie, 'settle', [])],
        ['release', 'release', (queue, zombie) => queue.release(zombie)],
        [
          'postponement',
          'postpone',
          (queue, zombie) => queue.postpone(zombie, addHours(new Date(), 1), 'zombie'),
        ],
        [
          'postponement with its own name',
          'retry',
          (queue, zombie) => queue.postpone(zombie, addHours(new Date(), 1), 'zombie', 'retry'),
        ],
        ['attempt recording', 'attempt', (queue, zombie) => queue.recordAttempt(zombie)],
      ];

      it.each(zombies)('a late %s leaves a log entry', async (_, step, act) => {
        const [first] = await reclaim();

        await act(windowQueue(), first);

        expect(warned).toHaveBeenCalledTimes(1);
        expect(warned).toHaveBeenCalledWith(
          `evaluation_windows ${first.id}: lease expired before "${step}" was recorded`,
        );
      });

      it('a disposition under a live lease leaves no log entry', async () => {
        const claimed = await claimOne();

        await windowQueue().release(claimed);

        expect(warned).not.toHaveBeenCalled();
      });

      /**
       * A false condition is not a lost lease: this is how a conclusion tells “changed” from
       * “lost”.
       */
      it('a false disposition condition leaves no log entry', async () => {
        const claimed = await claimOne();

        await windowQueue().fenced(claimed, [], [Prisma.sql`FALSE`]);

        expect(warned).not.toHaveBeenCalled();
      });
    });

    /** There was no work: the lease is released and the row's time stays as it was (`INV-084`). */
    describe('release', () => {
      it('releases only the lease, with no work done', async () => {
        const claimed = await claimOne();
        const before = await row(claimed.id);

        await expect(windowQueue().release(claimed)).resolves.toBe(true);

        const after = await row(claimed.id);
        const expected: EvaluationWindow = {
          ...before,
          lockedUntil: null,
          updatedAt: after.updatedAt,
        };

        expect(after).toEqual(expected);
        expect(touchedJustNow(after.updatedAt)).toBe(true);
      });

      it('with a stale stamp applies nothing', async () => {
        const [first, second] = await reclaim();
        const queue = windowQueue();

        await queue.recordAttempt(second);

        await expect(queue.release(first)).resolves.toBe(false);

        const expected: Pick<EvaluationWindow, 'attemptCount' | 'lastError'> = {
          attemptCount: 1,
          lastError: null,
        };
        const after = await row(first.id);

        expect(after).toMatchObject(expected);
        expect(after.lockedUntil?.getTime()).toBe(second.lockedUntil.getTime());
      });
    });

    /**
     * Postponement exists only in the delivery queue: quiet hours and backoff move a row that is
     * not yet due.
     */
    describe('postponement', () => {
      it('moves the time of the row, releases the lease and leaves attempts untouched', async () => {
        const outbox = outboxQueue();
        const until = addHours(new Date(), 1);

        await prisma.notificationOutbox.create({
          data: { idempotencyKey: 'quiet', channel: 'telegram', payload: {} },
        });

        const [claimed] = await outbox.claimDue(LIMIT);

        await expect(outbox.postpone(claimed, until, 'quiet hours')).resolves.toBe(true);

        const expected: Pick<
          NotificationOutbox,
          'nextAttemptAt' | 'lockedUntil' | 'lastError' | 'attemptCount'
        > = {
          nextAttemptAt: until,
          lockedUntil: null,
          lastError: 'quiet hours',
          attemptCount: 0,
        };

        await expect(
          prisma.notificationOutbox.findUniqueOrThrow({ where: { id: claimed.id } }),
        ).resolves.toMatchObject(expected);
      });

      it('a stale stamp moves nothing', async () => {
        const [first] = await reclaim();
        const before = await row(first.id);

        await expect(
          windowQueue().postpone(first, addHours(new Date(), 1), 'zombie'),
        ).resolves.toBe(false);

        const after = await row(first.id);

        expect(after.notBefore).toEqual(before.notBefore);
        expect(after.lastError).toBeNull();
      });
    });

    describe('attempt recording', () => {
      it('writes along with the attempt whatever the queue tells it to write', async () => {
        const claimed = await claimOne();

        await expect(row(claimed.id).then((stored) => stored.status)).resolves.toBe('pending');
        await windowQueue().recordAttempt(claimed);
        await expect(row(claimed.id).then((stored) => stored.status)).resolves.toBe('running');
      });

      it('returns the new attempt count, keeps the lease and marks the transition', async () => {
        const claimed = await claimOne();
        const queue = windowQueue();

        await expect(queue.recordAttempt(claimed)).resolves.toBe(1);
        await expect(queue.recordAttempt(claimed)).resolves.toBe(2);

        const after = await row(claimed.id);

        expect(after.lockedUntil?.getTime()).toBe(claimed.lockedUntil.getTime());
        expect(touchedJustNow(after.updatedAt)).toBe(true);
      });

      it('a lease held by another worker returns `null` and no attempt is recorded', async () => {
        const [first] = await reclaim();

        await expect(windowQueue().recordAttempt(first)).resolves.toBeNull();

        const unpaid: Pick<EvaluationWindow, 'attemptCount'> = { attemptCount: 0 };

        await expect(row(first.id)).resolves.toMatchObject(unpaid);
      });
    });

    /**
     * The queue writes the condition, and an `OR` in it is legitimate: open statuses, “can be
     * taken currently or it is already time”, two rules in one. Without parentheses an `OR`
     * fragment would break out of the whole condition: selection would take rows that are not
     * yet due, retirement would touch concluded ones, and the fence would let a zombie through to
     * someone else's lease.
     */
    describe('a queue condition with `OR`', () => {
      it('does not let selection take rows that are not yet due', async () => {
        const early = await window(0, 'page-early');

        await prisma.evaluationWindow.update({
          where: { id: early.id },
          data: { notBefore: addHours(new Date(), 1) },
        });

        const alternatives = windowQueue(readWindows, {
          ...STANDARD,
          open: Prisma.sql`"status" = 'pending' OR "status" = 'running'`,
        });

        await expect(alternatives.claimDue(LIMIT)).resolves.toEqual([]);
      });

      it('in a retirement rule leaves concluded rows untouched', async () => {
        const closed = await window(0, 'page-closed');

        await prisma.evaluationWindow.update({
          where: { id: closed.id },
          data: { status: 'done' },
        });

        const either: RetirementRule = {
          when: Prisma.sql`"attempt_count" >= 3 OR "page_id" = 'page-closed'`,
          reason: 'either',
        };

        await windowQueue(readWindows, { ...STANDARD, retireWhen: [either] }).retire();

        const kept: Pick<EvaluationWindow, 'status' | 'lastError'> = {
          status: 'done',
          lastError: null,
        };

        await expect(row(closed.id)).resolves.toMatchObject(kept);
      });

      it('does not break out of the lease-owner fence', async () => {
        const [first, second] = await reclaim();

        await expect(
          windowQueue().fenced(
            first,
            [Prisma.sql`"last_error" = 'zombie'`],
            [Prisma.sql`"version" = 99 OR TRUE`],
          ),
        ).resolves.toBe(false);

        const after = await row(first.id);

        expect(after.lockedUntil?.getTime()).toBe(second.lockedUntil.getTime());
        expect(after.lastError).toBeNull();
      });

      it('does not bypass the pruning retention period', async () => {
        const fresh = await window(0, 'page-fresh');

        await prisma.evaluationWindow.update({
          where: { id: fresh.id },
          data: { status: 'done' },
        });

        await expect(
          windowQueue().prune(2, Prisma.sql`"status" = 'done' OR "status" = 'failed'`),
        ).resolves.toBe(0);
      });
    });

    describe('pruning', () => {
      it('prunes rows with a conclusion older than the retention period from the last transition', async () => {
        const old = await window(0, 'page-old');
        const fresh = await window(0, 'page-fresh');
        const open = await window(0, 'page-open');

        await prisma.evaluationWindow.updateMany({
          where: { id: { in: [old.id, fresh.id] } },
          data: { status: 'done' },
        });
        await age(old.id, 3);
        await age(open.id, 3);

        await expect(windowQueue().prune(2, Prisma.sql`"status" = 'done'`)).resolves.toBe(1);

        const left = await prisma.evaluationWindow.findMany({
          select: { id: true },
          orderBy: { pageId: 'asc' },
        });

        expect(left.map((survivor) => survivor.id)).toEqual([fresh.id, open.id]);
      });

      /** The type says what the database says: a delivery row has nothing to count its age from. */
      it('only where the table has `updated_at`', async () => {
        const outbox = outboxQueue();

        const prune = (): Promise<number> =>
          // @ts-expect-error — the delivery queue has no transition timestamp.
          outbox.prune(7, Prisma.sql`"status" = 'sent'`);

        await expect(prune()).rejects.toThrow(/updated_at/);
      });
    });

    /**
     * The protocol sets the timestamp, and only where the map says the column exists. The map can
     * drift from the schema silently: a new column would stay without a timestamp, and a vanished
     * one would break every disposition.
     */
    it('the timestamp map matches the schema', async () => {
      const columns = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'updated_at'
      `;
      const tracked = new Set(columns.map((column) => column.table_name));
      const fromSchema: Record<string, boolean> = Object.fromEntries(
        Object.keys(TRACKS_UPDATES).map((table) => [table, tracked.has(table)]),
      );

      expect(fromSchema).toEqual(TRACKS_UPDATES);
    });
  });
});
