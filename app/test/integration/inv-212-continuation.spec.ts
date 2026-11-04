import { Test } from '@nestjs/testing';
import {
  addDays,
  addHours,
  addMinutes,
  addSeconds,
  subDays,
  subHours,
  subMinutes,
  subSeconds,
} from 'date-fns';
import { appConfig } from '../../src/config/app.config';
import { ContinuationRequest } from '../../src/continuations/continuation.schema';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { scheduledCheckRows } from '../../src/continuations/scheduled-check.rows';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { ScheduledCheck } from '../../src/generated/prisma/client';
import { evaluationWindowConfig } from '../../src/intake/notion/evaluation-window.config';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { InvalidRequestError } from '../../src/platform/request/invalid-request';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { Actor, CHAT } from '../../src/runs/actor';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunBudget } from '../../src/runs/run-budget';
import { RUN_EFFECTS } from '../../src/runs/run-effects';
import { RunGates } from '../../src/runs/run-gates';
import { RunRowSource } from '../../src/runs/run-row-source';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { ClaimedRun, RUN_SOURCES, RunCandidate } from '../../src/runs/run-source';
import { RunTraceRepository } from '../../src/runs/run-trace.repository';
import { RunDispatcher } from '../../src/runs/run.dispatcher';
import { RUN_LAUNCHER } from '../../src/runs/run.launcher';
import { RunScheduler } from '../../src/runs/run.scheduler';
import { runsConfig } from '../../src/runs/runs.config';
import { BREAKER_NOTICE_PROVIDER } from '../fixtures/breaker-notice';
import { NOTION_WAIT_NOTICE_PROVIDER } from '../fixtures/notion-wait-notice';
import { RecordingEffects } from '../fixtures/recording-effects';
import { deferred, failed } from '../fixtures/run-outcome.fixture';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';
import { fillDay } from './ledger-rows';
import { claimed, due } from './queue-rows';
import { RecordingLauncher } from './recording-launcher';
import { SweepsWorld, sweepsWorld } from './sweeps.harness';

/**
 * Criterion 2 of gate M2: a scheduled continuation survives a restart.
 *
 * A restart is simulated here not by starting a process but by its **consequence**: the row stays
 * `running` with a lease nobody released. A killed process leaves precisely this state behind, and
 * the row must recover from it.
 *
 * The second half is `INV-212` in the part “a restart loses no follow-through”.
 */
describe('a continuation survives a process crash', () => {
  // The same limit as in the configuration, because a second literal would drift away from it
  // silently.
  const MAX_ATTEMPTS = budgetConfig().workRowMaxAttempts;
  const PAGE = 'page-1';

  /**
   * The person in the chat, who speaks for themselves and so may name any reason, including
   * snooze.
   */
  const PERSON: Actor = CHAT;

  /**
   * Runs here started two hours ago. The autonomous-step limit is measured from the start of the
   * run, and these tests schedule continuations that are already due, to check the queue protocol,
   * not that limit (`continuations.service.spec.ts` tests it).
   */
  const LONG_AGO = subHours(new Date(), 2);

  /** A run nobody asked for: an event in Notion. */
  const SYSTEM: Actor = {
    kind: 'run',
    runId: 'run-1',
    mode: 'event_evaluation',
    provenance: { origin: 'evaluation_window' },
    startedAt: LONG_AGO,
  };

  const schedule = (request: ContinuationRequest): Promise<ScheduledCheck> =>
    continuations.schedule(PERSON, request);

  let prisma: PrismaService;
  let policy: RunRowPolicy;
  let runs: ScheduledCheckRunSource;
  let continuations: ContinuationsService;
  let scheduler: RunScheduler;
  let launcher: RecordingLauncher;
  let effects: RecordingEffects;
  let close: () => Promise<void>;

  beforeAll(async () => {
    launcher = new RecordingLauncher();
    effects = new RecordingEffects();

    const moduleRef = await Test.createTestingModule({
      imports: [
        testConfig(
          databaseConfig,
          appConfig,
          budgetConfig,
          runsConfig,
          evaluationWindowConfig,
          workersConfig,
        ),
      ],
      providers: [
        PrismaService,
        ContinuationsService,
        ScheduledCheckRepository,
        RunRowPolicy,
        ScheduledCheckRunSource,
        {
          provide: RUN_SOURCES,
          inject: [ScheduledCheckRunSource],
          useFactory: (source: ScheduledCheckRunSource) => [source],
        },
        RunScheduler,
        RunDispatcher,
        RunGates,
        BREAKER_NOTICE_PROVIDER,
        NOTION_WAIT_NOTICE_PROVIDER,
        RunBudget,
        RunTraceRepository,
        { provide: RUN_LAUNCHER, useValue: launcher },
        { provide: RUN_EFFECTS, useValue: effects },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    policy = moduleRef.get(RunRowPolicy);
    runs = moduleRef.get(ScheduledCheckRunSource);
    continuations = moduleRef.get(ContinuationsService);
    scheduler = moduleRef.get(RunScheduler);
    close = () => moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    launcher.reset();
    effects.reset();
  });

  afterAll(async () => {
    await close();
  });

  const expire = (id: string): Promise<unknown> =>
    prisma.scheduledCheck.update({
      where: { id },
      data: { lockedUntil: subSeconds(new Date(), 1) },
    });

  const only = (): Promise<ScheduledCheck> => prisma.scheduledCheck.findFirstOrThrow();

  /** Claims the only continuation the way the scheduler takes it: by id, before the run. */
  const claimOnly = async (): Promise<ClaimedRun> => claimed(runs, (await only()).id);

  /**
   * Returns the candidates that can currently be claimed, after retiring those that will no
   * longer do their work.
   */
  const workable = async (): Promise<RunCandidate[]> => {
    await runs.retire();

    return runs.candidates();
  };

  it('a claimed row cannot be claimed a second time', async () => {
    await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

    const first = await claimOnly();

    await expect(runs.claim(first.id)).resolves.toBeNull();
    await expect(workable()).resolves.toHaveLength(0);
  });

  /**
   * Without this test, `interval '1 second'` in place of the configured value would leave the
   * lane green, yet at runtime the row would become claimable again while the first run is
   * still going.
   */
  it('the lease runs for exactly the ticket lifetime', async () => {
    await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

    const before = new Date();

    await claimOnly();

    const { lockedUntil } = await only();
    const lease = runsConfig().ticketSeconds;

    // The tolerance is on **both** sides, and not for symmetry: Postgres `now()` sets the stamp,
    // while the process clock computes the bounds. These are two different clocks, and between
    // the container and the host they differ by a few milliseconds. Without an upper tolerance
    // the test would fail about once in every few test runs, reporting a 2 ms discrepancy as a
    // broken lease. The assertion here is about the order of magnitude — “the configured 900
    // seconds, not one” — and a five-second slack does not weaken it.
    const slack = 5;

    expect(lockedUntil).not.toBeNull();
    expect(lockedUntil?.getTime()).toBeGreaterThanOrEqual(
      addSeconds(before, lease - slack).getTime(),
    );
    expect(lockedUntil?.getTime()).toBeLessThanOrEqual(
      addSeconds(new Date(), lease + slack).getTime(),
    );
  });

  it('a row with an expired lease is made claimable again', async () => {
    await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

    const claimed = await claimOnly();

    await claimed.recordAttempt();

    await expect(only().then((row) => row.status)).resolves.toBe('running');

    await expire(claimed.id);

    const again = await claimOnly();

    expect(again.id).toBe(claimed.id);
  });

  /**
   * Handing out a row costs nothing.
   *
   * A process killed before it reached the run caused nothing, and the row is not charged for it.
   * If the counter grew on claim, a cycle of restarts would put the whole queue into `failed`
   * within three rounds, without ever reaching the run.
   */
  it('a crash before the run is reached does not spend an attempt', async () => {
    await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

    for (let restart = 0; restart < MAX_ATTEMPTS * 2; restart += 1) {
      const run = await claimOnly();

      await expect(only().then((row) => row.attemptCount)).resolves.toBe(0);

      await expire(run.id);
    }

    await expect(workable()).resolves.toHaveLength(1);
    // The run never took place, so the row never became `running` either.
    await expect(only().then((row) => row.status)).resolves.toBe('pending');
  });

  it('an exhausted attempt limit moves the row to `failed` and does not make it claimable again', async () => {
    await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const run = await claimOnly();

      await expect(only().then((row) => row.attemptCount)).resolves.toBe(attempt - 1);

      // The run took place, and that is what spends the attempt. Then the process dies before it
      // can report anything: the row comes back with the attempt already counted, and the limit
      // is eventually exhausted.
      await run.recordAttempt();
      await run.fail('run died', false);
      await expire(run.id);
    }

    await expect(workable()).resolves.toHaveLength(0);

    const retired = await prisma.scheduledCheck.findFirstOrThrow();

    expect(retired.status).toBe('failed');
    // The reason consists of two facts because they differ: why the row died and what it last
    // failed on.
    expect(retired.lastError).toBe('attempt limit reached (last: run died)');
  });

  /**
   * A run hung for longer than the lease, the next tick claimed the row, and the late conclusion of
   * the first run concerns work nobody is waiting for. This is the costliest case of any queue:
   * the row holds the person's instruction “remind me then”, and concluding it from a run
   * that is not its owner means silently erasing it.
   */
  it('the late conclusion of a zombie does not conclude a continuation owned by another run', async () => {
    await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'user_snooze' });

    const first = await claimOnly();

    await first.recordAttempt();

    const { version } = await only();

    await expire(first.id);

    const second = await claimOnly();
    const reclaimed = await only();

    expect(second.id).toBe(first.id);
    expect(reclaimed.version).toBe(version);

    await expect(first.conclude(false)).resolves.toBe('lost');

    const after = await only();

    expect(after.status).toBe('running');
    expect(after.lockedUntil?.getTime()).toBe(reclaimed.lockedUntil?.getTime());
  });

  /**
   * Every disposition is fenced, not only the conclusion. A late release would release the lease
   * of a row that another run is working through right then, and a late attempt recording
   * would charge the attempt to another run.
   */
  describe('other dispositions of a zombie', () => {
    type Zombie = (run: ClaimedRun) => Promise<boolean>;

    const zombies: [string, Zombie][] = [
      ['release', (run) => run.release()],
      ['release with a reason', (run) => run.fail('stale', false)],
      ['attempt refund', (run) => run.refund('stale', false)],
      ['attempt recording', (run) => run.recordAttempt()],
    ];

    it.each(zombies)(
      'a late “%s” does not touch a continuation owned by another run',
      async (_, act) => {
        const scheduled = await schedule({
          notionPageId: PAGE,
          runAt: due(),
          reasonCode: 'safety_recheck',
        });

        const first = await claimOnly();

        await expire(first.id);
        await claimOnly();

        const { lockedUntil: lease } = await only();

        await expect(act(first)).resolves.toBe(false);

        const after = await prisma.scheduledCheck.findFirstOrThrow();
        const untouched: Pick<ScheduledCheck, 'runAt' | 'lastError' | 'attemptCount'> = {
          runAt: scheduled.runAt,
          lastError: null,
          attemptCount: 0,
        };

        expect(after).toMatchObject(untouched);
        expect(after.lockedUntil?.getTime()).toBe(lease?.getTime());
      },
    );
  });

  it('a concluded continuation is not made claimable again', async () => {
    await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

    const run = await claimOnly();

    await run.conclude(false);
    await expire(run.id);

    await expect(workable()).resolves.toHaveLength(0);
    await expect(runs.claim(run.id)).resolves.toBeNull();
  });

  it('a continuation whose time has not come is not claimed', async () => {
    const early = await schedule({
      notionPageId: PAGE,
      runAt: addMinutes(new Date(), 1),
      reasonCode: 'deadline_followup',
    });

    await expect(workable()).resolves.toHaveLength(0);
    await expect(runs.claim(early.id)).resolves.toBeNull();
  });

  /**
   * A snooze set during an active recheck would otherwise vanish when the row is concluded:
   * `schedule` moves the `run_at` of a row that a second later would become `done`, and the
   * person's “remind me on Monday” would be deleted.
   */
  describe('a snooze during dispatch', () => {
    it('keeps the continuation from being concluded and keeps the new time', async () => {
      const monday = addDays(new Date(), 3);

      await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });

      const claimed = await claimOnly();

      // As the dispatcher does: the attempt is recorded before the launch.
      await claimed.recordAttempt();
      await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: monday,
        reasonCode: 'user_snooze',
      });

      await expect(claimed.conclude(false)).resolves.toBe('superseded');

      const after = await prisma.scheduledCheck.findFirstOrThrow();

      expect(after.status).toBe('running');
      expect(after.runAt.getTime()).toBe(monday.getTime());
      expect(after.lockedUntil).toBeNull();
      expect(after.lastError).toContain('moved while the run was in flight');
    });

    /**
     * A snooze that landed in the gap between claiming the row and reading it.
     *
     * The claim returns an identifier, and the snapshot is taken by the next query — so a move
     * that happened between them arrives in the snapshot **together** with the new version, and
     * the version fence does not see it. The gap is reproduced here literally: the move happens
     * inside the read that follows the claim. Concluding that row would erase what the person
     * said, and there is no second chance, because a continuation does not heal itself the way an
     * evaluation window does.
     */
    it('a snooze in the claim gap does not conclude the continuation', async () => {
      const monday = addDays(new Date(), 3);
      const thread = { discussionId: 'discussion-1', notionPageId: PAGE } as const;
      const rows = scheduledCheckRows(prisma);
      const racing = new RunRowSource(prisma, policy, {
        ...rows,
        read: async (ids) => {
          await schedule({ ...thread, runAt: monday, reasonCode: 'user_snooze' });

          return rows.read(ids);
        },
      });

      await schedule({ ...thread, runAt: due(), reasonCode: 'user_snooze' });

      const claimed = await racing.claim((await only()).id);
      if (!claimed) {
        throw new Error('the continuation could not be claimed');
      }

      await claimed.recordAttempt();

      await expect(claimed.conclude(false)).resolves.toBe('superseded');

      const after = await prisma.scheduledCheck.findFirstOrThrow();

      expect(after.status).toBe('running');
      expect(after.runAt.getTime()).toBe(monday.getTime());
    });

    /**
     * A denial that finds the continuation claimed does not move the row: the “Monday” the person
     * said while the row was held stays Monday (`INV-084`).
     */
    it('a release after a denial keeps the snooze set during dispatch', async () => {
      const monday = addDays(new Date(), 3);

      await continuations.schedule(SYSTEM, {
        discussionId: 'discussion-9',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'await_external_event',
      });

      const claimed = await claimOnly();

      await schedule({
        discussionId: 'discussion-9',
        notionPageId: PAGE,
        runAt: monday,
        reasonCode: 'user_snooze',
      });

      await expect(claimed.release()).resolves.toBe(true);

      const after = await only();
      const expected: Pick<
        ScheduledCheck,
        'runAt' | 'reasonCode' | 'lockedUntil' | 'attemptCount' | 'lastError' | 'status'
      > = {
        runAt: monday,
        reasonCode: 'user_snooze',
        lockedUntil: null,
        attemptCount: 0,
        lastError: null,
        status: 'pending',
      };

      expect(after).toMatchObject(expected);
    });

    /**
     * The continuation could have been concluded between the lookup and the write. A new time
     * written into a terminal row never comes due — nobody will claim that row — while the caller
     * would get the updated row as if everything had worked.
     */
    it('a snooze on an already concluded continuation opens a new one', async () => {
      await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });
      await prisma.scheduledCheck.updateMany({ data: { status: 'done' } });

      await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });

      await expect(prisma.scheduledCheck.count()).resolves.toBe(2);
      await expect(prisma.scheduledCheck.count({ where: { status: 'pending' } })).resolves.toBe(1);
    });

    /**
     * The aging rule that evaluation windows live by does not extend to continuations.
     *
     * `run_at` can legitimately be six months ahead — “remind me in December” — and retiring a
     * row by age would erase what the person said. The boundary between the two queues holds
     * because each queue declares its own retirement rules.
     */
    it('a continuation created last year is not retired by age', async () => {
      await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });
      await prisma.scheduledCheck.updateMany({
        data: { createdAt: subDays(new Date(), 400) },
      });

      await expect(workable()).resolves.toHaveLength(1);
    });

    it('an unmoved continuation is concluded', async () => {
      await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

      const claimed = await claimOnly();

      await expect(claimed.conclude(false)).resolves.toBe('closed');
      await expect(
        prisma.scheduledCheck.findFirstOrThrow().then((row) => row.status),
      ).resolves.toBe('done');
    });
  });

  describe('repeated scheduling', () => {
    const later = addHours(new Date(), 1);

    it('for the same thread moves run_at of the existing row', async () => {
      const first = await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });

      const moved: ScheduledCheck = await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: later,
        reasonCode: 'user_snooze',
      });

      expect(moved.id).toBe(first.id);
      expect(moved.runAt.getTime()).toBe(later.getTime());
      await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
    });

    /**
     * A row's reason is what the run is told and what governs the budget and quiet hours.
     * Moving only the time would leave the person's snooze under a system reason: the run would
     * be told something false, and the snooze itself would be suppressed by quiet hours and spend
     * budget.
     */
    it('a moved continuation has the reason of whoever moved it', async () => {
      const own = await continuations.schedule(SYSTEM, {
        discussionId: 'discussion-3',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'await_external_event',
      });

      const snoozed = await schedule({
        discussionId: 'discussion-3',
        notionPageId: PAGE,
        runAt: later,
        reasonCode: 'user_snooze',
      });

      const expected: Pick<ScheduledCheck, 'id' | 'reasonCode' | 'runAt'> = {
        id: own.id,
        reasonCode: 'user_snooze',
        runAt: later,
      };

      expect(snoozed).toMatchObject(expected);
    });

    it('a system request does not override a snooze set by the person', async () => {
      const snoozed = await schedule({
        discussionId: 'discussion-4',
        notionPageId: PAGE,
        runAt: later,
        reasonCode: 'user_snooze',
      });

      await expect(
        continuations.schedule(SYSTEM, {
          discussionId: 'discussion-4',
          notionPageId: PAGE,
          runAt: due(),
          reasonCode: 'await_external_event',
        }),
      ).rejects.toThrow(InvalidRequestError);

      const kept: Pick<ScheduledCheck, 'reasonCode' | 'runAt' | 'version'> = {
        reasonCode: 'user_snooze',
        runAt: later,
        version: snoozed.version,
      };

      await expect(
        prisma.scheduledCheck.findUniqueOrThrow({ where: { id: snoozed.id } }),
      ).resolves.toMatchObject(kept);
      await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
    });

    /**
     * Only a waiting snooze is protected. The run it woke is itself the time the person named, and
     * only that run can name the next time for the thread. The row is not concluded in the
     * process: it stays open with the new time.
     */
    it("a run woken by the person's snooze schedules the next wake for the thread", async () => {
      await schedule({
        discussionId: 'discussion-5',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });

      const claimed = await claimOnly();
      const woken: Actor = {
        kind: 'run',
        runId: 'run-2',
        mode: 'scheduled_recheck',
        provenance: { origin: 'scheduled_check', reasonCode: 'user_snooze' },
        startedAt: LONG_AGO,
      };

      const next = await continuations.schedule(woken, {
        discussionId: 'discussion-5',
        notionPageId: PAGE,
        runAt: later,
        reasonCode: 'await_external_event',
      });

      expect(next.id).toBe(claimed.id);
      await expect(claimed.conclude(false)).resolves.toBe('superseded');
    });

    /**
     * A run that died did not work through the time the person named: the expired lease returns
     * the snooze to waiting — and the protection with it.
     */
    it('a snooze whose run died is protected again', async () => {
      const snoozed = await schedule({
        discussionId: 'discussion-7',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });

      await claimOnly();
      await prisma.scheduledCheck.update({
        where: { id: snoozed.id },
        data: { lockedUntil: subSeconds(new Date(), 1) },
      });

      await expect(
        continuations.schedule(SYSTEM, {
          discussionId: 'discussion-7',
          notionPageId: PAGE,
          runAt: later,
          reasonCode: 'await_external_event',
        }),
      ).rejects.toThrow(InvalidRequestError);
    });

    /**
     * The order of the race is undefined, but the result is defined: the person's snooze stays,
     * and the system request either moved the thread before it or was refused, instead of
     * raising a raw `P2002` from the unique index.
     */
    it("a race between a system request and the person's snooze leaves the snooze", async () => {
      const thread = { discussionId: 'discussion-6', notionPageId: PAGE } as const;

      const [system, person] = await Promise.allSettled([
        continuations.schedule(SYSTEM, {
          ...thread,
          runAt: due(),
          reasonCode: 'await_external_event',
        }),
        schedule({ ...thread, runAt: later, reasonCode: 'user_snooze' }),
      ]);
      const refusals = [system]
        .filter((result) => result.status === 'rejected')
        .map((result): unknown => result.reason);

      expect(refusals.every((reason) => reason instanceof InvalidRequestError)).toBe(true);

      const kept: Pick<ScheduledCheck, 'reasonCode' | 'runAt'> = {
        reasonCode: 'user_snooze',
        runAt: later,
      };

      expect(person.status).toBe('fulfilled');
      await expect(
        prisma.scheduledCheck.findFirstOrThrow({ where: { discussionId: 'discussion-6' } }),
      ).resolves.toMatchObject(kept);
      await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
    });

    /**
     * The same race reduced to the branch it rarely touches: the person's snooze appears between
     * the check and the insert. The first check “does not see” it here, so the insert runs into
     * the unique index — and the refusal must come from the branch after `P2002`, not from the
     * raw index exception.
     */
    it("the person's snooze that appears between the check and the insert also yields a refusal", async () => {
      const snoozed = await schedule({
        discussionId: 'discussion-8',
        notionPageId: PAGE,
        runAt: later,
        reasonCode: 'user_snooze',
      });
      const unseen = jest.spyOn(prisma.scheduledCheck, 'findFirst').mockResolvedValueOnce(null);

      try {
        await expect(
          continuations.schedule(SYSTEM, {
            discussionId: 'discussion-8',
            notionPageId: PAGE,
            runAt: due(),
            reasonCode: 'await_external_event',
          }),
        ).rejects.toThrow(InvalidRequestError);
      } finally {
        unseen.mockRestore();
      }

      const kept: Pick<ScheduledCheck, 'id' | 'reasonCode' | 'runAt'> = {
        id: snoozed.id,
        reasonCode: 'user_snooze',
        runAt: later,
      };

      await expect(prisma.scheduledCheck.findFirstOrThrow()).resolves.toMatchObject(kept);
      await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
    });

    /**
     * Without a thread the identity is the pair (page, reason), and a snooze does not block
     * another reason.
     */
    it('a snooze on a page without a thread does not block a system reason on the same page', async () => {
      await schedule({ notionPageId: PAGE, runAt: later, reasonCode: 'user_snooze' });
      await continuations.schedule(SYSTEM, {
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'safety_recheck',
      });

      await expect(prisma.scheduledCheck.count()).resolves.toBe(2);
    });

    /**
     * The model can take the thread id from a URL, where there are no hyphens: that does not split
     * the thread in two.
     */
    it('a thread id with hyphens and without them names the same thread', async () => {
      await schedule({
        discussionId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });
      await schedule({
        discussionId: '1F2E3D4C5B6A49788A9B0C1D2E3F4A5B',
        notionPageId: PAGE,
        runAt: later,
        reasonCode: 'user_snooze',
      });

      await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
    });

    it('does not fold two different reasons on one page into one row', async () => {
      await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });
      await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'deadline_followup' });

      await expect(prisma.scheduledCheck.count()).resolves.toBe(2);
    });

    /**
     * The result under concurrent calls: one continuation per thread. This test does not
     * guarantee that it reaches the branch where scheduling loses the creation race (`P2002`),
     * because the connection pool may run the calls one after another. The test below covers that
     * branch.
     */
    it('concurrent scheduling for the same thread yields one row', async () => {
      const request = {
        discussionId: 'discussion-2',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      } as const;

      await Promise.all([schedule(request), schedule(request), schedule(request)]);

      await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
    });

    /**
     * Scheduling that lost the creation race moves the row that won instead of failing with a raw
     * `P2002`. The race is reproduced literally: the first move “does not see” the open
     * continuation, so the creation runs into the partial unique index.
     */
    it('scheduling that lost the creation race moves the row that won', async () => {
      const later = addHours(new Date(), 1);
      const thread = { discussionId: 'discussion-10', notionPageId: PAGE } as const;
      const first = await schedule({ ...thread, runAt: due(), reasonCode: 'user_snooze' });
      const unseen = jest
        .spyOn(prisma.scheduledCheck, 'updateManyAndReturn')
        .mockResolvedValueOnce([]);
      let moved: ScheduledCheck;

      try {
        moved = await schedule({ ...thread, runAt: later, reasonCode: 'user_snooze' });
      } finally {
        unseen.mockRestore();
      }

      const expected: Pick<ScheduledCheck, 'id' | 'runAt'> = { id: first.id, runAt: later };

      expect(moved).toMatchObject(expected);
      await expect(prisma.scheduledCheck.count()).resolves.toBe(1);
    });
  });

  describe('a due continuation becomes a run', () => {
    it('the trigger envelope contains the thread, the page and the reason, and nothing else', async () => {
      await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });

      await expect(scheduler.runOnce()).resolves.toBe(1);

      const [envelope] = launcher.launched;

      expect(envelope.mode).toBe('scheduled_recheck');
      expect(Object.keys(envelope.trigger).sort()).toEqual(
        ['discussion_id', 'event_id', 'page_id', 'reason_code', 'type'].sort(),
      );
      expect(await prisma.scheduledCheck.findFirstOrThrow().then((row) => row.status)).toBe('done');
    });

    it("the person's snooze does not see the daily limit", async () => {
      await fillDay(prisma);

      await schedule({
        discussionId: 'discussion-1',
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'user_snooze',
      });

      await expect(scheduler.runOnce()).resolves.toBe(1);
      expect(launcher.launched).toHaveLength(1);

      const trace = await prisma.runTrace.findFirstOrThrow({
        where: { originKind: 'scheduled_check' },
      });

      expect(trace.budgetClass).toBe('exempt');
    });

    it('a safety recheck sees the daily limit and waits unchanged', async () => {
      await fillDay(prisma);

      const scheduled = await schedule({
        notionPageId: PAGE,
        runAt: due(),
        reasonCode: 'safety_recheck',
      });

      await expect(scheduler.runOnce()).resolves.toBe(0);

      const row = await only();

      expect(launcher.launched).toHaveLength(0);
      expect(row).toEqual({ ...scheduled, updatedAt: row.updatedAt });
    });

    /**
     * The time the person named ranks above autonomous work, even though that work came due
     * earlier (`INV-085`): the older continuation stays waiting as it was.
     */
    it("the person's snooze goes ahead of an older autonomous continuation", async () => {
      const autonomous = await continuations.schedule(SYSTEM, {
        notionPageId: 'page-2',
        runAt: subMinutes(new Date(), 10),
        reasonCode: 'safety_recheck',
      });

      await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'user_snooze' });

      await expect(scheduler.runOnce()).resolves.toBe(1);

      const [envelope] = launcher.launched;
      const waiting = await prisma.scheduledCheck.findUniqueOrThrow({
        where: { id: autonomous.id },
      });

      expect(envelope.trigger).toMatchObject({ page_id: PAGE, reason_code: 'user_snooze' });
      expect(waiting).toEqual({ ...autonomous, updatedAt: waiting.updatedAt });
    });

    it('a run that reported a failure does not conclude the continuation', async () => {
      launcher.outcome = failed('notion unreachable');

      await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });
      await scheduler.runOnce();

      const row = await prisma.scheduledCheck.findFirstOrThrow();

      expect(row.status).toBe('running');
      expect(row.attemptCount).toBe(1);
      expect(row.lockedUntil).toBeNull();
    });
  });

  /**
   * An exhausted plan quota is an external state, not a failure of the row (ADR 0012): the
   * attempt is refunded, the row does not move, and until the quota resets the run gates let no
   * run through.
   */
  describe('plan quota', () => {
    /** The quota has reset: the next tick launches a run again. */
    const limitReset = async (): Promise<void> => {
      await prisma.runTrace.updateMany({
        where: { status: 'deferred' },
        data: { deferredUntil: subSeconds(new Date(), 1) },
      });
    };

    /**
     * The attempt is recorded before the launch, so without a refund every deferral would bring
     * the row closer to `failed` — and a week of an exhausted quota would retire all
     * continuations, none of which failed.
     */
    it('deferrals, however many, do not retire the continuation', async () => {
      launcher.outcome = deferred();

      await schedule({ notionPageId: PAGE, runAt: due(), reasonCode: 'safety_recheck' });

      for (let run = 0; run <= MAX_ATTEMPTS; run += 1) {
        await expect(scheduler.runOnce()).resolves.toBe(1);
        await limitReset();
      }

      const row = await only();
      const expected: Pick<ScheduledCheck, 'status' | 'attemptCount' | 'lastError'> = {
        status: 'running',
        attemptCount: 0,
        lastError: 'run deferred: plan_quota',
      };

      expect(launcher.launched).toHaveLength(MAX_ATTEMPTS + 1);
      expect(row).toMatchObject(expected);
      expect(effects.endings()).toEqual(Array(MAX_ATTEMPTS + 1).fill('discarded'));
    });

    /**
     * A run that hit the quota stops the following ones too: until the reset any run would hit
     * the same quota. The time of the continuation stays the one that was named (`INV-084`).
     */
    it('until the quota resets the continuation waits and its time does not move', async () => {
      const scheduledAt = due();

      launcher.outcome = deferred(addHours(new Date(), 2));

      await schedule({ notionPageId: PAGE, runAt: scheduledAt, reasonCode: 'safety_recheck' });

      await expect(scheduler.runOnce()).resolves.toBe(1);
      await expect(scheduler.runOnce()).resolves.toBe(0);

      const row = await only();
      const expected: Pick<ScheduledCheck, 'runAt' | 'attemptCount' | 'lockedUntil' | 'lastError'> =
        {
          runAt: scheduledAt,
          attemptCount: 0,
          lockedUntil: null,
          lastError: 'run deferred: plan_quota',
        };

      expect(launcher.launched).toHaveLength(1);
      expect(row).toMatchObject(expected);
    });
  });
});

/**
 * `INV-212` in the part “a missed event loses no follow-through”: a situation that arose with the
 * passage of time has no event, and Notion does not report a thread resolution. The sweep finds
 * the first, the reconciliation the second (ADR 0037, ADR 0038); both schedule a continuation,
 * which then survives a restart and a retry like any other.
 */
describe('INV-212 missed event: the sweep wakes a situation without an event, the reconciliation closes a resolved thread', () => {
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

  it('the check date has come and no run followed it: a continuation wakes the page', async () => {
    world.finder.candidates = [
      {
        pageId: 'task-1',
        rule: 'check_date_reached',
        basis: 'date:2026-10-15/',
        since: subHours(new Date(), 2),
        pages: ['task-1'],
      },
    ];

    await world.sweep.sweep();

    const [candidate] = await world.checks.candidates();

    expect(candidate?.provenance).toEqual({
      origin: 'scheduled_check',
      reasonCode: 'safety_recheck',
    });
  });

  it('a thread is resolved and there is no event: the reconciliation requests closure', async () => {
    await world.prisma.systemDiscussion.create({
      data: {
        discussionId: 'discussion-1',
        pageId: 'page-1',
        mode: 'event_evaluation',
        lastCommentId: 'comment-1',
        lastWrittenAt: subHours(new Date(), 1),
      },
    });
    world.comments.open.set('page-1', []);
    world.comments.readable.add('comment-1');

    await world.reconciler.reconcile();

    const [candidate] = await world.checks.candidates();

    expect(candidate?.provenance).toEqual({
      origin: 'scheduled_check',
      reasonCode: 'resolution_reconciliation',
    });
  });
});
