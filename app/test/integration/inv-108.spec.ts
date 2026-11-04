import { Test } from '@nestjs/testing';
import { appConfig } from '../../src/config/app.config';
import { continuationsConfig } from '../../src/continuations/continuations.config';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import {
  WAKE_FAILURE_NOTICE,
  type WakeFailureNotice,
} from '../../src/continuations/wake-failure-notice';
import { WakeFailureWorker } from '../../src/continuations/wake-failure.worker';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { outboxConfig } from '../../src/delivery/outbox/outbox.config';
import { OutboxRepository } from '../../src/delivery/outbox/outbox.repository';
import { QuietHours } from '../../src/delivery/outbox/quiet-hours';
import { ChannelRegistry } from '../../src/delivery/port/channel.registry';
import { ReasonCode, ScheduledCheckStatus } from '../../src/generated/prisma/enums';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { runsConfig } from '../../src/runs/runs.config';
import { spokenMoment } from '../../src/texts/spoken-dates';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

/** Monday, 09:00 Kyiv time: the time the person named. */
const MONDAY_NINE = new Date('2026-10-19T06:00:00.000Z');

/**
 * Returns that time in words, as the installation formats it, on the real clock because the
 * wording mentions the year only when it is not the current one. The format is covered by
 * `wake-failure.message.spec.ts`. Here the point is that the message contains that very time.
 */
const nineSaid = (): string => spokenMoment(MONDAY_NINE, 'uk', 'Europe/Kyiv', new Date());

/** What the wake run would have queued itself: a reminder with the same key. */
const REMINDER = {
  noticed: 'Час повернутися до дзвінка в банк.',
  whyItMatters: 'Ви просили нагадати.',
  ask: 'Дзвонимо сьогодні?',
  link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
};

/**
 * The message about a wake that did not take place, against a real database: the run source that
 * retires wakes, the worker, the delivery service and the delivery queue are real.
 */
describe('INV-108 the person is told exactly once about a wake whose time the person named and that did not take place', () => {
  let prisma: PrismaService;
  let worker: WakeFailureWorker;
  let source: ScheduledCheckRunSource;
  let maxAttempts: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        testConfig(
          databaseConfig,
          workersConfig,
          outboxConfig,
          budgetConfig,
          runsConfig,
          continuationsConfig,
        ),
      ],
      providers: [
        PrismaService,
        RunRowPolicy,
        ScheduledCheckRunSource,
        ScheduledCheckRepository,
        WakeFailureWorker,
        OutboxRepository,
        DeliveryService,
        // The same call as in the delivery adapter (`delivery-notices.module.ts`).
        {
          provide: WAKE_FAILURE_NOTICE,
          useFactory: (delivery: DeliveryService): WakeFailureNotice => ({
            failed: (failure) => delivery.wakeFailed(failure),
          }),
          inject: [DeliveryService],
        },
        // The language and time zone are the ones the expectations below are written in, whatever
        // the environment says.
        {
          provide: appConfig.KEY,
          useValue: { ...appConfig(), language: 'uk', timeZone: 'Europe/Kyiv' },
        },
        { provide: QuietHours, useValue: { silentUntil: () => null } },
        { provide: ChannelRegistry, useValue: new ChannelRegistry([]) },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    worker = moduleRef.get(WakeFailureWorker);
    source = moduleRef.get(ScheduledCheckRunSource);
    maxAttempts = moduleRef.get(budgetConfig.KEY).workRowMaxAttempts;
    close = () => moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  const wake = (
    overrides: {
      reasonCode?: ReasonCode;
      status?: ScheduledCheckStatus;
      discussionId?: string | null;
    } = {},
  ): Promise<{ id: string; version: number }> =>
    prisma.scheduledCheck.create({
      data: {
        discussionId: overrides.discussionId === undefined ? THREAD : overrides.discussionId,
        notionPageId: PAGE,
        runAt: MONDAY_NINE,
        reasonCode: overrides.reasonCode ?? 'user_snooze',
        version: 2,
        status: overrides.status ?? 'failed',
        attemptCount: maxAttempts,
        lastError: 'attempt limit reached (last: run reported failure)',
      },
      select: { id: true, version: true },
    });

  const told = () =>
    prisma.notificationOutbox.findMany({
      select: {
        idempotencyKey: true,
        discussionId: true,
        payload: true,
        quietHoursExempt: true,
      },
    });

  const noticedAt = async (id: string): Promise<Date | null> =>
    (await prisma.scheduledCheck.findUniqueOrThrow({ where: { id } })).failureNoticedAt;

  it('an exhausted snooze: one message with the key of the run, the thread and the page, regardless of quiet hours', async () => {
    const { id, version } = await wake({ status: 'pending' });

    await source.retire();

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(await told()).toEqual([
      {
        idempotencyKey: `event:${id}:${version}`,
        discussionId: THREAD,
        payload: {
          // An installation without a grammatical gender for addressing the owner (ADR 0046).
          noticed: `Твоє нагадування на ${nineSaid()} не спрацювало.`,
          whyItMatters: 'У названий час справа до тебе не повернулася й лишилася без уваги.',
          ask: 'Глянь на справу в Notion, коли зможеш: сама система до неї вже не повернеться.',
          link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
        },
        quietHoursExempt: true,
      },
    ]);
    expect(await noticedAt(id)).not.toBeNull();
  });

  it('what has been said is not said again: later ticks queue nothing', async () => {
    await wake();

    await worker.runOnce();
    await expect(worker.runOnce()).resolves.toBe(0);
    expect(await told()).toHaveLength(1);
  });

  /**
   * A failure between the delivery queue and the mark: the retry queues the same key, not a second
   * message.
   */
  it('when the mark is lost after queuing, the retry yields no second message', async () => {
    const { id } = await wake();

    await worker.runOnce();
    await prisma.scheduledCheck.update({ where: { id }, data: { failureNoticedAt: null } });

    await expect(worker.runOnce()).resolves.toBe(1);
    expect(await told()).toHaveLength(1);
    expect(await noticedAt(id)).not.toBeNull();
  });

  /**
   * The run queued the reminder and only then failed: the person already has it, and a second one
   * is not needed.
   */
  it("a reminder the run managed to queue stays the only one and stays the run's own", async () => {
    const { id, version } = await wake();

    await prisma.notificationOutbox.create({
      data: {
        idempotencyKey: `event:${id}:${version}`,
        discussionId: THREAD,
        channel: 'telegram',
        payload: REMINDER,
        quietHoursExempt: true,
      },
    });

    await worker.runOnce();

    expect((await told()).map((row) => row.payload)).toEqual([REMINDER]);
    expect(await noticedAt(id)).not.toBeNull();
  });

  it('a deadline check gets its own wording; a page wake has no thread', async () => {
    await wake({ reasonCode: 'deadline_followup', discussionId: null });

    await worker.runOnce();

    const [row] = await told();

    expect(row?.discussionId).toBeNull();
    expect(JSON.stringify(row?.payload)).toContain(
      `Перевірка дедлайну, призначена на ${nineSaid()}, не відбулася.`,
    );
  });

  /**
   * The time of the other reasons is chosen by the system: the run trace reports their failure,
   * not a message.
   */
  it('a wake whose time the system chose, and wakes that are not retired, yield no message', async () => {
    await wake({ reasonCode: 'await_external_event' });
    await wake({ reasonCode: 'safety_recheck', discussionId: null });
    await wake({ reasonCode: 'resolution_reconciliation', discussionId: 'thread-closure' });
    await wake({ status: 'pending', discussionId: 'thread-pending' });
    await wake({ status: 'done', discussionId: 'thread-done' });

    await expect(worker.runOnce()).resolves.toBe(0);
    expect(await told()).toEqual([]);
  });
});
