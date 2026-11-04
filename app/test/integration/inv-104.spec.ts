import { Test } from '@nestjs/testing';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { PreconditionEvaluator } from '../../src/approvals/preconditions/precondition.evaluator';
import { appConfig } from '../../src/config/app.config';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { outboxConfig } from '../../src/delivery/outbox/outbox.config';
import { OutboxRepository } from '../../src/delivery/outbox/outbox.repository';
import { QuietHours } from '../../src/delivery/outbox/quiet-hours';
import { NotificationChannel } from '../../src/delivery/port/channel.port';
import { ChannelRegistry } from '../../src/delivery/port/channel.registry';
import { NotificationDeliveryStatus } from '../../src/generated/prisma/enums';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { parseSchedule } from '../../src/platform/time/schedule';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { ReviewOccurrenceRepository } from '../../src/reviews/review-occurrence.repository';
import { ReviewPlanner } from '../../src/reviews/review.planner';
import { reviewsConfig } from '../../src/reviews/reviews.config';
import { RunGates } from '../../src/runs/run-gates';
import { testConfig, unreached } from '../fixtures/test-module';
import { truncateAll } from './database';

const SHOWN = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const UNSENT = '9b2d5c1e-3f4a-4b6c-8d7e-1a2b3c4d5e6f';
const WEEKLY = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const HIDDEN = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';

/** A channel that delivers: reviews are not scheduled without it. */
const CHANNEL: NotificationChannel = {
  id: 'telegram',
  capabilities: { interactiveActions: true },
  excess: () => 0,
  send: () => Promise.resolve({ ok: true }),
};

/**
 * Expiry of proposals by Daily Control against a real database: the occurrence producer, delivery
 * and approvals are real (ADR 0039).
 */
describe('INV-104 only a proposal shown by a delivered Daily Control packet expires', () => {
  let prisma: PrismaService;
  let planner: ReviewPlanner;
  let outbox: OutboxRepository;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, workersConfig, outboxConfig)],
      providers: [
        PrismaService,
        ReviewOccurrenceRepository,
        ReviewPlanner,
        OutboxRepository,
        DeliveryService,
        { provide: QuietHours, useValue: { silentUntil: () => null } },
        { provide: RunGates, useValue: { runnerWired: true } },
        { provide: ChannelRegistry, useValue: new ChannelRegistry([CHANNEL]) },
        PendingActionRepository,
        ApprovalsService,
        unreached(PreconditionEvaluator),
        unreached(SemanticAdapter),
        {
          provide: reviewsConfig.KEY,
          useValue: {
            schedules: {
              daily_control: parseSchedule('daily 08:30'),
              weekly_control_review: parseSchedule('off'),
              strategic_review: parseSchedule('off'),
              deep_review: parseSchedule('off'),
            },
            tickSeconds: 60,
          },
        },
        { provide: appConfig.KEY, useValue: { ...appConfig(), timeZone: 'Europe/Kyiv' } },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    planner = moduleRef.get(ReviewPlanner);
    outbox = moduleRef.get(OutboxRepository);
    close = () => moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  const proposal = (id: string, status: 'proposed' | 'approved' = 'proposed'): Promise<unknown> =>
    prisma.pendingAction.create({
      data: {
        id,
        notionPageId: `page-${id}`,
        fingerprint: `fp-${id}`,
        effects: [],
        preconditions: [],
        status,
      },
    });

  /**
   * Queues a review packet with a proposal the way delivery queues it, and brings it to the named
   * status.
   */
  const packet = async (
    cause: string,
    pendingActionId: string,
    status: NotificationDeliveryStatus,
  ): Promise<void> => {
    const row = await outbox.enqueue({
      channel: 'telegram',
      idempotencyKey: `event:${cause}`,
      quietHoursExempt: true,
      message: {
        noticed: 'Ранковий огляд',
        whyItMatters: 'Чекає рішення',
        ask: 'Схвалити?',
        link: 'https://www.notion.so/page-1',
        proposals: [{ pendingActionId, line: 'Закрити задачу' }],
      },
    });

    await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status } });
  };

  const statusOf = async (id: string): Promise<string | undefined> =>
    (await prisma.pendingAction.findUnique({ where: { id } }))?.status;

  it('the next Daily Control occurrence expires the proposal shown by a delivered packet, and nothing else', async () => {
    await proposal(SHOWN);
    await proposal(UNSENT);
    await proposal(WEEKLY);
    await proposal(HIDDEN);
    await packet('review:daily_control:2026-10-14', SHOWN, 'sent');
    await packet('review:daily_control:2026-10-13', UNSENT, 'failed');
    await packet('review:weekly_control_review:2026-W41', WEEKLY, 'sent');

    await planner.plan(new Date('2026-10-15T06:00:00Z'));

    await expect(statusOf(SHOWN)).resolves.toBe('expired');
    await expect(statusOf(UNSENT)).resolves.toBe('proposed');
    await expect(statusOf(WEEKLY)).resolves.toBe('proposed');
    await expect(statusOf(HIDDEN)).resolves.toBe('proposed');
  });

  it('expiry does not touch a shown proposal that is already approved', async () => {
    await proposal(SHOWN, 'approved');
    await packet('review:daily_control:2026-10-14', SHOWN, 'sent');

    await planner.plan(new Date('2026-10-15T06:00:00Z'));

    await expect(statusOf(SHOWN)).resolves.toBe('approved');
  });

  /** A missed day does not leave a shown proposal unexpired forever: any earlier packet counts. */
  it('also expires a proposal shown by a packet of an earlier day', async () => {
    await proposal(SHOWN);
    await packet('review:daily_control:2026-10-10', SHOWN, 'sent');

    await planner.plan(new Date('2026-10-15T06:00:00Z'));

    await expect(statusOf(SHOWN)).resolves.toBe('expired');
  });

  it('expiry happens when a new occurrence is scheduled, not on every tick', async () => {
    await planner.plan(new Date('2026-10-15T06:00:00Z'));
    await proposal(SHOWN);
    await packet('review:daily_control:2026-10-15', SHOWN, 'sent');

    await planner.plan(new Date('2026-10-15T09:00:00Z'));

    await expect(statusOf(SHOWN)).resolves.toBe('proposed');
  });
});
