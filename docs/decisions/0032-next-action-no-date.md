# ADR 0032 — A Task does not stay with `Next Action` and a date: the rule checks the result of the write

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D32` |
| **Related** | ADR 0010 · ADR 0024 · ADR 0029 · `INV-005` |

## Context

`Date` has meaning only together with a status, and on `Next Action` (“can be started right away”) a planned date means `Scheduled` (ADR 0010). A Task with `Next Action` and a date is ambiguous: the date may be a leftover from waiting or a plan for the day. The rule is enforced at the write boundary, and it has three difficulties.

- This state is reached not only by a request in which the status `Next Action` and a date appear together, but also by moving a Task that already has a date into `Next Action` and by writing a date into a `Next Action` Task. Checking the request alone sees only the first path.
- A request can be wrong in itself, or wrong only for this page, because the other half is already on it. In the second case the fault lies not in the request but in what is on the page; when an approved change is executed, it is a state that changed after the proposal was made.
- The time zone of a date in the page state can be set by Notion itself or by the person. For a condition on the page state (ADR 0024) it is not a discrepancy, but for the confirmation of the system's own write it is.

## Decision

**`Next Action` has no `Date`, and the system does not perform a write after which a Task would have both.**

- The result of the write is checked: the status and the date are the ones the request writes, and whatever the request does not name is taken from the page. This catches three paths: a date written to a `Next Action` Task, a move into `Next Action` of a Task that has a date, and a request that contains both.
- A move that clears the date in the same write passes, so a status and a date that change together are written in one write. A write that touches neither the status nor the date is left alone by the rule; so are `Deadline` and the closed statuses.
- A refusal says where the fault lies. A request that is wrong for any page state is a fault in the request (`failed`). A request that is wrong only for this page is a change of state: at the time of the proposal it is a refusal with a reason, and at execution it is `conflict`.
- The system confirms its own write more strictly than a value condition reads the time zone of a date (ADR 0024): without a time zone, because it writes no time zones. A point in time without an offset is not placed in time and equals nothing.
- In Chat the write goes through Notion's own tools with no check by our system, so there the rule is enforced by the Skill (`ontology.md`).

## Consequences

- A proposal that moves a Task with a date into `Next Action` clears the date through a second effect (ADR 0029); a “date only” proposal on a `Next Action` page is rejected right at submission.
- Refusals are told apart: after a refusal of the request the model rebuilds the request, and after `conflict` the proposal loses its validity.

## Cost

- The check sometimes reads the page, when the answer depends on it.
- The rule does not cover what the person did in Notion themselves: a page with a date on `Next Action` left by the person stays that way, and the system writes its other fields without hindrance.
