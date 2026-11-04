import { Injectable } from '@nestjs/common';
import { ReviewOccurrence } from '../generated/prisma/client';
import { PrismaService } from '../platform/db/prisma.service';
import { RunRowSource } from '../runs/run-row-source';
import { RunRowPolicy } from '../runs/run-row.policy';
import { reviewOccurrenceRows } from './review-occurrence.rows';

/**
 * A review occurrence that has come due is a source of runs. The rules of a run row are shared by
 * all queues (`RunRowSource`), so the class only passes the description of the queue.
 */
@Injectable()
export class ReviewOccurrenceRunSource extends RunRowSource<ReviewOccurrence> {
  constructor(prisma: PrismaService, policy: RunRowPolicy) {
    super(prisma, policy, reviewOccurrenceRows(prisma));
  }
}
