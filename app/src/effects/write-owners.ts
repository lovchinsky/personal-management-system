import { ApprovalsService } from '../approvals/approvals.service';
import { AttentionService } from '../attention/attention.service';
import { CaptureService } from '../capture/capture.service';
import { CaptureStep } from '../capture/conversion';
import { ContinuationsService } from '../continuations/continuations.service';
import { Delivery } from '../delivery/delivery.schema';
import { DeliveryService, ProposalLookup } from '../delivery/delivery.service';
import { MemoryService } from '../memory/memory.service';
import { AppliedEffect } from '../runs/run-effects';
import { Refs, RefView } from './refs';
import { WriteOwner, WriteOwners } from './write-kinds';

/** The capabilities that manage the run's writes — exactly what the table needs from each. */
interface WriteCapabilities {
  readonly capture: Pick<
    CaptureService,
    'check' | 'convert' | 'checkPark' | 'park' | 'checkClose' | 'close'
  >;
  readonly attention: Pick<AttentionService, 'check' | 'comment'>;
  readonly continuations: Pick<ContinuationsService, 'check' | 'schedule' | 'assertNotSnoozed'>;
  readonly approvals: Pick<
    ApprovalsService,
    'check' | 'record' | 'awaitsDecision' | 'waitingBesides' | 'subjectsOf'
  >;
  readonly delivery: Pick<DeliveryService, 'check' | 'enqueue'>;
  readonly memory: Pick<MemoryService, 'check' | 'record'>;
}

/**
 * Returns the owner of each kind of write (ADR 0015).
 *
 * The table only translates the policy's steps — check, apply — into calls to the capability that
 * manages the kind. The rules stay with the capabilities, and a capability sees temporary
 * references in its own terms: a delivery asks whether a proposal is open and gets its real id for
 * the button; every write that refers to a thread or a page gets the real id of the thread the
 * run's comment landed in, or of the Task its conversion created. A comment, a proposal and a
 * delivery ask the continuations whether the person has snoozed what they are about.
 */
export function writeOwners(capabilities: WriteCapabilities): WriteOwners {
  return {
    memory_entry: memoryOwner(capabilities.memory),
    inbox_item: parkingOwner(capabilities.capture),
    inbox_conversion: conversionOwner(capabilities.capture),
    inbox_closure: closureOwner(capabilities.capture),
    comment: commentOwner(capabilities.attention, capabilities.continuations),
    continuation: continuationOwner(capabilities.continuations),
    proposal: proposalOwner(capabilities.approvals, capabilities.continuations),
    delivery: deliveryOwner(
      capabilities.delivery,
      capabilities.approvals,
      capabilities.continuations,
    ),
  };
}

/**
 * A memory write mints nothing: no other write of the run points to it. The trace sees the page it
 * landed on, and the anchor created for it, as effects.
 */
function memoryOwner(memory: WriteCapabilities['memory']): WriteOwner<'memory_entry'> {
  return {
    check: (actor, request) => memory.check(actor, request),
    apply: (_actor, entry, _refs, applied, deadline) => memory.record(entry, applied, deadline),
  };
}

/** Parking mints the page of an Inbox item: comments and continuations can point to it. */
function parkingOwner(capture: WriteCapabilities['capture']): WriteOwner<'inbox_item'> {
  return {
    mints: 'page',
    check: (actor, request) => capture.checkPark(actor, request),
    apply: (actor, parking, _refs, applied) =>
      capture.park(actor, parking, (step) => applied(effectOf(step))),
  };
}

/** Closing mints nothing: the item goes to the trash, and nothing is left to point to it. */
function closureOwner(capture: WriteCapabilities['capture']): WriteOwner<'inbox_closure'> {
  return {
    check: (actor, request) => capture.checkClose(actor, request),
    apply: (_actor, closure, _refs, applied) =>
      capture.close(closure, (step) => applied(effectOf(step))),
  };
}

/**
 * A conversion mints the page of the Task; each of its steps is an effect that stays even when the
 * next one fails.
 */
function conversionOwner(capture: WriteCapabilities['capture']): WriteOwner<'inbox_conversion'> {
  return {
    mints: 'page',
    check: (actor, request) => capture.check(actor, request),
    apply: (_actor, conversion, _refs, applied) =>
      capture.convert(conversion, (step) => applied(effectOf(step))),
  };
}

/** A comment mints a thread: other writes of this run can land in it. */
function commentOwner(
  attention: WriteCapabilities['attention'],
  continuations: WriteCapabilities['continuations'],
): WriteOwner<'comment'> {
  return {
    mints: 'discussion',
    check: async (actor, request) => {
      const comment = attention.check(request);

      await continuations.assertNotSnoozed(
        actor,
        {
          pages: [comment.pageId],
          discussions: comment.discussionId === undefined ? [] : [comment.discussionId],
        },
        'comment',
      );

      return comment;
    },
    apply: async (actor, comment, refs, applied) => {
      const written = await attention.comment(actor, {
        ...comment,
        pageId: refs.resolve('page', comment.pageId),
        discussionId: threadOf(refs, comment.discussionId),
      });

      applied({ kind: 'comment', id: written.commentId });

      return written.discussionId;
    },
  };
}

/** A continuation mints nothing: no other write of the run points to it. */
function continuationOwner(
  continuations: WriteCapabilities['continuations'],
): WriteOwner<'continuation'> {
  return {
    check: (actor, request) => continuations.check(actor, request),
    apply: async (actor, request, refs, applied) => {
      const row = await continuations.schedule(actor, {
        ...request,
        notionPageId: refs.resolve('page', request.notionPageId),
        discussionId: threadOf(refs, request.discussionId),
      });

      applied({ kind: 'continuation', id: row.id });

      return row.id;
    },
  };
}

/** A proposal mints its id: a delivery button can point to it. */
function proposalOwner(
  approvals: WriteCapabilities['approvals'],
  continuations: WriteCapabilities['continuations'],
): WriteOwner<'proposal'> {
  return {
    mints: 'proposal',
    check: async (actor, request) => {
      const proposal = await approvals.check(actor, request);

      await continuations.assertNotSnoozed(
        actor,
        {
          pages: proposal.effects.map((effect) => effect.pageId),
          discussions: proposal.discussionId === undefined ? [] : [proposal.discussionId],
        },
        'proposal',
      );

      return proposal;
    },
    apply: async (actor, proposal, refs, applied) => {
      const row = await approvals.record(actor, {
        ...proposal,
        discussionId: threadOf(refs, proposal.discussionId),
      });

      applied({ kind: 'proposal', id: row.id });

      return row.id;
    },
  };
}

/** A delivery button leads to a proposal this run staged, or to one that awaits a decision. */
function deliveryOwner(
  delivery: WriteCapabilities['delivery'],
  approvals: WriteCapabilities['approvals'],
  continuations: WriteCapabilities['continuations'],
): WriteOwner<'delivery'> {
  const proposals = (refs: RefView): ProposalLookup => ({
    awaitsDecision: async (id) => refs.minted('proposal', id) || approvals.awaitsDecision(id),
    waitingBesides: (ids) => approvals.waitingBesides(ids),
  });

  return {
    check: async (actor, request, refs) => {
      const checked = await delivery.check(request, proposals(refs));
      // Proposals this run staged have already checked their own snooze; the buttons of the rest
      // are about their pages and threads.
      const recorded = (checked.message.proposals ?? [])
        .map((line) => line.pendingActionId)
        .filter((id) => !refs.minted('proposal', id));
      const shown = await approvals.subjectsOf(recorded);

      await continuations.assertNotSnoozed(
        actor,
        {
          pages: shown.pages,
          discussions: [
            ...shown.discussions,
            ...(checked.discussionId === undefined ? [] : [checked.discussionId]),
          ],
        },
        'delivery',
      );

      return checked;
    },
    apply: async (actor, request, refs, applied) => {
      const row = await delivery.enqueue(actor, withRealIds(request, refs), proposals(refs));

      applied({ kind: 'delivery', id: row.id });

      return row.id;
    },
  };
}

/**
 * Returns a delivery with real ids for the thread the run's comment landed in and for the
 * proposals this run staged. The packet's lines and buttons lead to them.
 */
function withRealIds(request: Delivery, refs: Refs): Delivery {
  const { proposals } = request.message;

  return {
    ...request,
    discussionId: threadOf(refs, request.discussionId),
    message: proposals
      ? {
          ...request.message,
          proposals: proposals.map((proposal) => ({
            ...proposal,
            pendingActionId: refs.resolve('proposal', proposal.pendingActionId),
          })),
        }
      : request.message,
  };
}

/** Returns a thread: a real one, or the one the run's comment landed in. */
function threadOf(refs: Refs, id: string | undefined): string | undefined {
  return id === undefined ? undefined : refs.resolve('discussion', id);
}

/**
 * Converts a step of the `capture` intent into an effect in the trace: the page, the origin
 * comment, the trash.
 */
function effectOf(step: CaptureStep): AppliedEffect {
  switch (step.step) {
    case 'task_created':
    case 'item_parked':
      return { kind: 'page_created', id: step.pageId };

    case 'origin_noted':
      return { kind: 'comment', id: step.commentId };

    case 'item_archived':
      return { kind: 'page_archived', id: step.pageId };
  }
}
