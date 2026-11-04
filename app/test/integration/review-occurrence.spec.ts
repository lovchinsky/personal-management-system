import { Test } from '@nestjs/testing';
import { addHours, subDays, subHours } from 'date-fns';
import { appConfig } from '../../src/config/app.config';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { ReviewOccurrenceRunSource } from '../../src/reviews/review-occurrence.run-source';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunRowPolicy } from '../../src/runs/run-row.policy';
import { runsConfig } from '../../src/runs/runs.config';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';

/**
 * A review occurrence as a run queue: the origin, the envelope, retirement after the window and
 * pruning that keeps the last occurrence that took place (ADR 0036).
 */
describe('a review occurrence as a run queue', () => {
  let prisma: PrismaService;
  let source: ReviewOccurrenceRunSource;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig, appConfig, budgetConfig, runsConfig)],
      providers: [PrismaService, RunRowPolicy, ReviewOccurrenceRunSource],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    source = moduleRef.get(ReviewOccurrenceRunSource);
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
    dueAt: Date,
    overrides: { closesAt?: Date; status?: 'done' | 'failed'; updatedAt?: Date } = {},
  ): Promise<{ id: string }> =>
    prisma.reviewOccurrence.create({
      data: {
        mode: 'weekly_control_review',
        occurrenceKey,
        dueAt,
        closesAt: overrides.closesAt ?? addHours(dueAt, 24 * 7),
        sinceAt: subDays(dueAt, 7),
        ...(overrides.status ? { status: overrides.status } : {}),
      },
      select: { id: true },
    });

  it('a due occurrence is a candidate with the review schedule origin and its envelope is a review', async () => {
    const due = subHours(new Date(), 1);

    await occurrence('2026-W42', due);

    const [candidate] = await source.candidates();

    expect(candidate?.provenance).toEqual({ origin: 'review_schedule' });

    const run = await candidate?.claim();

    expect(run?.request.envelope).toEqual({
      mode: 'weekly_control_review',
      trigger: {
        type: 'review.weekly_control_review',
        event_id: 'review:weekly_control_review:2026-W42',
        timestamp: due.toISOString(),
        since: subDays(due, 7).toISOString(),
      },
    });
  });

  it('an occurrence whose window has ended is retired with a reason and is not claimed', async () => {
    const { id } = await occurrence('2026-W40', subDays(new Date(), 8), {
      closesAt: subDays(new Date(), 1),
    });

    await source.retire();

    const retired = await prisma.reviewOccurrence.findUniqueOrThrow({ where: { id } });

    expect(retired.status).toBe('failed');
    expect(retired.lastError).toContain('period ended');
    await expect(source.candidates()).resolves.toEqual([]);
  });

  /** A review is the same run queue: the Notion wait rule is shared (ADR 0045). */
  it('an occurrence whose run did not reach Notion waits, and the review window applies to it too', async () => {
    const { id } = await occurrence('2026-W43', subHours(new Date(), 1));
    const run = await source.claim(id);

    await run?.recordAttempt();

    await expect(run?.waitForNotion('run deferred: Notion was not reached')).resolves.toBe(true);
    await expect(source.candidates()).resolves.toEqual([]);

    const held = await prisma.reviewOccurrence.findUniqueOrThrow({ where: { id } });

    expect(held.attemptCount).toBe(0);
    expect(held.notionHoldUntil).not.toBeNull();

    await prisma.reviewOccurrence.update({
      where: { id },
      data: { closesAt: subHours(new Date(), 1) },
    });
    await source.retire();

    await expect(
      prisma.reviewOccurrence.findUniqueOrThrow({ where: { id } }).then((row) => row.status),
    ).resolves.toBe('failed');
  });

  it('pruning keeps the last occurrence that took place for each review', async () => {
    const older = await occurrence('2026-W38', subDays(new Date(), 28), { status: 'done' });
    const latest = await occurrence('2026-W40', subDays(new Date(), 14), { status: 'done' });

    await prisma.reviewOccurrence.updateMany({ data: { updatedAt: subDays(new Date(), 30) } });

    await source.pruneConcluded(7);

    const left = await prisma.reviewOccurrence.findMany({ select: { id: true } });

    expect(left).toEqual([{ id: latest.id }]);
    expect(left).not.toContainEqual({ id: older.id });
  });
});
