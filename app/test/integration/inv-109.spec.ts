import { Test, TestingModule } from '@nestjs/testing';
import { addMinutes, subHours, subMinutes } from 'date-fns';
import { AttentionService } from '../../src/attention/attention.service';
import { appConfig } from '../../src/config/app.config';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { evaluationWindowConfig } from '../../src/intake/notion/evaluation-window.config';
import { EvaluationWindowRepository } from '../../src/intake/notion/evaluation-window.repository';
import { EvaluationWindowRunSource } from '../../src/intake/notion/evaluation-window.run-source';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { ReviewOccurrenceRunSource } from '../../src/reviews/review-occurrence.run-source';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunBudget } from '../../src/runs/run-budget';
import { RUN_EFFECTS } from '../../src/runs/run-effects';
import { RunGates } from '../../src/runs/run-gates';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { RunTraceRepository } from '../../src/runs/run-trace.repository';
import { RunDispatcher } from '../../src/runs/run.dispatcher';
import { RUN_LAUNCHER } from '../../src/runs/run.launcher';
import { RunScheduler } from '../../src/runs/run.scheduler';
import { runsConfig } from '../../src/runs/runs.config';
import { runSourcesProvider } from '../../src/scheduling/run-sources.provider';
import { BREAKER_NOTICE_PROVIDER } from '../fixtures/breaker-notice';
import { NOTION_WAIT_NOTICE_PROVIDER } from '../fixtures/notion-wait-notice';
import { RecordingEffects } from '../fixtures/recording-effects';
import { completed, unreachable } from '../fixtures/run-outcome.fixture';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';
import { due } from './queue-rows';
import { RecordingLauncher } from './recording-launcher';

/** What the row shows about waiting for Notion. */
interface Waiting {
  readonly attemptCount: number;
  readonly notionHoldUntil: Date | null;
  readonly notionHeldSince: Date | null;
}

/** What the ledger recorded about a run. */
interface Ledgered {
  readonly status: string;
  readonly notionUnavailable: boolean;
  readonly deferredUntil: Date | null;
}

/**
 * `INV-109` A run that did not reach Notion writes nothing and sets no continuations; the same row
 * waits out a pause that grows, while other rows do not. A change to the row or a run that reached
 * Notion lifts the wait; after a day of waiting, an ordinary failure follows; a person's snooze
 * never waits (ADR 0045).
 *
 * The scheduler, the dispatcher, the run gates, the ledger and the queues over the database are
 * real here; only the model run and the App's side of it are stubbed.
 */
describe('INV-109', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: RunScheduler;
  let windows: EvaluationWindowRepository;
  let checks: ScheduledCheckRepository;
  let launcher: RecordingLauncher;
  let effects: RecordingEffects;

  const { notionHoldMinMinutes, notionHoldLimitHours } = runsConfig();

  beforeAll(async () => {
    launcher = new RecordingLauncher();
    effects = new RecordingEffects();

    // The windows here are page changes, not the person's replies to the system. The window
    // source asks attention only about a reply, so a call would mean a different scenario.
    const attention: Pick<AttentionService, 'managed'> = {
      managed: () => Promise.reject(new Error('a page change asked about a system thread')),
    };

    moduleRef = await Test.createTestingModule({
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
        EvaluationWindowRepository,
        RunRowPolicy,
        EvaluationWindowRunSource,
        ScheduledCheckRepository,
        ScheduledCheckRunSource,
        ReviewOccurrenceRunSource,
        runSourcesProvider,
        RunScheduler,
        RunDispatcher,
        RunGates,
        BREAKER_NOTICE_PROVIDER,
        NOTION_WAIT_NOTICE_PROVIDER,
        RunBudget,
        RunTraceRepository,
        { provide: RUN_LAUNCHER, useValue: launcher },
        { provide: RUN_EFFECTS, useValue: effects },
        { provide: AttentionService, useValue: attention },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    scheduler = moduleRef.get(RunScheduler);
    windows = moduleRef.get(EvaluationWindowRepository);
    checks = moduleRef.get(ScheduledCheckRepository);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    launcher.reset();
    effects.reset();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /** Creates a window of a page change that came due; `minutesAgo` sets its place in the queue. */
  async function window(pageId: string, minutesAgo: number): Promise<string> {
    const created = await prisma.evaluationWindow.create({
      data: {
        pageId,
        updatedProperties: ['p_task_status'],
        eventTypes: ['page.properties_updated'],
        latestEventId: `evt-${pageId}`,
        latestEventType: 'page.properties_updated',
        latestEventAt: subMinutes(new Date(), minutesAgo + 5),
        notBefore: subMinutes(new Date(), minutesAgo),
      },
    });

    return created.id;
  }

  /**
   * Marks the window as already waiting for Notion: until `until`, and consecutively since
   * `since`.
   */
  async function holdWindow(id: string, until: Date, since: Date): Promise<void> {
    await prisma.evaluationWindow.update({
      where: { id },
      data: { notionHoldUntil: until, notionHeldSince: since },
    });
  }

  const windowState = (id: string): Promise<Waiting> =>
    prisma.evaluationWindow.findUniqueOrThrow({
      where: { id },
      select: { attemptCount: true, notionHoldUntil: true, notionHeldSince: true },
    });

  const ledger = (): Promise<Ledgered[]> =>
    prisma.runTrace.findMany({
      select: { status: true, notionUnavailable: true, deferredUntil: true },
      orderBy: { createdAt: 'asc' },
    });

  /** Lists the pages whose runs started, in launch order. */
  const launchedPages = (): (string | undefined)[] =>
    launcher.launched.map(({ trigger }) => ('page_id' in trigger ? trigger.page_id : undefined));

  /**
   * The stamp is set by the database clock and the waiting is measured by the process clock, so
   * the slack covers the divergence.
   */
  const near = (actual: Date | null, expected: Date): void => {
    expect(Math.abs((actual?.getTime() ?? 0) - expected.getTime())).toBeLessThan(5_000);
  };

  it('the run writes nothing and the same row waits, while a neighbor from the same group goes on', async () => {
    const first = await window('page-first', 10);
    const second = await window('page-second', 5);

    launcher.outcome = unreachable();

    await expect(scheduler.runOnce()).resolves.toBe(1);

    const held = await windowState(first);

    expect(held.attemptCount).toBe(0);
    near(held.notionHeldSince, new Date());
    near(held.notionHoldUntil, addMinutes(new Date(), notionHoldMinMinutes));
    expect(effects.sessions.map((session) => session.ended)).toEqual(['discarded']);
    await expect(prisma.scheduledCheck.count()).resolves.toBe(0);

    const deferred: Ledgered = { status: 'deferred', notionUnavailable: true, deferredUntil: null };

    await expect(ledger()).resolves.toEqual([deferred]);

    // The run gates are open: the first window waits on its own, and the second is not stuck
    // behind it.
    await expect(scheduler.runOnce()).resolves.toBe(1);
    await expect(scheduler.runOnce()).resolves.toBe(0);

    expect(launchedPages()).toEqual(['page-first', 'page-second']);
    await expect(windowState(second).then((row) => row.notionHoldUntil)).resolves.not.toBeNull();
  });

  /**
   * A row that keeps failing to reach Notion continues its day of waiting and does not start a new
   * one.
   */
  it('a run that reached Notion lifts the pauses of all rows, and each row keeps its day', async () => {
    const since = subHours(new Date(), 2);
    const waiting = await window('page-waiting', 30);

    await holdWindow(waiting, addMinutes(new Date(), 40), since);
    await window('page-fresh', 5);

    launcher.outcome = completed();

    await expect(scheduler.runOnce()).resolves.toBe(1);

    const released: Waiting = { attemptCount: 0, notionHoldUntil: null, notionHeldSince: since };

    await expect(windowState(waiting)).resolves.toEqual(released);

    await expect(scheduler.runOnce()).resolves.toBe(1);

    expect(launchedPages()).toEqual(['page-fresh', 'page-waiting']);
  });

  it('a reply from the person lifts the wait of a window, and a page change does not', async () => {
    const answered = await window('page-answered', 10);
    const edited = await window('page-edited', 10);
    const until = addMinutes(new Date(), 40);
    const since = subMinutes(new Date(), 20);

    await holdWindow(answered, until, since);
    await holdWindow(edited, until, since);

    const event = {
      occurredAt: new Date(),
      personReplied: false,
      inboxItemCreated: false,
      channelInbound: false,
      eventType: 'page.properties_updated',
    };

    await windows.absorb({
      ...event,
      pageId: 'page-answered',
      eventId: 'evt-answer',
      discussionId: 'discussion-1',
      channelInbound: true,
    });
    await windows.absorb({ ...event, pageId: 'page-edited', eventId: 'evt-edit' });

    const cleared: Waiting = { attemptCount: 0, notionHoldUntil: null, notionHeldSince: null };
    const kept: Waiting = { attemptCount: 0, notionHoldUntil: until, notionHeldSince: since };

    await expect(windowState(answered)).resolves.toEqual(cleared);
    await expect(windowState(edited)).resolves.toEqual(kept);
  });

  /** A moved continuation is a new request: the snooze the person turned it into does not wait. */
  it('a moved continuation no longer waits', async () => {
    const check = await prisma.scheduledCheck.create({
      data: {
        discussionId: 'discussion-1',
        notionPageId: 'page-check',
        runAt: due(),
        reasonCode: 'await_external_event',
        notionHoldUntil: addMinutes(new Date(), 30),
        notionHeldSince: subMinutes(new Date(), 15),
      },
    });

    await checks.schedule(
      {
        discussionId: 'discussion-1',
        notionPageId: 'page-check',
        runAt: addMinutes(new Date(), 60),
        reasonCode: 'user_snooze',
      },
      true,
    );

    const moved = await prisma.scheduledCheck.findUniqueOrThrow({ where: { id: check.id } });

    expect(moved.reasonCode).toBe('user_snooze');
    expect(moved.notionHoldUntil).toBeNull();
    expect(moved.notionHeldSince).toBeNull();
  });

  /** The limit is a signal of a long stoppage: the failure is ordinary, and the breaker sees it. */
  it('a row that has waited a day no longer waits: a failure that the breaker counts', async () => {
    const since = subHours(new Date(), notionHoldLimitHours);
    const id = await window('page-stuck', 30);

    await holdWindow(id, due(), since);

    launcher.outcome = unreachable();

    await expect(scheduler.runOnce()).resolves.toBe(1);

    const failed: Ledgered = { status: 'failed', notionUnavailable: false, deferredUntil: null };
    const spent: Pick<Waiting, 'attemptCount' | 'notionHeldSince'> = {
      attemptCount: 1,
      notionHeldSince: since,
    };

    await expect(ledger()).resolves.toEqual([failed]);
    await expect(windowState(id)).resolves.toMatchObject(spent);
    expect(effects.sessions.map((session) => session.ended)).toEqual(['discarded']);
  });

  /**
   * A reminder comes on time or not at all: past the attempt limit the App tells the person
   * (`INV-108`).
   */
  it("a person's snooze does not wait: a failure the breaker does not count, and the next tick tries again", async () => {
    const snooze = await prisma.scheduledCheck.create({
      data: {
        discussionId: 'discussion-1',
        notionPageId: 'page-snooze',
        runAt: due(),
        reasonCode: 'user_snooze',
      },
    });

    launcher.outcome = unreachable();

    await expect(scheduler.runOnce()).resolves.toBe(1);
    await expect(scheduler.runOnce()).resolves.toBe(1);

    const failed: Ledgered = { status: 'failed', notionUnavailable: true, deferredUntil: null };
    const row = await prisma.scheduledCheck.findUniqueOrThrow({ where: { id: snooze.id } });

    await expect(ledger()).resolves.toEqual([failed, failed]);
    expect(row.attemptCount).toBe(2);
    expect(row.notionHoldUntil).toBeNull();
  });
});
