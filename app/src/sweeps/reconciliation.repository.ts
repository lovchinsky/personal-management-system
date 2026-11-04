import { Injectable } from '@nestjs/common';
import { DiscussionReconciliation, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../platform/db/prisma.service';

/** What the reconciliation learned about a thread this time. */
type Observation = Pick<
  Prisma.DiscussionReconciliationUncheckedCreateInput,
  'seenOpenAt' | 'closureRequestedAt' | 'goneAt'
>;

/**
 * The memory of resolved-thread reconciliation: when a thread was seen open, when its closure was
 * requested and when it was found deleted (`docs/2-system.md` § “Resolved-thread
 * reconciliation”).
 */
@Injectable()
export class ReconciliationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async of(discussionIds: readonly string[]): Promise<Map<string, DiscussionReconciliation>> {
    const rows = await this.prisma.discussionReconciliation.findMany({
      where: { discussionId: { in: [...discussionIds] } },
    });

    return new Map(rows.map((row) => [row.discussionId, row]));
  }

  /** Records that the reconciliation asked Notion about a thread at `at`, and what it learned. */
  async observe(discussionId: string, at: Date, observation: Observation = {}): Promise<void> {
    const data = { ...observation, checkedAt: at };

    await this.prisma.discussionReconciliation.upsert({
      where: { discussionId },
      create: { discussionId, ...data },
      update: data,
    });
  }

  /** Forgets threads outside the reconciliation's scope. */
  async keepOnly(discussionIds: readonly string[]): Promise<number> {
    const { count } = await this.prisma.discussionReconciliation.deleteMany({
      where: { discussionId: { notIn: [...discussionIds] } },
    });

    return count;
  }
}
