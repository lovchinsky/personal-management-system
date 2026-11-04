import { Prisma } from '../generated/prisma/client';
import { ReasonCode } from '../generated/prisma/enums';
import { REASON_CLASS, reasonsOf } from './reason-class';

/**
 * What makes one continuation the same as another: a single rule for queue rows and for what a run
 * has written that has not been applied yet.
 *
 * A discussion thread addresses itself within its class: a thread has one wake and, separately,
 * one closure (`reason-class.ts`). Without a thread, one page can have several continuations for
 * different reasons, and collapsing them into one would lose one of them (`INV-204`).
 */
interface ContinuationIdentity {
  readonly discussionId?: string | null;
  readonly notionPageId: string;
  readonly reasonCode: ReasonCode;
}

/**
 * Treats the presence of an id, not its truthiness, as the mark of a thread: a truthiness check
 * would read an empty string as “no thread”, while the write would store it as a thread.
 */
function threadOf(identity: ContinuationIdentity): string | undefined {
  return identity.discussionId ?? undefined;
}

export function sameContinuation(one: ContinuationIdentity, other: ContinuationIdentity): boolean {
  if (REASON_CLASS[one.reasonCode] !== REASON_CLASS[other.reasonCode]) return false;

  const thread = threadOf(one);
  if (thread !== undefined) {
    return threadOf(other) === thread;
  }

  return (
    threadOf(other) === undefined &&
    other.notionPageId === one.notionPageId &&
    other.reasonCode === one.reasonCode
  );
}

/** Expresses the same rule as a selection condition, for queue rows. */
export function whereSame(identity: ContinuationIdentity): Prisma.ScheduledCheckWhereInput {
  const thread = threadOf(identity);

  return thread !== undefined
    ? { discussionId: thread, reasonCode: { in: reasonsOf(REASON_CLASS[identity.reasonCode]) } }
    : { discussionId: null, notionPageId: identity.notionPageId, reasonCode: identity.reasonCode };
}
