import { createHash } from 'node:crypto';
import { DeliveryRequest } from './delivery.schema';

/**
 * Derives the key of a delivery that a run enqueues from the run's cause, not from the model's
 * wording.
 *
 * The same cause — the envelope's `event_id` — always yields the same key, so a run repeated
 * after a failure enqueues no second message. The next wake of the same thread has a different
 * `event_id`, and so its own delivery. A run enqueues one delivery: a second call in the run would
 * be the same message and would not get through.
 */
export function runDeliveryKey(cause: string): string {
  return `event:${cause}`;
}

/**
 * Derives the key of a delivery from a chat. A chat has no cause, so a delivery is identified by
 * what it says: the same packet a second time is the same delivery.
 *
 * The fields are taken by name, not by serializing the object: the order of keys in the request
 * must not change the key.
 */
export function chatDeliveryKey(
  request: Pick<DeliveryRequest, 'channel' | 'discussionId' | 'message'>,
): string {
  const { message } = request;
  const canonical = JSON.stringify([
    request.channel,
    request.discussionId ?? null,
    message.noticed,
    message.whyItMatters,
    message.context ?? null,
    message.prepared ?? null,
    message.ask,
    message.link ?? null,
    (message.proposals ?? []).map((proposal) => [proposal.pendingActionId, proposal.line]),
  ]);

  return `chat:${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}
