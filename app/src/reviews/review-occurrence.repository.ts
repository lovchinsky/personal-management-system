import { Injectable } from '@nestjs/common';
import { ReviewOccurrence } from '../generated/prisma/client';
import { PrismaService } from '../platform/db/prisma.service';
import type { ReviewMode } from '../runs/trigger-envelope';

/** An occurrence as the producer places it. */
interface PlannedOccurrence {
  readonly mode: ReviewMode;
  readonly occurrenceKey: string;
  readonly dueAt: Date;
  readonly closesAt: Date;
  readonly sinceAt: Date;
}

/**
 * Occurrence rows from the producer's side. The source manages the run of a row
 * (`ReviewOccurrenceRunSource`).
 */
@Injectable()
export class ReviewOccurrenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async exists(mode: ReviewMode, occurrenceKey: string): Promise<boolean> {
    const found = await this.prisma.reviewOccurrence.findUnique({
      where: { mode_occurrenceKey: { mode, occurrenceKey } },
      select: { id: true },
    });

    return found !== null;
  }

  /**
   * Places an occurrence. The same occurrence is not placed twice: it is unique per review and
   * period key. `false` means it was already there.
   */
  async place(occurrence: PlannedOccurrence): Promise<boolean> {
    const { count } = await this.prisma.reviewOccurrence.createMany({
      data: [occurrence],
      skipDuplicates: true,
    });

    return count === 1;
  }

  /**
   * Returns the occurrences that did not take place and that the person has not yet been told
   * about, oldest first.
   */
  unnoticedFailures(): Promise<ReviewOccurrence[]> {
    return this.prisma.reviewOccurrence.findMany({
      where: { status: 'failed', failureNoticedAt: null },
      orderBy: { dueAt: 'asc' },
    });
  }

  /**
   * Marks that the person has been told: an occurrence that did not take place no longer awaits a
   * notice.
   */
  async markFailureNoticed(id: string): Promise<void> {
    await this.prisma.reviewOccurrence.update({
      where: { id },
      data: { failureNoticedAt: new Date() },
    });
  }

  /**
   * Returns the time of a review's last carried-out occurrence before `before`; `null` means there
   * was none.
   */
  async lastDone(mode: ReviewMode, before: Date): Promise<Date | null> {
    const row = await this.prisma.reviewOccurrence.findFirst({
      where: { mode, status: 'done', dueAt: { lt: before } },
      orderBy: { dueAt: 'desc' },
      select: { dueAt: true },
    });

    return row?.dueAt ?? null;
  }
}
