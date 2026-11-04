# Reviews

What each review covers, and how to judge what you find in it.

## In every review

- Read the relevant scope only: not the whole backlog, and no climb to every higher level for a small Task.
- Claim only what you read. A prose field the workspace does not carry, or an empty one (a Definition of Done, say), is not a finding (`schema.md`).
- Raise an `opportunity` or general stagnation only if the person brings it up.
- Weekly, strategic and deep reviews judge situations the way `detectors.md` describes. Say what you saw; what happened is the person's to tell, and a mechanism is explored only if they agree.
- Each finding says what the person can do about it. A review changes nothing by itself: a change is made after the person's yes.

## How long is long

- The daily control looks at today and the next 3 days.
- The weekly control review looks at the past 7 days and the coming 7 days.
- An Inbox item is stale when it was captured at least 3 days ago and is still in the Inbox; comments on it do not change that.

## Daily control

It shows time-fixed commitments, a few Tasks to start now and what waits for the person.

- Time-fixed commitments (`ontology.md`) in its days. A `Paused` Project's still count: list each; the person decides whether to keep it, move it, cancel it or link it to another Project.
- `Scheduled` Tasks whose `Date` is today and that are not time-fixed.
- Tasks whose `Deadline` has passed, or `Scheduled` Tasks whose `Date` has passed, with the work not done. The person decides whether the work fell away (`Canceled`), is still needed, or was needed and did not happen (`Failed`); never assume `Failed`.
- Candidates for Available Now, the few Tasks the person could start now. A Task qualifies when its `Status` is `Next Action`, it is concrete enough to start, its Project is `Planning` or `Active` (or it has none), and no time-fixed commitment displaces it. Offer a few; the person chooses.
- How many Inbox items are stale, in one line; the weekly control review names them.
- Proposals waiting for the person's decision: which page, which property, which value.

## Weekly control review

It checks that Tasks, Projects, Behavior Systems and Areas of Focus still match reality:

- Stale Inbox items: each needs clarifying with the person.
- `Scheduled` Tasks with a `Date`, and `Deadline`s, over its days.
- `Waiting For` Tasks. Their `Date` is when to check the dependency; for each that has passed, whether they still wait is the person's to say. A Task stays `Waiting For` even when its Project has another path.
- `Planning`, `Active` and `Paused` Projects, and `Done` or `Canceled` ones with unfinished Tasks, for `project_integrity`. A missing full plan or an undescribed boundary alone is not a finding.
- Behavior Systems being installed or showing friction (`behavior_system_friction`).
- Areas of Focus (`area_of_focus_risk`).
- Commitments whose status no longer matches what you read (a `Waiting For` Task whose dependency is resolved, an `Active` Project with nothing in motion, `detectors.md`). For each, say what would change.

It ends with the risks first, then the questions and a few `Next Action` Tasks for next week.

## Strategic review

It looks at every Objective and its Key Results, the Projects and Behavior Systems that serve them, resource conflicts, and the `Mode` of each Area of Focus.

- For each Objective, the person answers: is it still relevant, what does each of its Key Results show now, was its target well calibrated, what changed, what was learned, what should change in the Objective, its Key Results or the Projects and Behavior Systems serving it? What the person already said in their own words about a Key Result's evidence is not asked again: judge it by `objective_evidence_change` (`detectors.md`).
- What was learned is where lessons come up. Read the timelines of the Objectives, then of the Projects and Behavior Systems serving them, and when episodes there share something, follow `lessons.md`.
- Two Objectives competing for the same hours, money, attention or energy conflict: name the Objectives, Projects or Behavior Systems involved and what it costs in capacity, priority or course.
- An Objective's review decision is `Continue`, `Adapt`, `Pause`, `Abandon` or `Achieved`. `Continue` changes nothing: state it. For the others, give your recommendation and the evidence you read; the person decides. `Abandon` is a legitimate decision, and an Objective has no `Failed`.
- A change of the `Mode` of an Area of Focus: show the acceptable state memory holds for it, if any (`memory.md`), and what "normal" means for it now is the person's to say.

## Deep review

It examines Identities, Principles and the shape of the Areas of Focus. The questions for the person: do the Identities still describe the orientation the person wants, do the Principles help decisions, does the set of Areas of Focus fit their life, does resource allocation match what they call important, has the system grown more complex than they can keep up with?

- An Identity's meaning, Principles and boundaries, and the signals and concerns of an Area of Focus, are in the page body. Read it when the question needs it.
- Changing an Identity or a Principle is the person's decision. One operational failure does not change an Identity: raise a question about one only when several episodes support it.
- Say what you saw without diagnosing the person (`detectors.md`, its section on self-regulation).
