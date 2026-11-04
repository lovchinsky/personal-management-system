import { ReasonCode } from '../generated/prisma/enums';

/**
 * The place in the continuation queue that a reason occupies.
 *
 * `wake` is for waking a thread at a given time: a recheck, a person's snooze, a deadline. A
 * thread has one such continuation, and a new request moves the existing one. `closure` is for a
 * thread that is resolved and must be processed: an obligation derived from state, not a point in
 * time, so it has its own place and shares its row with no other continuation. The two classes on
 * one thread do not conflict.
 */
export type ReasonClass = 'wake' | 'closure';

/**
 * The class of each reason. A `Record` over the whole enum: a reason added without a decision is a
 * compile error, not quietly a “wake”. The rule also lives in the partial unique index
 * `scheduled_checks_one_active_*_per_discussion`; an integration check over all pairs of reasons
 * keeps the two copies in agreement.
 */
export const REASON_CLASS: Readonly<Record<ReasonCode, ReasonClass>> = {
  await_external_event: 'wake',
  user_snooze: 'wake',
  safety_recheck: 'wake',
  deadline_followup: 'wake',
  resolution_reconciliation: 'closure',
};

/** Lists the reasons of this class, for selection conditions. */
export function reasonsOf(reasonClass: ReasonClass): ReasonCode[] {
  return Object.values(ReasonCode).filter((reason) => REASON_CLASS[reason] === reasonClass);
}
