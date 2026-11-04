import { Test } from '@nestjs/testing';
import { addDays, subDays, subHours } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { appConfig } from '../../src/config/app.config';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { outboxConfig } from '../../src/delivery/outbox/outbox.config';
import { OutboxRepository } from '../../src/delivery/outbox/outbox.repository';
import { QuietHours } from '../../src/delivery/outbox/quiet-hours';
import { NotificationChannel } from '../../src/delivery/port/channel.port';
import { ChannelRegistry } from '../../src/delivery/port/channel.registry';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { localDateAt } from '../../src/platform/time/local-day';
import { parseSchedule } from '../../src/platform/time/schedule';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { ReviewOccurrenceRepository } from '../../src/reviews/review-occurrence.repository';
import { ReviewOccurrenceRunSource } from '../../src/reviews/review-occurrence.run-source';
import { ReviewPlanner } from '../../src/reviews/review.planner';
import { reviewsConfig } from '../../src/reviews/reviews.config';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunGates } from '../../src/runs/run-gates';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { runsConfig } from '../../src/runs/runs.config';
import { spokenDays } from '../../src/texts/spoken-dates';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

/** A channel that delivers: without one no reviews are scheduled, and the producer says nothing. */
const CHANNEL: NotificationChannel = {
  id: 'telegram',
  capabilities: { interactiveActions: true },
  excess: () => 0,
  send: () => Promise.resolve({ ok: true }),
};

/**
 * The message about an occurrence that did not take place, against a real database: the run
 * source that retires occurrences, the producer and the delivery queue are real (ADR 0036).
 */
describe('INV-105 the person is told exactly once about a review occurrence that did not take place', () => {
  let prisma: PrismaService;
  let planner: ReviewPlanner;
  let source: ReviewOccurrenceRunSource;
  let maxAttempts: number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        testConfig(
          databaseConfig,
          workersConfig,
          outboxConfig,
          appConfig,
          budgetConfig,
          runsConfig,
        ),
      ],
      providers: [
        PrismaService,
        RunRowPolicy,
        ReviewOccurrenceRunSource,
        ReviewOccurrenceRepository,
        ReviewPlanner,
        OutboxRepository,
        DeliveryService,
        { provide: QuietHours, useValue: { silentUntil: () => null } },
        { provide: RunGates, useValue: { runnerWired: true } },
        { provide: ChannelRegistry, useValue: new ChannelRegistry([CHANNEL]) },
        { provide: ApprovalsService, useValue: { lapseShown: () => Promise.resolve(0) } },
        {
          provide: reviewsConfig.KEY,
          useValue: {
            schedules: {
              daily_control: parseSchedule('off'),
              weekly_control_review: parseSchedule('off'),
              strategic_review: parseSchedule('off'),
              deep_review: parseSchedule('off'),
            },
            tickSeconds: 60,
          },
        },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    planner = moduleRef.get(ReviewPlanner);
    source = moduleRef.get(ReviewOccurrenceRunSource);
    maxAttempts = moduleRef.get(budgetConfig.KEY).workRowMaxAttempts;
    close = () => moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  const occurrence = (
    occurrenceKey: string,
    overrides: { closesAt?: Date; attemptCount?: number; status?: 'done' | 'failed' } = {},
  ): Promise<{ id: string }> => {
    const dueAt = subHours(new Date(), 2);

    return prisma.reviewOccurrence.create({
      data: {
        mode: 'weekly_control_review',
        occurrenceKey,
        dueAt,
        closesAt: overrides.closesAt ?? addDays(dueAt, 7),
        sinceAt: subDays(dueAt, 7),
        attemptCount: overrides.attemptCount ?? 0,
        ...(overrides.status ? { status: overrides.status } : {}),
      },
      select: { id: true },
    });
  };

  const told = (): Promise<{ idempotencyKey: string; payload: unknown }[]> =>
    prisma.notificationOutbox.findMany({
      select: { idempotencyKey: true, payload: true },
      orderBy: { idempotencyKey: 'asc' },
    });

  it('retired past the window and after exhausted attempts: one message each, with a reason', async () => {
    await occurrence('2026-W41', { closesAt: subHours(new Date(), 1) });
    await occurrence('2026-W42', { attemptCount: maxAttempts });

    await source.retire();

    await expect(planner.noticeFailures()).resolves.toBe(2);

    const rows = await told();

    expect(rows.map((row) => row.idempotencyKey)).toEqual([
      'review-failed:weekly_control_review:2026-W41',
      'review-failed:weekly_control_review:2026-W42',
    ]);
    // The week in words, as the installation formats it. The wording mentions the year only when
    // it is not the current one, so “today” is the real date.
    const week = spokenDays(
      { year: 2026, month: 10, day: 5 },
      { year: 2026, month: 10, day: 11 },
      'uk',
      localDateAt('Europe/Kyiv', new Date()),
    );

    expect(JSON.stringify(rows[0]?.payload)).toContain(`Тижневий огляд за ${week} не відбувся.`);
    expect(JSON.stringify(rows[0]?.payload)).toContain('period ended');
  });

  it('what has been said is not said again: later ticks queue nothing', async () => {
    await occurrence('2026-W41', { status: 'failed' });

    await planner.noticeFailures();
    await expect(planner.noticeFailures()).resolves.toBe(0);
    expect(await told()).toHaveLength(1);
  });

  /**
   * A failure between the delivery queue and the mark: the retry queues the same key, not a second
   * message.
   */
  it('when the mark is lost after queuing, the retry yields no second message', async () => {
    const { id } = await occurrence('2026-W41', { status: 'failed' });

    await planner.noticeFailures();
    await prisma.reviewOccurrence.update({ where: { id }, data: { failureNoticedAt: null } });

    await expect(planner.noticeFailures()).resolves.toBe(1);
    expect(await told()).toHaveLength(1);
  });

  it('an occurrence that took place and one that is still waiting yield no message', async () => {
    await occurrence('2026-W40', { status: 'done' });
    await occurrence('2026-W41');

    await expect(planner.noticeFailures()).resolves.toBe(0);
    expect(await told()).toEqual([]);
  });
});
