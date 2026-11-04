import { Test, TestingModule } from '@nestjs/testing';
import { addMinutes, addSeconds, subDays, subHours, subMinutes, subSeconds } from 'date-fns';
import { AttentionService } from '../../src/attention/attention.service';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { EvaluationWindowStatus, ScheduledCheckStatus } from '../../src/generated/prisma/enums';
import {
  evaluationWindowConfig,
  type EvaluationWindowConfig,
} from '../../src/intake/notion/evaluation-window.config';
import { evaluationWindowRows } from '../../src/intake/notion/evaluation-window.rows';
import { EvaluationWindowRunSource } from '../../src/intake/notion/evaluation-window.run-source';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { budgetConfig } from '../../src/runs/budget.config';
import { Disposition } from '../../src/runs/disposition';
import { RunRowSource } from '../../src/runs/run-row-source';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { ClaimedRun, RunCandidate } from '../../src/runs/run-source';
import { runsConfig } from '../../src/runs/runs.config';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';
import { due } from './queue-rows';

/** What the rules see of a row: the same in every run queue. */
interface RowState {
  readonly status: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: Date | null;
  readonly lockedUntil: Date | null;
  readonly lastError: string | null;
  readonly updatedAt: Date;
  /** The row's time: the column from which the queue derives “due” and the order. */
  readonly moment: Date;
  /**
   * The time until which the row waits for Notion and the time since which it has waited
   * consecutively (ADR 0045).
   */
  readonly notionHoldUntil: Date | null;
  readonly notionHeldSince: Date | null;
}

/** A run queue as the scheduler and pruning see it. */
interface Rows {
  retire(): Promise<void>;
  candidates(): Promise<RunCandidate[]>;
  claim(id: string): Promise<ClaimedRun | null>;
  pruneConcluded(days: number): Promise<number>;
  releaseNotionHolds(previous?: Date): Promise<number>;
}

/** The run queue under test: its source and how the test prepares its rows. */
interface Queue {
  readonly rows: () => Rows;
  /** A due row; `key` tells apart rows of one queue and one class. */
  readonly seed: (key: string, attempts?: number, dueAt?: Date) => Promise<string>;
  readonly state: (id: string) => Promise<RowState>;
  /** The producer changed the row while the run was in flight. */
  readonly change: (id: string) => Promise<void>;
  /** Why the changed row was not concluded. */
  readonly superseded: string;
  /** A row that every retirement rule of the queue points at. */
  readonly doom: (id: string) => Promise<void>;
  readonly settle: (id: string, status: 'done' | 'failed') => Promise<void>;
  /** A transition timestamp `days` days ago. */
  readonly age: (id: string, days: number) => Promise<void>;
  /** The lease has expired: the row can be claimed again. */
  readonly expire: (id: string) => Promise<void>;
  /** The row waits for Notion until `until`, and has waited consecutively since `since`. */
  readonly hold: (id: string, until: Date, since: Date) => Promise<void>;
}

/**
 * The rules of a run row (`RunRowSource`, ADR 0018), over the real description of each run
 * queue.
 *
 * The rules are shared and each queue has its own description, so each rule is checked over
 * both: a description that breaks the rule for its queue fails that queue's row here. The
 * lease-owner fence covers every disposition, including the attempt: a zombie whose lease was
 * reclaimed changes nothing (`INV-082`).
 */
describe('run row rules', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  const MAX_ATTEMPTS = budgetConfig().workRowMaxAttempts;
  const TICKET_SECONDS = runsConfig().ticketSeconds;
  const STALE_DAYS = evaluationWindowConfig().maxAgeDays + 1;

  /** There is no thread the system manages here: the window is an ordinary page change. */
  const attention: Pick<AttentionService, 'managed'> = { managed: () => Promise.resolve(null) };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, evaluationWindowConfig, budgetConfig, runsConfig)],
      providers: [
        PrismaService,
        RunRowPolicy,
        EvaluationWindowRunSource,
        ScheduledCheckRunSource,
        { provide: AttentionService, useValue: attention },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const windows: Queue = {
    rows: () => moduleRef.get(EvaluationWindowRunSource),
    seed: async (key, attempts = 0, dueAt = due()) => {
      const created = await prisma.evaluationWindow.create({
        data: {
          pageId: `page-${key}`,
          updatedProperties: [],
          eventTypes: ['page.properties_updated'],
          latestEventId: `evt-${key}`,
          latestEventType: 'page.properties_updated',
          latestEventAt: new Date(),
          notBefore: dueAt,
          attemptCount: attempts,
        },
      });

      return created.id;
    },
    state: async (id) => {
      const row = await prisma.evaluationWindow.findUniqueOrThrow({ where: { id } });

      return {
        status: row.status,
        attemptCount: row.attemptCount,
        lastAttemptAt: row.lastAttemptAt,
        lockedUntil: row.lockedUntil,
        lastError: row.lastError,
        updatedAt: row.updatedAt,
        moment: row.notBefore,
        notionHoldUntil: row.notionHoldUntil,
        notionHeldSince: row.notionHeldSince,
      };
    },
    change: async (id) => {
      await prisma.evaluationWindow.update({ where: { id }, data: { version: { increment: 1 } } });
    },
    superseded: 'window changed while the run was in flight',
    // Both rules of the window: the attempt limit and aging.
    doom: async (id) => {
      await prisma.evaluationWindow.update({
        where: { id },
        data: {
          attemptCount: MAX_ATTEMPTS,
          latestEventAt: subDays(new Date(), STALE_DAYS),
        },
      });
    },
    settle: async (id, status) => {
      await prisma.evaluationWindow.update({
        where: { id },
        data: { status: EvaluationWindowStatus[status] },
      });
    },
    age: async (id, days) => {
      await prisma.$executeRaw`
        UPDATE "evaluation_windows"
           SET "updated_at" = now() - make_interval(days => ${days}::int)
         WHERE "id" = ${id}
      `;
    },
    expire: async (id) => {
      await prisma.evaluationWindow.update({
        where: { id },
        data: { lockedUntil: subSeconds(new Date(), 1) },
      });
    },
    hold: async (id, until, since) => {
      await prisma.evaluationWindow.update({
        where: { id },
        data: { notionHoldUntil: until, notionHeldSince: since },
      });
    },
  };

  const checks: Queue = {
    rows: () => moduleRef.get(ScheduledCheckRunSource),
    seed: async (key, attempts = 0, dueAt = due()) => {
      const created = await prisma.scheduledCheck.create({
        data: {
          notionPageId: `page-${key}`,
          runAt: dueAt,
          reasonCode: 'safety_recheck',
          attemptCount: attempts,
        },
      });

      return created.id;
    },
    state: async (id) => {
      const row = await prisma.scheduledCheck.findUniqueOrThrow({ where: { id } });

      return {
        status: row.status,
        attemptCount: row.attemptCount,
        lastAttemptAt: row.lastAttemptAt,
        lockedUntil: row.lockedUntil,
        lastError: row.lastError,
        updatedAt: row.updatedAt,
        moment: row.runAt,
        notionHoldUntil: row.notionHoldUntil,
        notionHeldSince: row.notionHeldSince,
      };
    },
    change: async (id) => {
      await prisma.scheduledCheck.update({ where: { id }, data: { version: { increment: 1 } } });
    },
    superseded: 'continuation moved while the run was in flight',
    // A continuation has one rule: the attempt limit.
    doom: async (id) => {
      await prisma.scheduledCheck.update({ where: { id }, data: { attemptCount: MAX_ATTEMPTS } });
    },
    settle: async (id, status) => {
      await prisma.scheduledCheck.update({
        where: { id },
        data: { status: ScheduledCheckStatus[status] },
      });
    },
    age: async (id, days) => {
      await prisma.$executeRaw`
        UPDATE "scheduled_checks"
           SET "updated_at" = now() - make_interval(days => ${days}::int)
         WHERE "id" = ${id}
      `;
    },
    expire: async (id) => {
      await prisma.scheduledCheck.update({
        where: { id },
        data: { lockedUntil: subSeconds(new Date(), 1) },
      });
    },
    hold: async (id, until, since) => {
      await prisma.scheduledCheck.update({
        where: { id },
        data: { notionHoldUntil: until, notionHeldSince: since },
      });
    },
  };

  const queues: [string, Queue][] = [
    ['evaluation windows', windows],
    ['continuations', checks],
  ];

  describe.each(queues)('%s', (_, queue) => {
    /** Claims a row the way the scheduler takes it: by id, right before the run. */
    const claim = async (id: string): Promise<ClaimedRun> => {
      const claimed = await queue.rows().claim(id);
      if (!claimed) {
        throw new Error(`${id} could not be claimed`);
      }

      return claimed;
    };

    const touchedJustNow = (at: Date): boolean =>
      at.getTime() > subMinutes(new Date(), 1).getTime();

    it('the lease lasts the ticket lifetime', async () => {
      const id = await queue.seed('one');
      const before = new Date();

      await claim(id);

      const { lockedUntil } = await queue.state(id);
      // The database clock sets the stamp and the process clock computes the bounds: the slack
      // covers their discrepancy, and the assertion is about the order of magnitude.
      const slack = 5;

      expect(lockedUntil?.getTime()).toBeGreaterThanOrEqual(
        addSeconds(before, TICKET_SECONDS - slack).getTime(),
      );
      expect(lockedUntil?.getTime()).toBeLessThanOrEqual(
        addSeconds(new Date(), TICKET_SECONDS + slack).getTime(),
      );
    });

    /** `running` means the run has started: a claim does not set it, an attempt does. */
    it('an attempt writes `running` and the attempt time and keeps the lease', async () => {
      const id = await queue.seed('one');
      const claimed = await claim(id);
      const leased = await queue.state(id);

      expect(leased.status).toBe('pending');
      await expect(claimed.recordAttempt()).resolves.toBe(true);

      const attempted = await queue.state(id);
      const expected: Pick<RowState, 'status' | 'attemptCount' | 'lockedUntil'> = {
        status: 'running',
        attemptCount: 1,
        lockedUntil: leased.lockedUntil,
      };

      expect(attempted).toMatchObject(expected);
      expect(attempted.lastAttemptAt).not.toBeNull();
    });

    it('an unchanged row is concluded and marks the transition', async () => {
      const id = await queue.seed('one');
      const claimed = await claim(id);

      await queue.age(id, 1);

      await expect(claimed.conclude(false)).resolves.toBe('closed');

      const after = await queue.state(id);
      const expected: Pick<RowState, 'status' | 'lockedUntil'> = {
        status: 'done',
        lockedUntil: null,
      };

      expect(after).toMatchObject(expected);
      expect(touchedJustNow(after.updatedAt)).toBe(true);
    });

    it('a row changed during the run stays open and the attempt is refunded', async () => {
      const id = await queue.seed('one');
      const claimed = await claim(id);

      await claimed.recordAttempt();
      await queue.change(id);

      await expect(claimed.conclude(false)).resolves.toBe('superseded');

      const expected: Pick<RowState, 'status' | 'lockedUntil' | 'attemptCount' | 'lastError'> = {
        // The row's run started, so it is `running`; it stays open.
        status: 'running',
        lockedUntil: null,
        attemptCount: 0,
        lastError: queue.superseded,
      };

      await expect(queue.state(id)).resolves.toMatchObject(expected);
    });

    it('a refunded attempt does not take the counter below zero', async () => {
      const id = await queue.seed('one');
      const claimed = await claim(id);

      await queue.change(id);

      await expect(claimed.conclude(false)).resolves.toBe('superseded');
      await expect(queue.state(id).then((row) => row.attemptCount)).resolves.toBe(0);
    });

    it('no run took place: the row is the same, only without the lease', async () => {
      const id = await queue.seed('one');
      const claimed = await claim(id);
      const before = await queue.state(id);

      await expect(claimed.release()).resolves.toBe(true);

      const after = await queue.state(id);
      const expected: RowState = { ...before, lockedUntil: null, updatedAt: after.updatedAt };

      expect(after).toEqual(expected);
    });

    it('a failure writes the reason and leaves the attempt spent', async () => {
      const id = await queue.seed('one');
      const claimed = await claim(id);

      await claimed.recordAttempt();

      await expect(claimed.fail('run reported failure', false)).resolves.toBe(true);

      const expected: Pick<RowState, 'lockedUntil' | 'lastError' | 'attemptCount'> = {
        lockedUntil: null,
        lastError: 'run reported failure',
        attemptCount: 1,
      };

      await expect(queue.state(id)).resolves.toMatchObject(expected);
    });

    /**
     * The plan quota is an external limit, not a failure of the row (ADR 0012). The attempt is
     * refunded, otherwise every deferral would bring the row closer to `failed`. The time stays
     * the one the row had (`INV-084`).
     */
    it('the plan quota refunds the attempt and does not move the time', async () => {
      const id = await queue.seed('one');
      const claimed = await claim(id);
      const { moment } = await queue.state(id);

      await claimed.recordAttempt();

      await expect(claimed.refund('run deferred: plan_quota', false)).resolves.toBe(true);

      const expected: Pick<RowState, 'moment' | 'lockedUntil' | 'lastError' | 'attemptCount'> = {
        moment,
        lockedUntil: null,
        lastError: 'run deferred: plan_quota',
        attemptCount: 0,
      };

      await expect(queue.state(id)).resolves.toMatchObject(expected);
    });

    const zombies: [
      string,
      (run: ClaimedRun) => Promise<boolean | Disposition>,
      boolean | Disposition,
    ][] = [
      ['attempt recording', (run) => run.recordAttempt(), false],
      ['conclusion', (run) => run.conclude(false), 'lost'],
      ['release', (run) => run.release(), false],
      ['failure', (run) => run.fail('zombie', false), false],
      ['attempt refund', (run) => run.refund('zombie', false), false],
      ['Notion wait', (run) => run.waitForNotion('zombie'), false],
    ];

    /**
     * A run hung for longer than the lease and the next run took the row: the first run's late
     * disposition has no owner.
     */
    it.each(zombies)(
      'a late “%s” from a zombie does not change a row that another run holds',
      async (_, act, answer) => {
        const id = await queue.seed('one');
        const first = await claim(id);

        await queue.expire(id);
        await claim(id);

        const reclaimed = await queue.state(id);

        await expect(act(first)).resolves.toBe(answer);
        await expect(queue.state(id)).resolves.toEqual(reclaimed);
      },
    );

    /**
     * The reason is taken from the first rule the row falls under, and the attempt limit is the
     * first: a row that has used up its attempts is dead because of them, whatever else points at
     * it.
     */
    it('the attempt limit is the first retirement reason', async () => {
      const id = await queue.seed('one');

      await queue.doom(id);
      await queue.rows().retire();

      const expected: Pick<RowState, 'status' | 'lastError'> = {
        status: 'failed',
        lastError: 'attempt limit reached',
      };

      await expect(queue.state(id)).resolves.toMatchObject(expected);
    });

    /**
     * A retried row has already had its run and a fresh row has had none, so the scheduler must
     * see both, even when they are of the same class and the retried one came due earlier
     * (`INV-085`).
     */
    it('a fresh row and an earlier retried row of the same class are separate candidates', async () => {
      const retried = await queue.seed('retried', 1, subMinutes(new Date(), 10));
      const fresh = await queue.seed('fresh');

      const candidates = await queue.rows().candidates();
      const flags = new Map(candidates.map((candidate) => [candidate.id, candidate.retried]));
      const expected = new Map([
        [retried, true],
        [fresh, false],
      ]);

      expect(flags).toEqual(expected);
    });

    it('the run request has the same origin as the candidate and points to the row itself', async () => {
      const id = await queue.seed('one');
      const [candidate] = await queue.rows().candidates();
      const claimed = await claim(id);

      expect(claimed.request.provenance).toEqual(candidate.provenance);
      expect(claimed.request.originId).toBe(id);
    });

    /**
     * The row's run did not reach Notion (ADR 0045): the row waits under a separate mark — a pause
     * twice as long as it has already waited consecutively, from 15 minutes to an hour — while its
     * time, attempts and run priority remain its own.
     */
    describe('Notion wait', () => {
      const REASON = 'run deferred: Notion was not reached';
      const { notionHoldMinMinutes, notionHoldMaxMinutes } = runsConfig();

      /**
       * The database clock sets the stamp and the process clock computes the wait: the slack
       * covers the discrepancy.
       */
      const near = (actual: Date | null, expected: Date): void => {
        expect(Math.abs((actual?.getTime() ?? 0) - expected.getTime())).toBeLessThan(5_000);
      };

      it('the attempt is refunded, the time does not move, the row waits out the shortest pause', async () => {
        const id = await queue.seed('one');
        const claimed = await claim(id);
        const { moment } = await queue.state(id);

        await claimed.recordAttempt();

        await expect(claimed.waitForNotion(REASON)).resolves.toBe(true);

        const after = await queue.state(id);
        const expected: Pick<RowState, 'moment' | 'lockedUntil' | 'lastError' | 'attemptCount'> = {
          moment,
          lockedUntil: null,
          lastError: REASON,
          attemptCount: 0,
        };

        expect(after).toMatchObject(expected);
        near(after.notionHeldSince, new Date());
        near(after.notionHoldUntil, addMinutes(new Date(), notionHoldMinMinutes));
      });

      const pauses: [string, number, number][] = [
        ['five minutes: the shortest pause', 5, notionHoldMinMinutes],
        ['twenty minutes: twice as long', 20, 40],
        ['three hours: no longer than an hour', 180, notionHoldMaxMinutes],
      ];

      it.each(pauses)('a row that has waited consecutively for %s', async (_, waited, pause) => {
        const id = await queue.seed('one');
        const since = subMinutes(new Date(), waited);

        await queue.hold(id, due(), since);

        const claimed = await claim(id);

        await expect(claimed.waitForNotion(REASON)).resolves.toBe(true);

        const after = await queue.state(id);

        expect(after.notionHeldSince).toEqual(since);
        near(after.notionHoldUntil, addMinutes(new Date(), pause));
      });

      /**
       * A changed row already holds something else — a snooze or the person's reply — and does
       * not wait out someone else's pause.
       */
      it('a row changed during the run gets no mark, the attempt is only refunded', async () => {
        const id = await queue.seed('one');
        const claimed = await claim(id);

        await claimed.recordAttempt();
        await queue.change(id);

        await expect(claimed.waitForNotion(REASON)).resolves.toBe(true);

        const expected: Pick<
          RowState,
          'lockedUntil' | 'lastError' | 'attemptCount' | 'notionHoldUntil' | 'notionHeldSince'
        > = {
          lockedUntil: null,
          lastError: REASON,
          attemptCount: 0,
          notionHoldUntil: null,
          notionHeldSince: null,
        };

        await expect(queue.state(id)).resolves.toMatchObject(expected);
      });

      it('a row that waits does not occupy the group: the candidate is the next one', async () => {
        const held = await queue.seed('held', 0, subMinutes(new Date(), 10));
        const next = await queue.seed('next');

        await queue.hold(held, addMinutes(new Date(), 10), subMinutes(new Date(), 5));

        const candidates = await queue.rows().candidates();

        expect(candidates.map((candidate) => candidate.id)).toEqual([next]);
        await expect(queue.rows().claim(held)).resolves.toBeNull();
      });

      it('when the pause has passed the row is a candidate again', async () => {
        const id = await queue.seed('one');

        await queue.hold(id, due(), subMinutes(new Date(), 30));

        const candidates = await queue.rows().candidates();

        expect(candidates.map((candidate) => candidate.id)).toEqual([id]);
      });

      it('retirement applies to a waiting row too', async () => {
        const id = await queue.seed('one');

        await queue.hold(id, addMinutes(new Date(), 10), subMinutes(new Date(), 5));
        await queue.doom(id);
        await queue.rows().retire();

        const expected: Pick<RowState, 'status' | 'lastError'> = {
          status: 'failed',
          lastError: 'attempt limit reached',
        };

        await expect(queue.state(id)).resolves.toMatchObject(expected);
      });

      /**
       * A row that still does not reach Notion keeps counting its own consecutive wait instead of
       * starting a new one.
       */
      it('when Notion answers again the pause is released and the time of the first deferral stays', async () => {
        const held = await queue.seed('held');
        const waited = await queue.seed('waited');
        const since = subHours(new Date(), 2);

        await queue.hold(held, addMinutes(new Date(), 30), since);
        await queue.hold(waited, due(), since);

        await expect(queue.rows().releaseNotionHolds()).resolves.toBe(1);

        const expected: Pick<RowState, 'notionHoldUntil' | 'notionHeldSince'> = {
          notionHoldUntil: null,
          notionHeldSince: since,
        };

        await expect(queue.state(held)).resolves.toMatchObject(expected);
      });

      /**
       * A row that was waiting at the prior release too and again did not reach Notion while Notion
       * was answering others is not released a second time: its failure is most likely in the row
       * itself.
       */
      it('a row whose wait began before the prior release is not released', async () => {
        const previous = subMinutes(new Date(), 30);
        const again = await queue.seed('again');
        const fresh = await queue.seed('fresh');
        const until = addMinutes(new Date(), 40);

        await queue.hold(again, until, subHours(new Date(), 1));
        await queue.hold(fresh, until, subMinutes(new Date(), 10));

        await expect(queue.rows().releaseNotionHolds(previous)).resolves.toBe(1);
        await expect(queue.state(again).then((row) => row.notionHoldUntil)).resolves.toEqual(until);
        await expect(queue.state(fresh).then((row) => row.notionHoldUntil)).resolves.toBeNull();
      });

      const reached: [string, (run: ClaimedRun, notionReached: boolean) => Promise<unknown>][] = [
        ['failure', (run, notionReached) => run.fail('run reported failure', notionReached)],
        [
          'plan quota hit',
          (run, notionReached) => run.refund('run deferred: plan_quota', notionReached),
        ],
        ['supersession', (run, notionReached) => run.conclude(notionReached)],
      ];

      /**
       * Otherwise the next Notion outage, even a week later, would find the row already “waiting
       * for a day”.
       */
      it.each(reached)(
        'the %s of a run that reached Notion ends the consecutive wait',
        async (_, act) => {
          const id = await queue.seed('one');

          await queue.hold(id, due(), subHours(new Date(), 2));

          const claimed = await claim(id);

          // The row is changed so that the conclusion becomes a supersession: a concluded row has
          // no use for the wait.
          await queue.change(id);
          await act(claimed, true);

          const expected: Pick<RowState, 'notionHoldUntil' | 'notionHeldSince'> = {
            notionHoldUntil: null,
            notionHeldSince: null,
          };

          await expect(queue.state(id)).resolves.toMatchObject(expected);
        },
      );

      /**
       * A failure beyond the day limit did not reach Notion either: otherwise the limit would
       * start over each time.
       */
      it.each(reached)(
        'the %s of a run that did not reach Notion does not end the consecutive wait',
        async (_, act) => {
          const id = await queue.seed('one');
          const since = subHours(new Date(), 2);

          await queue.hold(id, due(), since);

          const claimed = await claim(id);

          await queue.change(id);
          await act(claimed, false);

          await expect(queue.state(id).then((row) => row.notionHeldSince)).resolves.toEqual(since);
        },
      );
    });

    /** `done` is a copy of the trace; `failed` stays as evidence. */
    it('pruning takes only concluded rows', async () => {
      const done = await queue.seed('done');
      const failed = await queue.seed('failed');

      await queue.settle(done, 'done');
      await queue.settle(failed, 'failed');
      await queue.age(done, 30);
      await queue.age(failed, 30);

      const kept: Pick<RowState, 'status'> = { status: 'failed' };

      await expect(queue.rows().pruneConcluded(7)).resolves.toBe(1);
      await expect(queue.state(failed)).resolves.toMatchObject(kept);
      await expect(queue.state(done)).rejects.toThrow();
    });
  });

  /**
   * A safeguard on top of the rule that a snooze is not postponed: the mark does not hold it
   * back (ADR 0045).
   */
  it("a Notion wait does not hold back the person's snooze", async () => {
    const { id } = await prisma.scheduledCheck.create({
      data: {
        notionPageId: 'page-snooze',
        runAt: due(),
        reasonCode: 'user_snooze',
        notionHoldUntil: addMinutes(new Date(), 30),
        notionHeldSince: subMinutes(new Date(), 15),
      },
    });

    const candidates = await checks.rows().candidates();

    expect(candidates.map((candidate) => candidate.id)).toEqual([id]);
  });

  /**
   * The run request is composed from the row that was just claimed. If it could not be composed,
   * there will be no run and the row is released right away: otherwise it would hang under the
   * lease until the ticket ends. The error propagates instead of being swallowed.
   */
  it('a row whose run request could not be composed is released right away', async () => {
    const rows = evaluationWindowRows(
      prisma,
      moduleRef.get<EvaluationWindowConfig>(evaluationWindowConfig.KEY),
      attention,
    );
    const broken = new RunRowSource(prisma, moduleRef.get(RunRowPolicy), {
      ...rows,
      envelope: () => Promise.reject(new Error('the envelope could not be built')),
    });
    const id = await windows.seed('one');
    const before = await windows.state(id);

    await expect(broken.claim(id)).rejects.toThrow('the envelope could not be built');

    const after = await windows.state(id);
    const expected: RowState = { ...before, updatedAt: after.updatedAt };

    expect(after).toEqual(expected);
  });
});
