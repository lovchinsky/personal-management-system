import { Injectable } from '@nestjs/common';
import { ScheduledCheck } from '../generated/prisma/client';
import { PrismaService } from '../platform/db/prisma.service';
import { RunRowSource } from '../runs/run-row-source';
import { RunRowPolicy } from '../runs/run-row.policy';
import { scheduledCheckRows } from './scheduled-check.rows';

/**
 * A continuation that has come due is a run source. The rules for run rows are shared by all
 * queues (`RunRowSource`), so the class only passes on the description of the queue.
 */
@Injectable()
export class ScheduledCheckRunSource extends RunRowSource<ScheduledCheck> {
  constructor(prisma: PrismaService, policy: RunRowPolicy) {
    super(prisma, policy, scheduledCheckRows(prisma));
  }
}
