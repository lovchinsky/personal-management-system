import { Injectable } from '@nestjs/common';
import { subDays } from 'date-fns';
import { Prisma, SystemDiscussion } from '../generated/prisma/client';
import { WorkflowMode } from '../generated/prisma/enums';
import { PrismaService } from '../platform/db/prisma.service';
import { olderThanDays } from '../platform/db/sql';

/** What an applied system comment leaves in the registry. */
export interface SystemWrite {
  readonly discussionId: string;
  readonly pageId: string;
  /** The block the thread is attached to; `null` means the thread is on the page. */
  readonly blockId: string | null;
  readonly commentId: string;
  readonly mode: WorkflowMode;
}

/**
 * The registry of discussions the system has commented in (`docs/2-system.md`
 * § “`system_discussions`”). The database clock supplies its times, the same clock that pruning
 * measures age by.
 */
@Injectable()
export class SystemDiscussionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record that the system commented in a thread. The first write creates a row with the mode in
   * which the person's reply continues. Later writes update the time of the last write and the
   * last comment; the thread's page and mode do not change. The thread's block stays known even
   * when a later Notion response omits it.
   */
  async wrote(write: SystemWrite): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "system_discussions"
             ("discussion_id", "page_id", "mode", "block_id", "last_comment_id")
      VALUES (${write.discussionId}, ${write.pageId}, ${write.mode}::"WorkflowMode",
              ${write.blockId}, ${write.commentId})
      ON CONFLICT ("discussion_id") DO UPDATE
         SET "block_id" = COALESCE(EXCLUDED."block_id", "system_discussions"."block_id"),
             "last_comment_id" = EXCLUDED."last_comment_id",
             "last_written_at" = now()
    `);
  }

  find(discussionId: string): Promise<SystemDiscussion | null> {
    return this.prisma.systemDiscussion.findUnique({ where: { discussionId } });
  }

  /**
   * Threads the system commented in within the last `days` days, plus the threads in `also`
   * regardless of age.
   */
  writtenSince(days: number, also: readonly string[]): Promise<SystemDiscussion[]> {
    return this.prisma.systemDiscussion.findMany({
      where: {
        OR: [
          { lastWrittenAt: { gte: subDays(new Date(), days) } },
          { discussionId: { in: [...also] } },
        ],
      },
      orderBy: { discussionId: 'asc' },
    });
  }

  /** Prune the threads the system has not commented in for `days` days. */
  pruneStale(days: number): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "system_discussions"
       WHERE ${olderThanDays('last_written_at', days)}
    `);
  }
}
