# Attention labels

An attention label names one kind of claim. A **detection** is one claim with the evidence behind it. A situation can carry several labels at once, and each one whose conditions hold is raised, not only the most urgent: a `Waiting For` Task can be a `dependency` and, with a `Deadline` at risk, a `deadline_risk` as well.

## Evidence

- A claim stands only on objects you have just read. Your recollection, an earlier conclusion, a comment saying something exists, a summary someone gave you: none of it counts. Read the state again.
- Name concretely what you looked at that could have refuted the claim, and what you could not settle.
- Check a field's state before you rely on it (`schema.md`): an unread page body is "unread", not empty, and a field this workspace does not carry supports no claim. A figure the workspace calculates itself (`task.blocked`) can be cited as its figure. A Task with status `Hidden` is never raised.
- Time since a page was last edited is a weak sign: any edit resets it. Never claim from it alone.
- A Task of a `Paused`, `Done` or `Canceled` Project is not raised on its own as `dependency`, `deadline_risk` or `contradiction`: a pause is the person's decision to stop, and a closed Project's Tasks are settled together. The Project is raised only as `project_integrity`, on its own conditions. Read the Project's status first.

## Labels

### unclarified_input

- Claim: an Inbox item is stale, as `reviews.md` defines it. An item in the trash is resolved.
- Not a claim when: an equivalent object exists (that is a duplicate to resolve).

### untracked_commitment

- Claim: a specific owner took on specific future work or a bounded outcome, and no equivalent object exists. An intention, an idea, a wish or a hypothetical plan is not a commitment. It matters now because it exists only in a conversation or comment; a near time constraint makes it urgent.
- Read: the statement itself (owner, action, any time constraint); a search for an equivalent open Task or Project (not finished, canceled or failed).
- Not a claim when: an equivalent open object exists; the wording is conditional or tentative; the owner is an outside party and your side waits on it (that is `dependency`).
- Pick the type with `ontology.md`.

### dependency

- Claim: something unresolved (a person, a system, an event or a Task) stops concrete work from moving or finishing now. A Task in that state is `Waiting For`; its `Date` is the moment to check on the dependency.
- Read: the Task (`Status`, `Date`, `Deadline`), its dependencies (`task.dependencies`, the Tasks that block it) and each blocker's status, the Project with its status, and the Project's other Tasks. The outside party and what is awaited usually live in the page body or a thread; once the check `Date` has come, read them and the blockers' statuses to see whether what is awaited has arrived.
- Not a claim when: its dependency is resolved and the page body and thread name no one else still awaited (that is a `contradiction`); another open Task can move the Project, a `Next Action` or a `Scheduled` one whose `Date` has not passed (this Task still stays `Waiting For`); the `Date` has not come; the thread already holds the follow-up or the answer.
- A blocker resolves a dependency when it is `Done` or `Canceled`; `Failed` does not. A blocker that is `Hidden` or unreadable settles nothing either way. A dependency is resolved only if it has blockers and all of them are resolved; a Task with no blockers is never resolved this way.
- When a dependency resolves, the Task takes the status it actually has now (`Done`, `Next Action` or `Scheduled`). `Failed` is only ever the person's call.

### deadline_risk

- Claim: a `Deadline` together with another sign that it will be missed: a `Waiting For` dependency the work cannot go on without and no other Task can replace; the `Deadline` passed with the work open; no `Next Action` that can move the work; or a thread or note that names an unresolved decision or a capacity limit. A `Deadline` alone is not a risk. Read `Date` and `Deadline` separately.
- Not a claim when: another Task can still move the work; the thread already acknowledges the risk as it stands now; the person asked for it to wait until a later moment; the Task is `Scheduled` for a `Date` that has not passed and falls before its `Deadline` (the work is planned); the only basis is a guess about effort.

### project_integrity

- Claim read from properties and relations alone, one of: a `Planning` Project with no open Task; an `Active` Project with nothing in motion (no open Task that is a `Next Action`, a `Scheduled` one or a `Waiting For` one); a `Paused` Project with a time-fixed commitment (`ontology.md`; the person decides: keep, move, cancel or attach elsewhere); a `Done` or `Canceled` Project with unfinished linked Tasks.
- Claim that needs your reading of text or history, one of: a definition of done worded so that nobody can tell when the work is done (its absence is not a finding); a `Planning` Project that has Tasks but none that clarifies or designs it; a Project that is really an ongoing responsibility or a recurring behavior; stagnation, only with at least two independent signs of no progress.
- Not a claim when: a `Planning` Project carries executable clarification Tasks (that is healthy); the open Tasks of an `Active` Project wait or are scheduled (that is work in motion, and its risks are `dependency` and `deadline_risk`).

### behavior_system_friction

- Claim: a recurring behavior is not working as intended, and there is evidence about a concrete design lever: cue, context, friction, minimum or target version, environment, success rule or recovery rule. These live in the Behavior System's page body. Lifecycle status (`Installing`, `Maintenance`) does not say whether the behavior has become automatic. A miss is never a verdict on the person: name the design lever.
- Not a claim when: the basis is one missed repetition or repetition alone, or an empty series (it cannot be told from an abandoned system). With no cadence recorded, a pause cannot be told from a skip.

### area_of_focus_risk

- Claim, on one of three grounds only: its state deviates from its `Standard`, as memory holds it (`memory.md`); its `Mode` no longer matches where work and attention go; under `Advance`, nothing linked to it is in motion. With no readable `Standard`, or nothing read shows whether it is met, the first ground does not apply: judge the other two.
- In motion, linked directly, through a Project or its Objectives' Key Results: a `Next Action`, `Scheduled` or `Waiting For` Task, with no Project or in an `Active` one; an open Task in a `Planning` Project; a Behavior System `Installing`, `Stabilizing` or in `Maintenance`.
- Not a claim when: the imbalance is deliberate; the basis is that nothing is in motion under `Maintain` or `Minimum`, a comparison with other Areas of Focus or the lack of an Objective.

### objective_evidence_change

- Claim: Key Result evidence or an assumption behind an Objective changed materially. You cannot read Key Result evidence, so never claim from your own reading that it moved. Claim it only when the person said so in their own words, and cite that statement.
- When a decision depends on what the evidence shows, ask the person. Whether to continue, adapt, pause or abandon an Objective is theirs to decide.
- Not a claim when: the basis is Task or Project completion. A finished Project is not proof that a Key Result moved.

### resource_conflict

- Claim: named Projects, Behavior Systems or Objectives claim the same limited resource, with a consequence for capacity, priority or direction. Evidence: the `Mode` of an Area of Focus, `Scheduled` Tasks with a `Date` in the same period, a capacity limit the person stated.
- Not a claim when: the imbalance is deliberate; no consequence follows; the claimants are the same work seen twice; the objects only share a tag or an Area of Focus (they conflict only if the shared resource is limited).

### contradiction

- Claim: two explicit, source-backed claims or states cannot both stay current, each read now. Cases: a `Waiting For` Task whose dependency is resolved and whose body and thread name no one else still awaited; a `Next Action` Task with an unresolved prerequisite. A finished Project with an unfinished Task is `project_integrity`, not this label.
- Not a claim when: a reading makes both true (`Date` versus `Deadline`, display name versus canonical status); one side is stale; you only inferred a side; there is one side only, or mere similarity.

### forgotten_context

- Claim: a specific GBrain page directly changes the current decision, warns against repeating a mistake, or adds a constraint the Notion context lacks. Topical similarity without a causal link is not enough. Read both halves: what GBrain holds about the object, starting from its anchor (`memory.md`), and the Notion context that lacks the constraint.
- Not a claim when: the page is superseded or stale; the Notion context already carries the constraint; the page is for a similar object, not this one; you could not read GBrain.

### opportunity

- Claim: a new concrete possibility, an action available to the person, a clear benefit and a bounded useful window. Interesting information on a related topic is not an opportunity.
- Raise it only when the person leads, and only with all four parts evidenced.

## Self-regulation

Never infer perfectionism, avoidance, low energy or value conflict from one overdue Task or one missed repetition. Look at structure first: clarity, size, prerequisites, choices, capacity, environment. One episode yields at most a neutral question; a lasting pattern follows `lessons.md`. Do not diagnose.
