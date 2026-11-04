# ADR 0027 — Methodology rules — a deterministic layer over the records read

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D27` |
| **Related** | ADR 0010 · ADR 0011 · ADR 0032 · `INV-003` · `INV-055` · `INV-081` · `INV-094` |

## Context

The model reads the rules of the methodology — what an open Task is, whether a Task can get into Available Now, what is left to settle in a closed Project, when a Task's status contradicts its dependency — in the text of the Skill. But they are also needed where there is no model or it cannot be the judge of its own work:

- the duplicate check when an Inbox item is closed must know that the existing Task is open: otherwise an item would be closed as a duplicate of a Task that is already `Done`;
- the gate needs a reference that is not derived from the Skill: otherwise a rule that is tuned together with the text stops proving anything (`docs/4-acceptance.md` § “Document contract”);
- the safety sweep works without a model, and its selection is these same rules: a closed Project with unfinished Tasks, `Waiting For` whose `Date` comes due, an approaching deadline.

“The App contains no parallel Task/Project/Knowledge model” (`docs/2-system.md` § “App — durable execution/control plane”): the rules in the App need not create one.

## Decision

**`methodology/` is a separate layer of pure functions over the canonical records that were read: no state, no I/O, no Nest providers, and not a tool of the model.**

- The layer sits above `notion/semantics/` and below its consumers: distinguishing semantics is the job of the behavior layer, not of the adapter (ADR 0010).
- A rule answers a question about a **freshly read** record, stores nothing and reads nothing itself (`INV-003`): it is a projection of what was read, not a second domain model.
- The result is one of three states, not a boolean: the rule is met, is not met (with a reason) or cannot answer (`undetermined`) when a field is unread, absent or unknown (`INV-094`). The reasons use the same vocabulary as the adapter's.
- A rule is derived from the methodology and the policy, not from the Skill. The Skill and the code are written separately on purpose; an agreement test, not anyone's memory, guards against divergence between them.
- The canonical status names are taken from `notion/semantics/` as types: nobody outside `binding/` and `semantics/` reads the binding (`INV-081`), and exhaustive rule tables do not compile when a status for which the rule has no answer appears in the binding.
- `availableNowCandidacy` covers only the mechanical necessary conditions of Available Now: the Task's status, the Project's status, a standalone Task. Concreteness, context, the calendar and selectivity remain the judgment of whoever composes Available Now.
- A rule over a collection takes it from the relation between records, not from an array the caller assembled: a Project's Tasks from the `Tasks` relation (`tasksOf`), blockers from the dependency relation. “Nothing is left” (`settled`, `clear`, `none`) comes only from a complete list in which every element has been read. An element that was not given to the rule, or that could not be judged, is named alongside a definite answer (`unreadable`, and in the dependency rule `unknown`) and does not erase it: one known open Task proves `unsettled`, one blocker that is definitely unresolved proves `blocked`, whatever the rest.
- An optional field is read through a single accessor (`presenceOf`, `dateKindOf`, `linkedPageIds`): `empty` means “absent”, a value of the needed shape means “present”, and any other reading state asserts nothing. Rules do not write their own `=== 'value'` checks.
- A candidate for a question about a paused Project is an open Task with a `Deadline`, or a `Scheduled`/`Next Action` Task with a `Date` that carries a time of day. `Date`s on `Waiting For` (the check date) and on `Someday/Maybe` (the return date) are times for attention that a pause legitimately suppresses, and a `Scheduled` deferral “until the day” is a view, not a calendar commitment (`docs/1-methodology.md` § “Project Status”, § “Hard landscape”). The rule names what to ask about; the person decides whether each candidate is hard.
- The rule raises a contradiction between `Waiting For` and an already resolved dependency only when it has read the Task body and the body is empty: the external side of the wait is in prose, which the rule does not read, so where there is prose it says `undetermined`, not `contradiction`.
- The layer is not exposed through the App MCP: the App does not repeat what the person does through Notion or GBrain (`INV-055`).

## Consequences

- Consumers: the duplicate check and the check on linking to a closed Project in `capture/`, the selection of the safety sweep (`sweeps/`), the gate (the reference, and the check that the created world reads as intended), the tests of the acceptance rows on Available Now, `Paused` and the closing of a Project.
- `NotionRecordReader` reads the records for the sweep and gate rules.
- A structural boundary (`INV-094`): the layer imports only the types of the record read, and itself.
- The write rule “`Next Action` without a planned date” lives in the adapter: it is a safeguard at the boundary of the write ([ADR 0032](0032-next-action-no-date.md)). The layer does not duplicate it.

## Cost

- A rule lives in two forms — for the model and for the code; the agreement test compares the lists of statuses, not the meaning of a sentence. The reading states are guaranteed by a matrix of each rule against each state of each field it touches.
- Completeness costs reads: closing a Project requires reading each of its Tasks, `Done` ones included. The answer is as fresh as the synchronization of the Project's `Tasks` — the other side of the two-way relation, which Notion maintains itself.
- The reference for the `Waiting For` contradiction mostly answers `undetermined`: a page body almost always has some content, and the layer does not read the discussions (`discussion`), where the side of the wait may also be found. Judging prose is the Skill's job.
- A date without a time that is in fact hard is invisible to the rule: the methodology puts such things in the Calendar, and without a time it is impossible to tell “Friday at 16:00” from “not before Friday” (ADR 0010).
