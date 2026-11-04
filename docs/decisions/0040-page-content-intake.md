# ADR 0040 — An edit to the body of a Task or Project opens an evaluation window

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D40` |
| **Related** | ADR 0001 · ADR 0017 · ADR 0027 · `INV-008` · `INV-018` · `INV-087` |

## Context

Intake decides the relevance of a property change by the list of changed properties, but `page.content_updated` carries no such list: the comparison rule does not apply to it, and the relevance of a body edit has to be decided differently. A note in the body of a Task or Project in which the person takes on work or mentions a dependency is the same `untracked_commitment` as in a comment or a channel reply, and without an event for a body edit it produces no run.

Notion sends `page.content_updated` as an aggregated event, with a delay of up to a minute, and with `data.parent`, the same one from which intake takes the database of an Inbox item for `page.created`. The system does not write page bodies (`INV-008`), so a body edit is always the person's words; a write by the bot is filtered out by its author (`INV-087`).

## Decision

**`page.content_updated` is relevant when the page is in a Task or Project database; it is absorbed into the page's evaluation window like any other change.**

- **The page type** comes from the event's `data.parent.data_source_id` through the binding; without that field, from a REST read of the page. For every other database the result is a discard with a reason.
- **The window** is the ordinary one: the same debounce and ceiling, because Notion already aggregates body edits. The run is `event_evaluation`, budgeted like any window.
- **The trigger envelope:** `event_types` carries the types of all events in the window, so a body edit stays visible even when a property edit closed the window (`type` is the type of the event that closed the window). A window that has absorbed only body edits yields `type: page.content_updated` with an empty `updated_property_ids`. The run reads the body of the Task or Project again when `page.content_updated` is among the types of the window.
- The relevance gate (`contracts/canonical.yaml`, key `relevance_gate`) has a rule for events with no property list: a body edit is relevant by the type of the page.

**Rejected:**

- **All canonical types.** The bodies of a Behavior System, an Area of Focus and an Identity are prose that reviews read; a run on every edit of it is noise without a decision.
- **Only pages with active attention.** It misses the main thing: a note in the body of a Task that is a promise the system has not yet spoken about.
- **The sweep reads bodies.** A body costs a separate query for each block with children, and the sweep reads prose at a cost in tokens (ADR 0001, “Cost”); reading the bodies of all open Tasks every hour costs more than the event that Notion already sends.

## Consequences

- Notion intake distinguishes `page.content_updated` events by database; an integration test enforces the discard for the other databases.
- A page that is already gone or that the integration cannot access is discarded with a reason: a redelivery will not bring it back. A temporary read failure returns the delivery to Notion.
- The `event_evaluation` frame recognizes a body edit as a cause.

## Cost

- There are more budgeted runs: every session of editing the body of a Task or Project is at least one window, and an edit that runs longer than the window ceiling is two.
- A page type without `data.parent` costs a REST read per event.
