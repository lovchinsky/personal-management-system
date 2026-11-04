# Object types, statuses and dates

Physical names and identifiers come from `schema_read`, never from memory.

## The five levels

`Identity` with its Principles at the top; below it `Area of Focus`; then `Objective` and `Key Result`; then `Project` and `Behavior System`; and `Task` at the bottom. Links between levels are many-to-many, not a tree.

## What each object is

- **Identity**: a relatively stable chosen orientation, who and how the person chooses to be in a meaningful context, with the Principles that govern their decisions. One operational failure is information, not a reason to question it.
- **Principle**: a decision rule for choosing between permissible options. It has no page of its own: it is prose in the Identity page.
- **Area of Focus**: an ongoing domain of responsibility whose state must be assessed and maintained. It has no Definition of Done and is never closed. Its `Standard` is the acceptable state; it emerges in review and is kept in the GBrain anchor of the Area of Focus, so do not ask for it up front. Before suggesting a new Area of Focus, look at the existing ones and state its `Mode`.
- **Objective**: a meaningful desired change, a gap between the current and the desired state that justifies focused resources for a period. A healthy Area of Focus needs none: its `Standard`, its `Mode` and Behavior Systems carry ordinary maintenance. Before suggesting an Objective, check that the Area of Focus does not simply need maintenance.
- **Key Result**: observable evidence or a target condition for progress on an Objective. "Launch the site" hides a Project or an output: say so and ask whether it is a deliberate milestone. A finished Project or Task does not show that a Key Result moved. The evidence of a Key Result cannot be read from Notion or GBrain, so ask the person what it shows.
- **Project**: a bounded multi-action commitment with a Definition of Done. That is a short set of conditions after which the Project is no longer held active, written in the page body ("as well as possible" is not one). A Project has no date of its own; its timing is its Tasks' dates. When you suggest one, give the Definition of Done in a line, only the Tasks needed for the next reliable move, and `Planning` or `Active` by readiness.
- **Behavior System**: deliberately designed recurring behavior with its cue, execution, maintenance and review. It is the definition; each occurrence is a Task.
- **Task**: the smallest tracked unit of execution: concrete work, an expected result or a potential future action, with exactly one status. It needs no Project, Objective or other parent.
- **Inbox item**: not a Task, and it has no status. While it exists it is unresolved; a resolved one goes to the trash.

The role decides the type, not the name. "Read investment reports" is a Behavior System as a recurring practice, a Project as one bounded research cycle, a Task as one specific report. When a phrase fits two levels, ask what it is for.

| Question | Rule |
|---|---|
| Area of Focus or Objective | No natural end, an ongoing responsibility: Area of Focus ("Health"). A substantially different state worth concentrating on for a time: Objective ("Restore cardiovascular capacity") |
| Objective or Project | A desired change of reality: Objective. Bounded work that can be finished: Project ("Redesign onboarding") |
| Key Result or Project | Evidence that the change happened: Key Result ("Activation rises from 42 to 60 percent"). Work done to influence it: Project |
| Project or Task | One unit of work: Task. Several Tasks needed for the Definition of Done: Project ("Complete the annual tax filing") |
| Behavior System or Project | It must recur: Behavior System ("Review portfolio monthly"). One bounded result, then it ends: Project ("Consolidate brokerage accounts") |

## Task statuses

| Status | Means | `Date` means |
|---|---|---|
| `Next Action` | concrete enough to start and nothing has to happen first: it can be done now | nothing: leave it empty |
| `Scheduled` | deliberately tied to a future moment or context, which is why it is not up for action now | when the work becomes relevant and it is time to do it |
| `Waiting For` | blocked by another person, system, event or dependency, delegated work included; the Task's name says who or what | when to check on the dependency; the status stays |
| `Someday/Maybe` | stored, not committed: only a potential future action | when to return to the decision |
| `Done` | the work is completed | leave alone |
| `Canceled` | no longer needed; the commitment is lifted | leave alone |
| `Failed` | the commitment stood and the attempt did not happen or did not finish | leave alone |

- Choose the status from current reality, not from dates. A `Deadline` never makes a Task `Scheduled`: available work with a `Deadline` stays `Next Action`, and a Task with an unresolved dependency stays `Waiting For` even with a `Deadline`. A `Date` arriving, a missed `Deadline` or a started Task change no status; a started Task stays `Next Action` until it is `Done`.
- The first four statuses change into each other as availability changes. `Done`, `Canceled` and `Failed` are final and come from the person's decision, never from converting an Inbox item. On a final Task leave an existing `Date` or `Deadline` as it is and write neither.
- `Failed` is the person's judgement: from data alone, "no longer needed" (`Canceled`) and "needed and did not happen" (`Failed`) look the same. If a lapsed commitment needs a status, ask which it is.
- `Done` means the work was finished, not that its outcome was reached. New work after a bad result is a new Task.
- The step of chasing someone ("Write to Legal") is its own `Next Action` Task; the original stays `Waiting For` until the result arrives or the commitment changes.
- "Work on investment strategy" is not concrete enough for `Next Action`: clarify until the action is clear, then stop.
- A status the workspace uses that is not in this table (such as `Hidden`) is none of these; `schema.md` says how to treat it.
- A status change on your own recommendation is a decision for the person, however obvious it looks.

## Date and Deadline

`Date` answers "when does this return to the person's attention" and is the person's to choose. `Deadline` answers "by when must it be finished" and is usually imposed from outside. They are independent; a Task may carry both. The status gives `Date` its meaning.

- When a change touches a Task's status or `Date`, judge the two as they will stand after it, and write them together, never one after the other. Write a `Date` only when that status is `Scheduled`, `Waiting For` or `Someday/Maybe`; `Next Action` carries no `Date`. So a `Date` planned for a `Next Action` Task means `Scheduled`, and a Task moving into `Next Action` has its `Date`, if it has one, cleared in the same write.
- A commitment fixed to a time ("promised for Friday 16:00") and "not before Friday" are both `Scheduled` with a `Date`.
- A time-fixed commitment is an open Task that has a `Deadline`, or a `Next Action` or `Scheduled` Task whose `Date` carries a time of day. A `Date` with no time, and the `Date` of a `Waiting For` or `Someday/Maybe` Task, only say when to look again.
- A day next to an action that happens at a moment ("call the bank tomorrow at 9") is its `Date`. A day next to a result to hand over ("send the offer on Friday") may mean do it then or have it done by then: ask. Do not guess between `Date` and `Deadline`.

## What is the person's to decide

On your own recommendation, none of these is yours to do. Say what you would change and let the person decide:

- a Task you inferred, rather than one the person asked for or put in the Inbox; a Project, Behavior System, Objective, Key Result, Area of Focus, Identity or Principle you inferred;
- a change of a Task or Project status, a Behavior System lifecycle, a date or a relation;
- a change of the `Standard` or `Mode` of an Area of Focus, or of an Identity or a Principle;
- an Objective review decision other than `Continue`;
- trashing or deleting anything as a standalone act;
- a message to another person;
- in GBrain, a lesson, a pattern about the person, or a change of an anchor's compiled truth.

Nobody's request opens these writes: a formula or rollup (change what it is computed from), a value that is not canonical, and the workspace schema (the person changes it in Notion themselves). Refuse and offer the allowed path.

