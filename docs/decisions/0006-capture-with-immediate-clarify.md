# ADR 0006 — Capture with immediate Clarify; `Inbox` = the set of what is unresolved

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D6` |
| **Related** | ADR 0023 · `G14` · `INV-010` · `INV-011` · `INV-012` · `INV-013` · `INV-014` · `INV-015` |

## Context

The methodology separates Capture from Clarify: Capture quickly stores a trigger, Clarify turns it into a decision, and the Inbox must not become a permanent task list (`docs/1-methodology.md` § “Inbox”). In GTD the Inbox is processed by a ritual, a review that clears the inboxes. The system can process every item right away, in a separate run.

When the Inbox is a queue for later processing, an item needs a state “processed, but sitting there”: a status property, a flag, a second round of Clarify over what is already resolved. This third state is what turns the Inbox into a task list.

## Decision

**Capture is accompanied by an immediate Clarify, and the `Inbox` is treated as the set of what is unresolved, not as a queue for later processing.**

## Consequences

- An Inbox item has no status property and no processed flag (`INV-010`); “processed” is expressed by the item's disappearance from the Inbox.
- There is a single cycle of Clarify; Clarify is not repeated over what is already resolved (`INV-011`).
- Capture does not depend on the availability of the model (`INV-012`): an item the person put in Notion exists before the model is launched, and in the chat the person is present and sees the failure.
- Moving the item to the trash, which completes a conversion, does not need a separate approval (`INV-013`); a trashed Inbox item keeps its comment as an origin trail (`INV-014`). A resolved Inbox item leaves the Inbox by being converted into a Task or by being closed without a Task ([ADR 0023](0023-close-inbox-item-intent.md)).
- A proposal made in the chat and left unanswered in the same turn exists as an Inbox item with a comment, not as a `pending_actions` row: returning to it is a conversation again (`INV-015`).
- The physical representation of the Inbox loses part of the model: `source` is absent, `clarified_at` is not stored (`G14`).
- The capture path rests on the `page.created` event for the Inbox data source, an event that carries `data.parent.data_source_id`, and on the reversibility of the trash: an item in the Notion trash can be restored.
- Creation in the Inbox is relevant by construction: `page.created` carries no list of properties, so the event type is itself the answer about relevance.

## Cost

- Every Inbox item costs a model run, even one the person would sort out at a glance.
- An item the system has not resolved stays in the Inbox with a question as a comment, and the system cannot resolve it without the person.
