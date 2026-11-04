import { Test } from '@nestjs/testing';
import { addMinutes } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { appConfig } from '../../src/config/app.config';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { parseSchedule } from '../../src/platform/time/schedule';
import { workersConfig } from '../../src/platform/worker/workers.config';
import { ReviewOccurrenceRepository } from '../../src/reviews/review-occurrence.repository';
import { reviewOccurrenceEnvelope } from '../../src/reviews/review-occurrence.rows';
import { ReviewPlanner } from '../../src/reviews/review.planner';
import { reviewsConfig, type ReviewsConfig } from '../../src/reviews/reviews.config';
import { RunGates } from '../../src/runs/run-gates';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

const ZONE = 'Europe/Kyiv';

/** Builds the test's schedules: the reviews the test does not concern are off. */
function schedules(daily: string, weekly = 'off', strategic = 'off'): ReviewsConfig['schedules'] {
  return {
    daily_control: parseSchedule(daily),
    weekly_control_review: parseSchedule(weekly),
    strategic_review: parseSchedule(strategic),
    deep_review: parseSchedule('off'),
  };
}

/** Ticks the producer from `from` to `to` in steps of `stepMinutes`. */
async function tickThrough(
  planner: ReviewPlanner,
  from: string,
  to: string,
  stepMinutes: number,
): Promise<void> {
  for (let at = new Date(from); at <= new Date(to); at = addMinutes(at, stepMinutes)) {
    await planner.plan(at);
  }
}

/**
 * The producer of review occurrences against a real database, with a given “now”
 * (`docs/2-system.md` § “Schedule and recurrence”, ADR 0036).
 */
describe('INV-103 a scheduled review has one occurrence per period, across a clock change too', () => {
  const config: { schedules: ReviewsConfig['schedules']; tickSeconds: number } = {
    schedules: schedules('daily 08:30'),
    tickSeconds: 60,
  };
  let channel = true;
  let runner = true;
  let prisma: PrismaService;
  let planner: ReviewPlanner;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, workersConfig)],
      providers: [
        PrismaService,
        ReviewOccurrenceRepository,
        ReviewPlanner,
        {
          provide: DeliveryService,
          useValue: { hasChannel: () => channel, proposalsShown: () => Promise.resolve([]) },
        },
        { provide: ApprovalsService, useValue: { lapseShown: () => Promise.resolve(0) } },
        {
          provide: RunGates,
          useValue: {
            get runnerWired() {
              return runner;
            },
          },
        },
        { provide: reviewsConfig.KEY, useValue: config },
        { provide: appConfig.KEY, useValue: { ...appConfig(), timeZone: ZONE } },
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    planner = moduleRef.get(ReviewPlanner);
    close = () => moduleRef.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    channel = true;
    runner = true;
    config.schedules = schedules('daily 08:30');
  });

  afterAll(async () => {
    await close();
  });

  const placed = (): Promise<{ mode: string; occurrenceKey: string; dueAt: Date }[]> =>
    prisma.reviewOccurrence.findMany({
      select: { mode: true, occurrenceKey: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
    });

  it('ticks over a week yield one occurrence per day and one per week', async () => {
    config.schedules = schedules('daily 08:30', 'weekly sun 18:00');

    await tickThrough(planner, '2026-10-12T05:00:00Z', '2026-10-19T04:59:00Z', 30);

    const rows = await placed();

    expect(rows.filter((row) => row.mode === 'daily_control')).toHaveLength(7);
    // The weekly review's window runs until the next occurrence, so last Sunday's occurrence still
    // stands.
    expect(rows.filter((row) => row.mode === 'weekly_control_review')).toEqual([
      {
        mode: 'weekly_control_review',
        occurrenceKey: '2026-W41',
        dueAt: new Date('2026-10-11T15:00:00.000Z'),
      },
      {
        mode: 'weekly_control_review',
        occurrenceKey: '2026-W42',
        dueAt: new Date('2026-10-18T15:00:00.000Z'),
      },
    ]);
  });

  /** In Kyiv on March 29, 03:00 becomes 04:00: 03:30 does not exist that day and shifts forward. */
  it('an hour skipped by the clock change: the occurrence is neither lost nor duplicated', async () => {
    config.schedules = schedules('daily 03:30');

    await tickThrough(planner, '2026-03-28T00:00:00Z', '2026-03-30T21:59:00Z', 20);

    expect(await placed()).toEqual([
      expect.objectContaining({
        occurrenceKey: '2026-03-28',
        dueAt: new Date('2026-03-28T01:30:00.000Z'),
      }),
      expect.objectContaining({
        occurrenceKey: '2026-03-29',
        dueAt: new Date('2026-03-29T01:30:00.000Z'),
      }),
      expect.objectContaining({
        occurrenceKey: '2026-03-30',
        dueAt: new Date('2026-03-30T00:30:00.000Z'),
      }),
    ]);
  });

  /**
   * On October 25, 04:00 becomes 03:00: 03:30 occurs twice, and there is one occurrence, the
   * first.
   */
  it('an hour doubled by the clock change: one occurrence, at the first of the two instants', async () => {
    config.schedules = schedules('daily 03:30');

    await tickThrough(planner, '2026-10-24T00:00:00Z', '2026-10-26T21:59:00Z', 20);

    expect(await placed()).toEqual([
      expect.objectContaining({
        occurrenceKey: '2026-10-24',
        dueAt: new Date('2026-10-24T00:30:00.000Z'),
      }),
      expect.objectContaining({
        occurrenceKey: '2026-10-25',
        dueAt: new Date('2026-10-25T00:30:00.000Z'),
      }),
      expect.objectContaining({
        occurrenceKey: '2026-10-26',
        dueAt: new Date('2026-10-26T01:30:00.000Z'),
      }),
    ]);
  });

  it('an edit of the time within the period yields no second occurrence', async () => {
    await planner.plan(new Date('2026-10-15T06:00:00Z'));

    config.schedules = schedules('daily 10:00');
    await planner.plan(new Date('2026-10-15T07:30:00Z'));

    expect(await placed()).toHaveLength(1);
  });

  it('when the window has ended, no occurrence is scheduled', async () => {
    await planner.plan(new Date('2026-10-15T21:10:00Z'));

    expect(await placed()).toEqual([]);
  });

  it('without a delivery channel no review is scheduled', async () => {
    channel = false;

    await planner.plan(new Date('2026-10-15T06:00:00Z'));

    expect(await placed()).toEqual([]);
  });

  /**
   * Without a runner the occurrence would only wait for the end of the window: a failure although
   * nothing is broken, not a review.
   */
  it('with no runner no review is scheduled, and once there is one it is still scheduled in the same window', async () => {
    runner = false;

    await planner.plan(new Date('2026-10-15T06:00:00Z'));

    expect(await placed()).toEqual([]);

    runner = true;

    await planner.plan(new Date('2026-10-15T12:00:00Z'));

    expect(await placed()).toEqual([expect.objectContaining({ occurrenceKey: '2026-10-15' })]);
  });

  describe('since, the bound of “what changed since the last review”', () => {
    const envelopeAt = async (now: string): Promise<unknown> => {
      await planner.plan(new Date(now));

      const row = await prisma.reviewOccurrence.findFirstOrThrow({ orderBy: { dueAt: 'desc' } });

      return reviewOccurrenceEnvelope(row);
    };

    it('the first time: one period back', async () => {
      await expect(envelopeAt('2026-10-15T06:00:00Z')).resolves.toEqual({
        mode: 'daily_control',
        trigger: {
          type: 'review.daily_control',
          event_id: 'review:daily_control:2026-10-15',
          timestamp: '2026-10-15T05:30:00.000Z',
          since: '2026-10-14T05:30:00.000Z',
        },
      });
    });

    it('from the last occurrence that took place, even when one was missed', async () => {
      await prisma.reviewOccurrence.create({
        data: {
          mode: 'daily_control',
          occurrenceKey: '2026-10-13',
          dueAt: new Date('2026-10-13T05:30:00Z'),
          closesAt: new Date('2026-10-13T21:00:00Z'),
          sinceAt: new Date('2026-10-12T05:30:00Z'),
          status: 'done',
        },
      });

      await expect(envelopeAt('2026-10-15T06:00:00Z')).resolves.toMatchObject({
        trigger: { since: '2026-10-13T05:30:00.000Z' },
      });
    });

    it('no further back than two periods', async () => {
      await prisma.reviewOccurrence.create({
        data: {
          mode: 'daily_control',
          occurrenceKey: '2026-10-01',
          dueAt: new Date('2026-10-01T05:30:00Z'),
          closesAt: new Date('2026-10-01T21:00:00Z'),
          sinceAt: new Date('2026-09-30T05:30:00Z'),
          status: 'done',
        },
      });

      await expect(envelopeAt('2026-10-15T06:00:00Z')).resolves.toMatchObject({
        trigger: { since: '2026-10-13T05:30:00.000Z' },
      });
    });
  });
});
