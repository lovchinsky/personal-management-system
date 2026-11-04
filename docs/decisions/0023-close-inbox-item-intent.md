# ADR 0023 — Closing an Inbox item without a Task is an intent of the system

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D23` |
| **Related** | ADR 0006 · ADR 0014 · ADR 0015 · ADR 0017 · ADR 0027 · `INV-010` · `INV-013` · `INV-014` · `INV-015` · `INV-016` · `INV-086` · `GAP-32` |

## Context

The Inbox is the set of what is unresolved (ADR 0006): an item that exists is unresolved, and a resolved one is gone. A Task is not the only way to resolve an item: it may turn out to be junk, a duplicate of a Task that already exists, or a reference already in GBrain. All three are decisions, not deferrals, and after each the item must leave the Inbox.

Converting an item into a Task always creates a Task. Moving a page to the trash as an action in its own right needs approval (`docs/3-policy.md` § “Approval-required autonomous actions”). An item resolved without a Task and without a dedicated intent would stay in the Inbox and keep accumulating `unclarified_input` that no longer exists.

## Decision

**Closing an Inbox item without a Task is the system intent `close_inbox_item` (capability `capture_close`).**

- There is a single intent, made of two steps in the same order as in conversion: an origin comment on the item, and the trash. Notion does not accept a comment on a page in the trash, so the trash comes last.
- The closing reason is one of three: `trash` (not an action, and nothing to keep), `duplicate` (an existing open Task covers the item; the comment mentions it) or `reference` (the fact the item carried is already stored in long-term memory).
- Resolution works as it does in conversion: “this becomes X” and the removal of the source are one intent (`INV-013`), and the trail stays as a comment (`INV-014`).
- An item is closed by a conversation step: a `dialogue` run or the chat. The evaluation of changes to an Inbox item does not process it. An item that needs the person's decision is not closed — it stays in the Inbox with a comment (`INV-015`).

## Consequences

- There are four system intents in Notion (ADR 0017). Three of them are App capabilities in the contract's `system_voice`: `comment_write`, `capture_convert` and `capture_close`; the executor performs an approved change, not a tool.
- Closing is its own kind of run write (ADR 0015): the `capture` capability checks and applies it, and the run write policy stages it for a run and writes it at once for the chat.
- A duplicate is checked by a methodology rule (ADR 0027): the Task the item repeats must be open.
- The App does not check `reference`: the Skill, which writes the fact before the closing (`autonomous_gbrain_fact`), knows whether the fact is in GBrain. A memory write is applied before the closing (ADR 0014).
- An item that has become an object above a Task, other than a Project, has no closing intent (`GAP-32`).

## Cost

- One more surface of the system's writes to Notion for `NotionWriter` (`INV-086`) and the conversion contract tests to cover.
- A duplicate is checked only as the presence of an open Task: whether it covers the item is the model's judgment, and a mistake here makes an item disappear; the person sees it in the trash with a comment.
