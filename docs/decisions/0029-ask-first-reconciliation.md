# ADR 0029 — A closed Project: the system asks first, the person names `Failed`, dependency comes from relations

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D29` |
| **Related** | ADR 0027 · ADR 0032 · ADR 0048 · `INV-005` · `INV-016` · `INV-034` |

## Context

When a Project becomes `Done` or `Canceled`, each of its unfinished Tasks must be settled: completed, no longer needed, promised but not carried out, or re-linked (`docs/1-methodology.md` § “Project Status”). A proposal from an autonomous run is a change to one page, so N Tasks would mean N proposals that the person would have to approve with separate clicks, for a choice the person has not made yet. Besides, the difference between “not needed” and “was needed and did not happen” is a judgment about a commitment that cannot be observed in the data: the person sets `Failed`.

Dependency is expressed by the “Blocked by” relation and the derived formula `Blocked`. The person pastes the formula into each workspace by hand (ADR 0048) and can change it, so its expression can diverge from the rule — say, `some` where `every` is needed.

## Decision

**An autonomous run on a closed Project asks instead of deciding; the person's answer becomes proposals, one per Task; dependency is derived from the relation and the statuses.**

- One comment on the Project names every unfinished Task and asks what it becomes: at most one notification, no proposals, no status changes.
- When the person has replied in the thread, the reply run proposes **the transitions the person named** — one proposal per Task. The system does not originate `Failed` and `Canceled`: it passes them on when the person has said them.
- When the person has decided on changes to several objects with a single word, they can make them in Chat or in Notion themselves; each proposal of the system is approved separately.
- `methodology/` ([ADR 0027](0027-methodology-layer.md)) derives the state of a dependency from the “Blocked by” relation and the blockers' statuses: a blocker is resolved when it is `Done` or `Canceled`; `Failed` does not resolve a dependency. The `Blocked` formula is a hint: the gate checks it against the rule.
- The system does not propose `Failed` itself: that would contradict the source — the methodology.

## Consequences

- Acceptance states that the system asks about `Failed` rather than proposing it; the contract (`project_model`) names `Failed` among the ways to settle a Task of a closed Project.
- Transition proposals are subject to the rule about a date on `Next Action` ([ADR 0032](0032-next-action-no-date.md)).

## Cost

- The person answers in words rather than with one button for the whole Project, and each named Task needs its own approval.
- Closing a Project that has many Tasks costs several runs: the question, the answer, and only then the proposals.
