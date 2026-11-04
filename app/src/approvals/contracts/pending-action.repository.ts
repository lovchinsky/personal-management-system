import { Injectable } from '@nestjs/common';
import { PendingAction } from '../../generated/prisma/client';
import { PendingActionFailure, PendingActionStatus } from '../../generated/prisma/enums';
import { isUniqueViolation } from '../../platform/db/prisma-errors';
import { PrismaService } from '../../platform/db/prisma.service';
import { storedJson } from '../../platform/db/stored-json';
import { Proposal } from '../proposal.schema';
import { fingerprintOf } from './fingerprint';
import { isOpenStatus, OPEN_STATUSES } from './pending-action-status';

/**
 * Returns the page a proposal changes. An action acts on one object (`validateProposal`), so the
 * page of the first effect is the page of all of them.
 */
function subjectOf(proposal: Proposal): string {
  const [first] = proposal.effects;

  if (!first) throw new Error('a proposal without an effect changes no page');

  return first.pageId;
}

/**
 * The executable contract of an autonomous run's proposal.
 *
 * The row exists **from the time of the proposal** because the run ends together with the model,
 * and until the person replies the row is the only carrier of the change. The effects are fixed
 * here and are not recomputed at approval, so exactly what was shown is executed.
 */
@Injectable()
export class PendingActionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes a proposal that the capability service has already checked.
   *
   * There are never two open proposals for the same change: a partial index enforces uniqueness
   * by fingerprint among non-terminal statuses. A repeated proposal returns the existing row,
   * because two runs about the same situation must not produce two messages.
   */
  async propose(proposal: Proposal, proposedByRunId: string): Promise<PendingAction> {
    const fingerprint = fingerprintOf(proposal.effects);

    const existing = await this.findOpenByFingerprint(fingerprint);
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.pendingAction.create({
        data: {
          discussionId: proposal.discussionId ?? null,
          proposedByRunId,
          notionPageId: subjectOf(proposal),
          fingerprint,
          effects: storedJson(proposal.effects),
          preconditions: storedJson(proposal.preconditions),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const raced = await this.findOpenByFingerprint(fingerprint);
      if (!raced) {
        throw error;
      }

      return raced;
    }
  }

  find(id: string): Promise<PendingAction | null> {
    return this.prisma.pendingAction.findUnique({ where: { id } });
  }

  findMany(ids: readonly string[]): Promise<PendingAction[]> {
    return this.prisma.pendingAction.findMany({ where: { id: { in: [...ids] } } });
  }

  /**
   * Returns the proposals awaiting the person's decision, oldest first, because they are the first
   * to expire at a review (`contracts/canonical.yaml`, key `pending_action`).
   */
  proposed(take: number): Promise<PendingAction[]> {
    return this.prisma.pendingAction.findMany({
      where: { status: 'proposed' },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /** Counts the proposals that await the person's decision, besides the named ones. */
  countProposed(except: readonly string[]): Promise<number> {
    return this.prisma.pendingAction.count({
      where: { status: 'proposed', id: { notIn: [...except] } },
    });
  }

  /** Checks whether there is an open proposal linked to the thread. */
  async hasOpenOn(discussionId: string): Promise<boolean> {
    const open = await this.prisma.pendingAction.count({
      where: { discussionId, status: { in: [...OPEN_STATUSES] } },
    });

    return open > 0;
  }

  /** Checks whether there is an open proposal that changes the page. */
  async hasOpenOnPage(notionPageId: string): Promise<boolean> {
    const open = await this.prisma.pendingAction.count({
      where: { notionPageId, status: { in: [...OPEN_STATUSES] } },
    });

    return open > 0;
  }

  /** Returns the threads on which an open proposal waits. */
  async openDiscussions(): Promise<string[]> {
    const rows = await this.prisma.pendingAction.findMany({
      where: { discussionId: { not: null }, status: { in: [...OPEN_STATUSES] } },
      select: { discussionId: true },
      distinct: ['discussionId'],
    });

    return rows.flatMap((row) => (row.discussionId === null ? [] : [row.discussionId]));
  }

  /**
   * Approves a proposal.
   *
   * The transition happens only from `proposed`, and approving again is harmless: from any other
   * status it does nothing. It is this monotonicity, not the outbox, that keeps the domain effect
   * exactly-once. A duplicated message leads to a second press, not to a second write.
   */
  approve(id: string): Promise<boolean> {
    return this.transition(id, 'proposed', 'approved');
  }

  reject(id: string): Promise<boolean> {
    return this.transition(id, 'proposed', 'rejected');
  }

  /**
   * Returns the approved actions that can be attempted **right away**, oldest first.
   *
   * “Not before” sits in the predicate, not in a filter after the selection: an action skipped
   * inside a batch would still take up a place in it, and five actions on pages the integration
   * lacks access to would hide every later action forever.
   */
  approved(take: number): Promise<PendingAction[]> {
    return this.prisma.pendingAction.findMany({
      where: {
        status: 'approved',
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /**
   * Postpones the attempt without touching the person's decision.
   *
   * The status stays `approved`: Notion not responding and a refusal of access changed nothing in
   * the domain or in what the person decided. The reason is written to the same place as a
   * terminal reason. Otherwise, from the outside, a stalled action cannot be told apart from a
   * forgotten one. A refusal of access is also counted: it does not clear on its own, and the
   * attempt limit is a count of such refusals (ADR 0044).
   */
  async deferUntil(id: string, until: Date, reason: string, accessDenied: boolean): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, status: 'approved' },
      data: {
        nextAttemptAt: until,
        lastError: reason,
        ...(accessDenied ? { accessFailures: { increment: 1 } } : {}),
      },
    });
  }

  /**
   * Makes a terminal transition together with the reason and, when the action is not executed,
   * also with the kind under which the trail in the thread will report it to the person
   * (ADR 0043). A failure without a reason is not written, and the type guarantees this, not the
   * caller's memory (`docs/2-system.md` § “Preconditions and executor”).
   */
  settle(id: string, status: 'executed'): Promise<void>;
  settle(id: string, status: 'conflict', reason: string): Promise<void>;
  settle(
    id: string,
    status: 'failed',
    reason: string,
    failure: PendingActionFailure,
  ): Promise<void>;
  async settle(
    id: string,
    status: 'executed' | 'failed' | 'conflict',
    reason?: string,
    failure?: PendingActionFailure,
  ): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, status: 'approved' },
      data: { status, resolvedAt: new Date(), lastError: reason ?? null, failure: failure ?? null },
    });
  }

  /**
   * Expires the named proposals that still await the person's decision. Expiry does not touch an
   * approved, decided or already expired proposal (`contracts/canonical.yaml`, key
   * `pending_action`). Returns the proposals that have just expired.
   */
  async lapse(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const lapsed = await this.prisma.pendingAction.updateManyAndReturn({
      where: { id: { in: [...ids] }, status: 'proposed' },
      data: { status: 'expired', resolvedAt: new Date() },
      select: { id: true },
    });

    return lapsed.map((row) => row.id);
  }

  private async transition(
    id: string,
    from: PendingActionStatus,
    to: PendingActionStatus,
  ): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.pendingAction.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        // An approval remembers when it happened: the unavailability limit is measured from that
        // time (ADR 0044).
        ...(to === 'approved' ? { approvedAt: now } : {}),
        ...(isOpenStatus(to) ? {} : { resolvedAt: now }),
      },
    });

    return count === 1;
  }

  /**
   * Returns the proposals whose fate has not yet been published in the thread and in the message
   * (ADR 0043), oldest first. A proposal awaiting a decision has no fate.
   */
  unpublished(take: number): Promise<PendingAction[]> {
    return this.prisma.pendingAction.findMany({
      where: {
        status: { not: 'proposed' },
        OR: [
          { publishedStatus: null },
          { NOT: { publishedStatus: { equals: this.prisma.pendingAction.fields.status } } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /**
   * Marks the fate as published, only from the fate the publication saw: a fenced update, so two
   * publications of the same transition do not overwrite each other.
   */
  async published(
    id: string,
    from: PendingActionStatus | null,
    to: PendingActionStatus,
  ): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, publishedStatus: from },
      data: { publishedStatus: to },
    });
  }

  /**
   * Requests a recheck of the proposals awaiting a decision on a page the person changed
   * (ADR 0044). A repeated request only moves the request time, so there is still just one
   * recheck.
   */
  async requestRecheck(notionPageId: string): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { notionPageId, status: 'proposed' },
      data: { recheckRequestedAt: new Date() },
    });
  }

  /** Returns the proposals awaiting a decision and a recheck, the oldest requests first. */
  toRecheck(take: number): Promise<PendingAction[]> {
    return this.prisma.pendingAction.findMany({
      where: { status: 'proposed', recheckRequestedAt: { not: null } },
      orderBy: { recheckRequestedAt: 'asc' },
      take,
    });
  }

  /**
   * Clears the recheck request once the proposal is rechecked, but only the request the recheck
   * saw. A change that arrived during the recheck asks for a recheck of its own.
   */
  async rechecked(id: string, requestedAt: Date): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, recheckRequestedAt: requestedAt },
      data: { recheckRequestedAt: null },
    });
  }

  /**
   * Closes the proposal as `conflict` without waiting for a button press, because the person got
   * ahead of the proposal and the precondition no longer holds (ADR 0044). Only from `proposed`: a
   * decided proposal is left untouched.
   */
  async outpaced(id: string, reason: string): Promise<void> {
    await this.prisma.pendingAction.updateMany({
      where: { id, status: 'proposed' },
      data: {
        status: 'conflict',
        resolvedAt: new Date(),
        lastError: reason,
        recheckRequestedAt: null,
      },
    });
  }

  /** Returns the open proposal for the same change: the one a new proposal would duplicate. */
  openLike(proposal: Proposal): Promise<PendingAction | null> {
    return this.findOpenByFingerprint(fingerprintOf(proposal.effects));
  }

  private findOpenByFingerprint(fingerprint: string): Promise<PendingAction | null> {
    return this.prisma.pendingAction.findFirst({
      where: { fingerprint, status: { in: [...OPEN_STATUSES] } },
    });
  }
}
