import { Test, TestingModule } from '@nestjs/testing';
import { addHours, subMinutes } from 'date-fns';
import { AttentionService } from '../../src/attention/attention.service';
import { appConfig } from '../../src/config/app.config';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { EvaluationWindow, ScheduledCheck } from '../../src/generated/prisma/client';
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
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';
import { deferredRun, failedRun, fillDay, fillRuns, runningRun } from './ledger-rows';
import { RecordingLauncher } from './recording-launcher';

/** Rows of both sources that came due and wait for a run. */
interface DueRows {
  readonly window: EvaluationWindow;
  readonly autonomous: ScheduledCheck;
  readonly snooze: ScheduledCheck;
}

/**
 * `INV-084` A run denial does not change the origin row — neither its time, nor its attempt
 * counter, nor its status. A row that the denial finds claimed is released in the state in which
 * it was taken.
 */
describe('INV-084', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: RunScheduler;
  let traces: RunTraceRepository;
  let launcher: RecordingLauncher;

  beforeAll(async () => {
    launcher = new RecordingLauncher();

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
        { provide: RUN_EFFECTS, useValue: new RecordingEffects() },
        { provide: AttentionService, useValue: attention },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    scheduler = moduleRef.get(RunScheduler);
    traces = moduleRef.get(RunTraceRepository);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    launcher.reset();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /**
   * Creates a window, an autonomous continuation and a person's snooze, all due. The window and
   * the continuation have already waited for Notion and the pause has passed (ADR 0045): a denial
   * does not touch those marks either.
   */
  async function dueRows(): Promise<DueRows> {
    const minutesAgo = (minutes: number): Date => subMinutes(new Date(), minutes);

    return {
      window: await prisma.evaluationWindow.create({
        data: {
          pageId: 'page-window',
          updatedProperties: ['p_task_status'],
          eventTypes: ['page.properties_updated'],
          latestEventId: 'evt-1',
          latestEventType: 'page.properties_updated',
          latestEventAt: minutesAgo(20),
          notBefore: minutesAgo(15),
          lastError: 'run reported failure',
          attemptCount: 1,
          notionHoldUntil: minutesAgo(1),
          notionHeldSince: minutesAgo(16),
        },
      }),
      autonomous: await prisma.scheduledCheck.create({
        data: {
          notionPageId: 'page-check',
          runAt: minutesAgo(10),
          reasonCode: 'safety_recheck',
          notionHoldUntil: minutesAgo(2),
          notionHeldSince: minutesAgo(32),
        },
      }),
      snooze: await prisma.scheduledCheck.create({
        data: {
          discussionId: 'discussion-1',
          notionPageId: 'page-snooze',
          runAt: minutesAgo(5),
          reasonCode: 'user_snooze',
        },
      }),
    };
  }

  /** Checks that the rows are as they were, up to the transition timestamp. */
  async function expectUntouched(rows: {
    readonly windows?: readonly EvaluationWindow[];
    readonly checks?: readonly ScheduledCheck[];
  }): Promise<void> {
    for (const before of rows.windows ?? []) {
      const after = await prisma.evaluationWindow.findUniqueOrThrow({ where: { id: before.id } });
      const expected: EvaluationWindow = { ...before, updatedAt: after.updatedAt };

      expect(after).toEqual(expected);
    }

    for (const before of rows.checks ?? []) {
      const after = await prisma.scheduledCheck.findUniqueOrThrow({ where: { id: before.id } });
      const expected: ScheduledCheck = { ...before, updatedAt: after.updatedAt };

      expect(after).toEqual(expected);
    }
  }

  /** Run gates closed for everyone: not a single row is claimed. */
  const closedForAll: [string, () => Promise<unknown>][] = [
    [
      'there is no runner',
      () => {
        launcher.available = false;

        return Promise.resolve();
      },
    ],
    [
      'the Notion MCP grant is dead',
      () => {
        launcher.ready = { ready: false, reason: 'Notion MCP is not authorized' };

        return Promise.resolve();
      },
    ],
    [
      'the plan quota is exhausted',
      () => prisma.runTrace.create({ data: deferredRun(0, addHours(new Date(), 2)) }),
    ],
    [
      'the slot is occupied',
      () => prisma.runTrace.create({ data: runningRun(0, addHours(new Date(), 1)) }),
    ],
  ];

  it.each(closedForAll)('when %s, the rows of both sources do not change', async (_, close) => {
    const rows = await dueRows();

    await close();

    for (let tick = 0; tick < 3; tick += 1) {
      await expect(scheduler.runOnce()).resolves.toBe(0);
    }

    expect(launcher.launched).toHaveLength(0);
    await expectUntouched({ windows: [rows.window], checks: [rows.autonomous, rows.snooze] });
  });

  /**
   * Run gates that apply to autonomous work only. A person's snooze does not see them, and its
   * first successful run would close the breaker, so only autonomous work is due here, and it
   * waits unchanged.
   */
  const closedForAutonomous: [string, () => Promise<void>][] = [
    ['the breaker is open', () => fillRuns(prisma, 5, failedRun)],
    ['the daily limit is exhausted', () => fillDay(prisma)],
  ];

  it.each(closedForAutonomous)('when %s, the autonomous rows do not change', async (_, close) => {
    const rows = await dueRows();

    await prisma.scheduledCheck.delete({ where: { id: rows.snooze.id } });
    await close();

    for (let tick = 0; tick < 3; tick += 1) {
      await expect(scheduler.runOnce()).resolves.toBe(0);
    }

    expect(launcher.launched).toHaveLength(0);
    await expectUntouched({ windows: [rows.window], checks: [rows.autonomous] });
  });

  /**
   * A race: the state of the run gates saw a free slot, but admission no longer did (a run took
   * it, bypassing the scheduler). The row was claimed in time, and it is returned as it was taken.
   */
  it('a row that the denial finds claimed is returned as it was', async () => {
    const rows = await dueRows();

    await prisma.runTrace.create({ data: runningRun(0, addHours(new Date(), 1)) });
    jest.spyOn(traces, 'occupiedSlots').mockResolvedValueOnce(0);

    await expect(scheduler.runOnce()).resolves.toBe(1);

    expect(launcher.launched).toHaveLength(0);
    await expectUntouched({ windows: [rows.window], checks: [rows.autonomous, rows.snooze] });
  });
});
