import { Inject, Injectable, Logger } from '@nestjs/common';
import { AttentionService, type WrittenThread } from '../attention/attention.service';
import { ContinuationsService } from '../continuations/continuations.service';
import { DiscussionReconciliation } from '../generated/prisma/client';
import { CommentsReader } from '../notion/client/comments.reader';
import { needsAttention, notionFailureOf } from '../notion/semantics/notion-failure';
import { messageOf, stackOf } from '../platform/error/message-of';
import { ReconciliationRepository } from './reconciliation.repository';
import { sweepConfig, type SweepConfig } from './sweep.config';

/**
 * A thread whose anchor and comment the registry knows: the reconciliation can reach a conclusion
 * only about a thread of this kind.
 */
type AnchoredThread = WrittenThread & { readonly lastCommentId: string };

function isAnchored(thread: WrittenThread): thread is AnchoredThread {
  return thread.lastCommentId !== null;
}

/** Returns the latest of the instants. `null` means there is none. */
function latest(...moments: readonly (Date | null | undefined)[]): Date | null {
  const known = moments.filter((moment): moment is Date => moment instanceof Date);

  return known.length === 0 ? null : new Date(Math.max(...known.map((m) => m.getTime())));
}

/**
 * Resolved-thread reconciliation. When a thread the reconciliation has seen open is no longer among
 * the unresolved ones and the system's comment in it is readable, the App requests closure
 * (`docs/2-system.md` § “Resolved-thread reconciliation”, ADR 0038).
 *
 * The scope is the threads in which the system has commented and where its work is still active
 * (`writtenThreads`). Notion returns unresolved threads by anchor, and returns the threads of a
 * block only by the block id. So the reconciliation queries the anchor the registry knows, one
 * query per anchor. Anchors are visited in rotation: the ones the reconciliation queried least
 * recently come first.
 *
 * For a thread that is not among the unresolved:
 * - it was seen open after the last conclusion: if its comment is readable, it is resolved and
 *   closure is requested; if not, it is deleted and there is no closure;
 * - a conclusion made after it was seen open already exists: nothing happens, because the
 *   reconciliation does not repeat a failed closure.
 *
 * A thread also counts as seen open at the time the system commented in it: a write goes only to
 * an open thread. An anchor is a unit of work. An anchor that was not read yields no conclusion in
 * this tick, but the query is counted, so the next tick goes on to other anchors instead of
 * getting stuck on the same one.
 */
@Injectable()
export class ResolutionReconciler {
  private readonly logger = new Logger(ResolutionReconciler.name);

  constructor(
    private readonly attention: AttentionService,
    private readonly comments: CommentsReader,
    private readonly continuations: ContinuationsService,
    private readonly memory: ReconciliationRepository,
    @Inject(sweepConfig.KEY) private readonly config: SweepConfig,
  ) {}

  /** Runs one pass and returns how many closures were requested. */
  async reconcile(now = new Date()): Promise<number> {
    const { horizonDays, anchorsPerTick } = this.config.reconciliation;
    const threads = await this.attention.writtenThreads(horizonDays);

    await this.memory.keepOnly(threads.map((thread) => thread.discussionId));

    const anchored = threads.filter(isAnchored);
    const known = await this.memory.of(anchored.map((thread) => thread.discussionId));
    const anchors = new Map<string, AnchoredThread[]>();

    for (const thread of anchored) {
      const anchor = thread.blockId ?? thread.pageId;

      anchors.set(anchor, [...(anchors.get(anchor) ?? []), thread]);
    }

    const askedAt = (group: readonly AnchoredThread[]): number =>
      Math.min(
        ...group.map((thread) => known.get(thread.discussionId)?.checkedAt?.getTime() ?? -Infinity),
      );
    const chosen = [...anchors.entries()]
      .sort(([, one], [, other]) => askedAt(one) - askedAt(other))
      .slice(0, anchorsPerTick);
    let requested = 0;

    for (const [anchor, group] of chosen) {
      const open = await this.openAt(anchor);

      for (const thread of group) {
        if (open === null) {
          await this.memory.observe(thread.discussionId, now);
        } else if (open.has(thread.discussionId)) {
          await this.memory.observe(thread.discussionId, now, { seenOpenAt: now });
        } else if (await this.concludeAbsent(thread, known.get(thread.discussionId), now)) {
          requested += 1;
        }
      }
    }

    if (requested > 0) this.logger.log(`reconciliation requested ${requested} closure(s)`);

    return requested;
  }

  /** Returns the unresolved threads of an anchor. `null` means the anchor was not read. */
  private async openAt(anchor: string): Promise<ReadonlySet<string> | null> {
    try {
      return await this.comments.openDiscussions(anchor);
    } catch (error) {
      this.skipped(`anchor ${anchor}`, error);

      return null;
    }
  }

  /**
   * What was not read stays without a conclusion; a failure the person must see shows in the log.
   */
  private skipped(what: string, error: unknown): void {
    const failure = notionFailureOf(error);
    const line = `reconciliation: ${what} skipped — ${failure}: ${messageOf(error)}`;

    if (needsAttention(failure)) this.logger.error(line, stackOf(error));
    else this.logger.warn(line);
  }

  /**
   * Reaches a conclusion about a thread that is not among the unresolved. `true` means closure was
   * requested.
   */
  private async concludeAbsent(
    thread: AnchoredThread,
    known: DiscussionReconciliation | undefined,
    now: Date,
  ): Promise<boolean> {
    const id = thread.discussionId;
    const seenOpen = latest(known?.seenOpenAt, thread.lastWrittenAt);
    const concluded = latest(known?.closureRequestedAt, known?.goneAt);

    if (concluded !== null && seenOpen !== null && concluded >= seenOpen) {
      await this.memory.observe(id, now);

      return false;
    }

    let readable: boolean;

    try {
      readable = await this.comments.exists(thread.lastCommentId);
    } catch (error) {
      this.skipped(`comment ${thread.lastCommentId}`, error);
      await this.memory.observe(id, now);

      return false;
    }

    if (!readable) {
      await this.memory.observe(id, now, { goneAt: now });

      return false;
    }

    await this.continuations.requestClosure({ discussionId: id, notionPageId: thread.pageId });
    await this.memory.observe(id, now, { closureRequestedAt: now });

    return true;
  }
}
