# ADR 0025 — The App derives the delivery key, not the model

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D25` |
| **Related** | ADR 0014 · ADR 0045 · `INV-020` |

## Context

A logical delivery is queued once: the unique `idempotency_key` collapses repeats into one (`notification_outbox`). So the key must come from the cause: a run repeated after a failure (ADR 0014) produces the same key, the next wake of the same thread a different one, and the key is never random.

The App knows the cause of a run exactly: the `event_id` of the run's envelope is the same for a run repeated after a failure and different for the next wake.

## Decision

- **`queue_notification` takes no key.** The App derives the key (`delivery/delivery-key.ts`) and returns it in the response.
- **In a run:** the key is derived from its cause, `event:<event_id>`. The same cause always produces the same key, so a repeated run enqueues nothing, and the model gets `already_queued` at the call itself.
- **A run enqueues at most one delivery.** A second one in the same run would have the same key and would not get through, so it is rejected at the call, with a reason. The limit `max_notifications_per_run` (`contracts/canonical.yaml`, key `retrieval_budgets`) is enforced by code, not by the Skill's text.
- **In the chat:** there is no cause, so the content of the packet identifies the delivery (`chat:<hash>`, a hash of the channel, the thread, the packet's fields and its proposals): the same packet a second time is the same delivery.
- **`get_delivery_state`:** the key is optional. A run without a key asks about the delivery of its cause; with a key that `queue_notification` returned, the answer is about a different delivery. In the chat the key is required.
- A run's cause is the `cause` field of the session grant: the dispatcher puts the envelope's `event_id` there.

**Rejected:**

- **A key from the model** (an `idempotency_key` field in the `queue_notification` call). The rule “from the cause, not random, the same on a retry, different for different wakes of one thread” would be enforced only by the text of the Skill, and the App would have no way to check the model: a different key on the retry of a run would enqueue a second, identical message, and the App would not notice.

## Consequences

- The Skill says nothing about keys: neither how to derive them nor what to do with `already_queued`, beyond what the response itself says.
- Messages the App enqueues itself also have keys derived in code: `breaker:<run>`, `review-failed:<review>:<period>`, `notion-wait:<window>` and `notion-gave-up:<window>`, `oauth-connect:<uuid>` — one per client connection. The message about a wake that did not take place takes the key that the run of that wake would have set (ADR 0045).
- Gate M3 knows the key in advance: it names the `event_id` of the runs itself.

## Cost

- Two different notifications from one cause are impossible: the second one can only fit its content into the first. This coincides with the limit “one notification per run”, but it also closes the theoretical possibility of two decisions from one event.
- In the chat, an identical packet enqueued a second time years later remains the same message: the hash of the content knows nothing of time. The chat enqueues notifications rarely, and the `already_queued` response tells the person about it.
