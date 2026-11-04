# ADR 0010 — Two time properties of a Task

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D10` |
| **Related** | ADR 0001 · ADR 0027 · ADR 0032 · `INV-004` · `INV-005` |

## Context

Time raises two different questions about a Task, and neither reduces to the other.

The first is **when the work returns to attention**. The person chooses the time: defer until Friday, check a dependency on Monday, return to a decision in March. Until then the Task must not be on the surface.

The second is **by when the work must be finished**. The time is usually imposed from outside, and the work can be done at any time before it.

Both questions face one Task at the same time: work scheduled for Friday may well have a deadline at the end of the month.

Within the first question the variants do not coexist. A Task has exactly one status, and each variant of activation has its own status: a time to do the work belongs to `Scheduled`, a dependency check to `Waiting For`, a return to a decision to `Someday/Maybe`. Two activations on one Task cannot occur, by construction.

## Decision

**Two properties: `Date` is activation, `Deadline` is a constraint.**

`Date` covers all the variants of activation; what it means when it comes due is read from `Task Status` (the table is in [`docs/2-system.md` § “`Date` and `Deadline`”](../2-system.md#date-and-deadline)). `Deadline` does not depend on the status and is set on any non-terminal Task.

One field for three semantics needs no carrier for each: the status already tells them apart, and a second carrier would repeat the same distinction. The constraint does need a carrier: it is orthogonal to the status and must coexist with activation.

The names are chosen by a zero-learning criterion: the person knows both words from any task manager, and neither has to be matched against the status to understand what to enter. Precision comes not from the field's name but from the status and `INV-005`.

## Consequences

Both properties are read natively, each from its own property (`INV-004`). The adapter reads each slot of a record from its own carrier: reading `Date` does not rely on the status, and an unrecognized status value does not stop `Date` from being read. Telling the semantics apart is the job of the behavior layer, not of the adapter.

`INV-005` applies to `Date`: a planned date on a `Next Action` means the Task belongs in `Scheduled`, so a Task does not stay with `Next Action` and `Date` together ([ADR 0032](0032-next-action-no-date.md)). `Deadline` can be set freely.

## Cost

The difference between “I promised to do this on Friday at 16:00” and “it makes no sense before Friday” is not expressed in the model: both are `Scheduled` + `Date`. A hard time-fixed commitment is carried by the Calendar as the hard landscape, and a `Date` with a time of day is read by the system only as a candidate for such a commitment ([ADR 0027](0027-methodology-layer.md)).

The name `Date` carries no semantics. This is deliberate: a name that spelled out all the variants of activation at once would be reasoning, not a column header.
