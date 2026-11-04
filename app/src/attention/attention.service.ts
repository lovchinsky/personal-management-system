import { Inject, Injectable, Logger } from '@nestjs/common';
import { isNotionClientError } from '@notionhq/client';
import { ApprovalsService } from '../approvals/approvals.service';
import { appConfig, type AppConfig } from '../config/app.config';
import { ContinuationsService } from '../continuations/continuations.service';
import { WorkflowMode } from '../generated/prisma/enums';
import { canonicalNotionId } from '../notion/client/notion-id';
import { NotionAccessError } from '../notion/client/notion.error';
import { CommentTarget, NotionWriter, WrittenComment } from '../notion/client/notion.writer';
import { PageReader } from '../notion/client/page.reader';
import { SemanticAdapter } from '../notion/semantics/semantic.adapter';
import { messageOf } from '../platform/error/message-of';
import { parsedRequest } from '../platform/request/invalid-request';
import { Actor } from '../runs/actor';
import { EventMode } from '../runs/trigger-envelope';
import { textsOf } from '../texts/texts';
import { Comment, CommentRequest, commentSchema, MAX_COMMENT_CHARS } from './comment.schema';
import { SystemDiscussionRepository } from './system-discussion.repository';

/** A thread the system has commented in, with its anchor and the system's last comment in it. */
export interface WrittenThread {
  readonly discussionId: string;
  readonly pageId: string;
  /** The block the thread is attached to; `null` means the thread is on the page. */
  readonly blockId: string | null;
  /** `null` means the row has no last comment; reconciliation decides nothing about the thread. */
  readonly lastCommentId: string | null;
  readonly lastWrittenAt: Date;
}

/**
 * The system's attention in Notion: a comment in the system's voice and the threads it manages.
 *
 * The system writes a comment the person can reply to only here, through `NotionWriter`, as the
 * integration bot (ADR 0017). So the App knows every thread the system has commented in and
 * recognizes the person's reply in it without querying Notion (`INV-089`). The origin comment
 * that goes with an Inbox item into the trash is written by capture: no conversation will happen
 * on a page in the trash.
 */
@Injectable()
export class AttentionService {
  private readonly logger = new Logger(AttentionService.name);

  constructor(
    private readonly writer: NotionWriter,
    private readonly pages: PageReader,
    private readonly semantics: SemanticAdapter,
    private readonly discussions: SystemDiscussionRepository,
    private readonly continuations: ContinuationsService,
    private readonly approvals: ApprovalsService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * Check a comment without writing anything. The reply thread is either a real thread or one
   * opened by a comment of the same run. In the second case the real id replaces the thread's
   * temporary id when the comment is applied.
   */
  check(request: CommentRequest): Comment {
    return parsedRequest(commentSchema, request, 'comment');
  }

  /**
   * Write a comment in the system's voice and record its thread in the registry. A thread the
   * comment opened appears in the registry with the very first write.
   */
  async comment(actor: Actor, request: CommentRequest): Promise<WrittenComment> {
    const comment = this.check(request);
    const target: CommentTarget = comment.discussionId
      ? { discussionId: comment.discussionId }
      : { pageId: comment.pageId };
    const written = await this.writer.comment(target, comment.text);
    const discussionId = canonicalNotionId(written.discussionId);
    // Notion returns the page when the thread is on a page; for a thread on a block it returns the
    // block, and the page then stays the one the request specified.
    const pageId = written.pageId === null ? comment.pageId : canonicalNotionId(written.pageId);
    const known = await this.discussions.find(discussionId);

    await this.discussions.wrote({
      discussionId,
      pageId,
      blockId: written.blockId === null ? null : canonicalNotionId(written.blockId),
      commentId: canonicalNotionId(written.commentId),
      mode: known?.mode ?? (await this.openingMode(actor, pageId)),
    });

    return written;
  }

  /**
   * The mode in which the person's reply continues in the thread this write opens. A reply about
   * an Inbox item counts as processing that item, so a thread on an Inbox page always continues
   * in `dialogue`, whoever opened it; every other thread continues in the mode of whoever opened
   * it. If Notion does not return the page type, the author's mode stays.
   */
  private async openingMode(actor: Actor, pageId: string): Promise<WorkflowMode> {
    const authored: WorkflowMode = actor.kind === 'run' ? actor.mode : 'dialogue';

    if (authored === 'dialogue') return authored;

    try {
      const page = await this.pages.page(pageId);
      const type =
        page.dataSourceId === null ? undefined : this.semantics.typeOfDataSource(page.dataSourceId);

      return type === 'inbox_item' ? 'dialogue' : authored;
    } catch (error) {
      if (!isNotionClientError(error) && !(error instanceof NotionAccessError)) throw error;

      this.logger.warn(`page ${pageId} not read for the thread's mode: ${messageOf(error)}`);

      return authored;
    }
  }

  /**
   * Carry the person's words from a channel into the thread the person replied to.
   *
   * The system does not write the person's words in Notion; the person does. But a channel reply
   * must end up where both the run and the person will see it, and the trigger envelope carries
   * no text (`INV-030`). So the words go in as a bot comment with the mark `quotedFrom(channel)`.
   * The Skill reads a comment with that mark as the person's words, not as the system's voice.
   * The mark is for the model, which does not see the display name. Notion shows the person the
   * comment under a kind label (ADR 0043).
   *
   * The registry of threads does not change: the thread is already managed, and its mode stays the
   * one the system opened it in. If the words are too long for one comment, they are split into
   * consecutive comments: what the person said must not be cut off silently. The method returns
   * the thread's page.
   */
  async quote(discussionId: string, channel: string, words: string): Promise<string> {
    const id = canonicalNotionId(discussionId);
    const mark = quotedFrom(channel);
    const label = textsOf(this.app.language).comments.labels.channelReply(channel);
    let pageId: string | null = null;

    for (const part of parts(words, MAX_COMMENT_CHARS - mark.length - 1)) {
      const written = await this.writer.comment({ discussionId: id }, `${mark}\n${part}`, {
        label,
      });

      pageId ??= written.pageId === null ? null : canonicalNotionId(written.pageId);
    }

    return pageId ?? (await this.discussions.find(id))?.pageId ?? missingPage(id);
  }

  /**
   * Whether the system manages a thread, and in which mode the person's reply in it continues
   * (`contracts/canonical.yaml`, key `system_discussion`). `null` means the thread is not the
   * system's: a comment in it is an ordinary page change.
   */
  async managed(discussionId: string): Promise<EventMode | null> {
    const id = canonicalNotionId(discussionId);
    const written = await this.discussions.find(id);

    if (written) {
      return written.mode === 'dialogue' ? 'dialogue' : 'event_evaluation';
    }

    const followed =
      (await this.continuations.hasOpenFor(id)) || (await this.approvals.hasOpenFor(id));

    return followed ? 'event_evaluation' : null;
  }

  /**
   * Threads the system manages and has commented in, where its work is still active: the system
   * commented in them within the last `days` days, or a continuation or proposal is open on them.
   * A thread that the system manages because a continuation or proposal is open on it, and has
   * not commented in, is not among them: the registry knows neither its anchor nor its comment.
   */
  async writtenThreads(days: number): Promise<WrittenThread[]> {
    const followed = new Set([
      ...(await this.continuations.openDiscussions()),
      ...(await this.approvals.openDiscussions()),
    ]);
    const rows = await this.discussions.writtenSince(days, [...followed]);

    return rows.map(({ discussionId, pageId, blockId, lastCommentId, lastWrittenAt }) => ({
      discussionId,
      pageId,
      blockId,
      lastCommentId,
      lastWrittenAt,
    }));
  }

  /** Prune the threads the system has not commented in for a long time. */
  pruneStale(days: number): Promise<number> {
    return this.discussions.pruneStale(days);
  }
}

/** The mark a comment starts with when it carries the person's words over from a channel. */
export function quotedFrom(channel: string): string {
  return `Person's reply via ${channel}:`;
}

/** Split the words into chunks that do not exceed the comment limit, in the same order. */
function parts(words: string, size: number): string[] {
  const chunks: string[] = [];

  for (let at = 0; at < words.length; at += size) {
    chunks.push(words.slice(at, at + size));
  }

  return chunks;
}

function missingPage(discussionId: string): never {
  throw new Error(`discussion ${discussionId}: Notion names no page and the registry has none`);
}
