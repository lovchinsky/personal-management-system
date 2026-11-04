import { Proposal, ProposalRequest } from '../approvals/proposal.schema';
import { Comment, CommentRequest } from '../attention/comment.schema';
import { InboxClosure, InboxClosureRequest } from '../capture/inbox-closure.schema';
import { InboxConversion, InboxConversionRequest } from '../capture/inbox-conversion.schema';
import { InboxParking, InboxParkingRequest } from '../capture/inbox-parking.schema';
import { Continuation, ContinuationRequest } from '../continuations/continuation.schema';
import { Delivery, DeliveryRequest } from '../delivery/delivery.schema';
import { MemoryEntry, MemoryEntryRequest } from '../memory/memory-entry.schema';
import { Actor } from '../runs/actor';
import { AppliedEffect } from '../runs/run-effects';
import { RefKind, Refs, RefView } from './refs';

/**
 * The kinds of writes, in the order they are applied.
 *
 * The list is closed (ADR 0015): each kind has an owning capability and a row in the table of
 * owners. Memory is applied first: closing an Inbox item as a reference rests on the stored fact,
 * and a comment that says “remembered” is not written if the memory write failed. A write is
 * applied before the one that points to it: a comment and a continuation get the real id of the
 * Inbox item the system parked and of the Task the conversion created; a continuation, a proposal
 * and a delivery get the real id of the thread the comment landed in; a delivery button gets the
 * real id of the proposal. A delivery never announces an effect that has not been applied yet.
 */
export const APPLY_ORDER = [
  'memory_entry',
  'inbox_item',
  'inbox_conversion',
  'inbox_closure',
  'comment',
  'continuation',
  'proposal',
  'delivery',
] as const;

export type WriteKind = (typeof APPLY_ORDER)[number];

/** What a write of each kind has: the request as sent and the form checked by the owner. */
interface WriteTypes {
  readonly memory_entry: { readonly request: MemoryEntryRequest; readonly checked: MemoryEntry };
  readonly inbox_item: {
    readonly request: InboxParkingRequest;
    readonly checked: InboxParking;
  };
  readonly inbox_conversion: {
    readonly request: InboxConversionRequest;
    readonly checked: InboxConversion;
  };
  readonly inbox_closure: {
    readonly request: InboxClosureRequest;
    readonly checked: InboxClosure;
  };
  readonly comment: { readonly request: CommentRequest; readonly checked: Comment };
  readonly continuation: {
    readonly request: ContinuationRequest;
    readonly checked: Continuation;
  };
  readonly proposal: { readonly request: ProposalRequest; readonly checked: Proposal };
  readonly delivery: { readonly request: DeliveryRequest; readonly checked: Delivery };
}

export type RequestOf<K extends WriteKind> = WriteTypes[K]['request'];

type CheckedOf<K extends WriteKind> = WriteTypes[K]['checked'];

/**
 * A write waiting for the conclusion: already checked by its owner, not yet applied. `ref` is its
 * temporary id: other writes of the run can point to it, if the kind mints references.
 */
export type StagedWrite<K extends WriteKind = WriteKind> = {
  readonly [P in K]: { readonly kind: P; readonly write: CheckedOf<P>; readonly ref: string };
}[K];

/**
 * The capability that owns one kind of write: what the write policy needs from it.
 *
 * There is one check for both points in time: when the write arrives and when it is about to be
 * applied. At the second point the check sees state that changed during the run.
 */
export interface WriteOwner<K extends WriteKind> {
  /** The kind of reference a write of this kind mints. Absent means it mints none. */
  readonly mints?: RefKind;
  check(actor: Actor, request: RequestOf<K>, refs: RefView): Promise<CheckedOf<K>>;
  /**
   * Applies what has been checked. References to what this run staged are resolved here. Each
   * effect is passed to `applied` as soon as it happens: a write of several steps leaves what was
   * done in place even when a later step failed. The method returns the real id of what the
   * write's temporary id points to. `deadline` is the run's deadline. A write waiting for an
   * external system cuts its wait short at the deadline. Only a run has a deadline.
   */
  apply(
    actor: Actor,
    write: CheckedOf<K>,
    refs: Refs,
    applied: (effect: AppliedEffect) => void,
    deadline?: AbortSignal,
  ): Promise<string>;
}

export type WriteOwners = { readonly [K in WriteKind]: WriteOwner<K> };
