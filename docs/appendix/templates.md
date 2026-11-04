# Appendix: Minimal templates

In this appendix: eight starter templates for objects, from the Identity Charter to the Weekly Control Review. The norm lives elsewhere: in [`docs/1-methodology.md`](../1-methodology.md) (the domain), [`docs/2-system.md`](../2-system.md) (page serialization) and [`contracts/canonical.yaml`](../../contracts/canonical.yaml) (lists of values). A template gives a form but introduces no fields or requirements. Read it when creating the first object of each type.

## Object template — not a page format

The templates describe the **domain form of an object**: which fields an Identity, Area of Focus, Objective, Project, Task or Behavior System has and what should be written in those fields. The form does not depend on the tool: the same thing can be kept in a text file, in Notion or on paper.

**The physical encoding of a page is a separate question.** The carrier of each field (a property, the page body, long-term memory or no carrier at all) is set by [`contracts/notion-workspace.yaml`](../../contracts/notion-workspace.yaml), key `binding.fields`; how the page body is read is set out in [“Page body”](../2-system.md#page-body). This is the serialization layer, not the semantic one.

A template names the fields in domain language. Before relying on a specific field in automation, check its carrier in `binding.fields`.

## Eight templates

The templates are starting points: fields that do not help make decisions can be deleted.

### Identity Charter

This template records the orientation of one Identity and its boundaries; only the name is required, and the rest is prose that is added when there is something to say. Principles are the content of the Identity Charter, not a separate object.

```markdown
## Identity: [name]

Meaning:
[1–3 sentences]

Principles:
- [...]
- [...]
- [...]

Boundaries / what this identity does NOT imply:
- [...]
```

The fields are defined by [“5.2. Identity Charter”](../1-methodology.md#52-identity-charter).

### Area of Focus

This template describes an ongoing domain of responsibility; the name and `Mode` are required. The acceptable state (`Standard`) is not filled in beforehand: it emerges in the course of reviews, and the system keeps it in long-term memory, not on the page.

```markdown
## Area of Focus: [name]

Mode:
Advance | Maintain | Minimum

Standard:
[What "healthy enough" means; it takes shape in the course of reviews, not in advance]

Signals to watch:
[Only the indicators that really help the review]

Current concerns:
[optional]
```

The fields are defined by [“6.1. Standard”](../1-methodology.md#61-standard) and [“6.2. Mode: Advance, Maintain, Minimum”](../1-methodology.md#62-mode-advance-maintain-minimum); the values of `Mode` are in [`contracts/canonical.yaml`](../../contracts/canonical.yaml).

### Objective & Key Results

This template describes one meaningful change and the evidence that shows it; the Objective itself and the collection of Key Results are required.

```markdown
## Objective: [meaningful desired change]

Area of Focus:
[optional]

Why now:
[Why this change is worth the resources]

Time horizon:
[...]

Key Results:
- Key Result 1: [observable evidence / target condition]
- Key Result 2: [...]
- Key Result 3: [...]

Review notes:
[What reality shows; what we are changing]
```

Mechanisms attach to a Key Result, not to an Objective: a Project or Behavior System points to the Key Result that it is meant to move. `Why now`, `Time horizon` and `Review notes` have no carrier in the workspace: the structure of L2 is incomplete ([Degradation register](../3-policy.md#degradation-register), `G13`).

The fields are defined by [“7. Level 2 — Objectives & Key Results”](../1-methodology.md#7-level-2--objectives--key-results); what goes into `Review notes` is defined by [“7.7. Goal adjustment during review”](../1-methodology.md#77-goal-adjustment-during-review).

### Project

This template describes a bounded intervention; the name and `Status` are required. The boundary of the work is described when it does not follow from the name and the set of Tasks; its absence is not a violation.

```markdown
## Project: [bounded outcome/change]

Area of Focus:
[...]

Key Results:
[optional; the Objective is reachable through a Key Result]

Definition of Done:
[if the boundary does not follow from the name and the Tasks]

Status:
Planning | Active | Paused | Done | Canceled

Tasks:
[linked Task collection/view; do not duplicate Task state here]

Support:
[links/notes]
```

The fields are defined by [“9.1. Definition of Done”](../1-methodology.md#91-definition-of-done) and [“9.4. Project Status”](../1-methodology.md#94-project-status); the values of `Status` are in [`contracts/canonical.yaml`](../../contracts/canonical.yaml).

### Task

This template describes a unit of work to be done; the name and `Status` are required, and the other fields are used as needed.

```markdown
## Task: [specific work / tracked commitment]

Status:
Next Action | Scheduled | Waiting For | Someday/Maybe | Done | Canceled | Failed

Project:
[optional]

Behavior System:
[optional; if the Task is an instance of the repeated behavior]

Area of Focus / Key Results:
[optional; only if useful]

Date:
[optional; when the work returns to attention; not set for Next Action]

Deadline:
[optional; the latest time by which the work must be finished]

Dependencies:
[optional; Tasks without which this one will not progress]

Waiting for:
[optional; the external party for Waiting For]

Context / constraint:
[optional]

Result / note:
[optional]
```

Status and the time fields do not duplicate each other: a `Deadline` does not make a Task `Scheduled`, and a `Date` on a `Waiting For` Task does not turn it into a `Next Action` ([“11.7. Task time properties”](../1-methodology.md#117-task-time-properties)). An Objective is not a separate field of a Task: it is two steps away, through a Key Result ([“11.8. Tasks and Projects”](../1-methodology.md#118-tasks-and-projects)). The semantics of the statuses is defined by [“11.1. Task Status”](../1-methodology.md#111-task-status), and the list of values by [`contracts/canonical.yaml`](../../contracts/canonical.yaml).

### Behavior System

This template describes a recurring behavior and its design; the behavior itself and `Lifecycle` are required.

```markdown
## Behavior System: [behavior]

Supports:
[Identity / Area of Focus / Key Result / Project]

Lifecycle:
Designed | Installing | Stabilizing | Maintenance | Retired

Automaticity / form:
[optional description, e.g. deliberate Routine / increasingly Habitual]

Cue:
[what triggers the behavior]

Context:
[the conditions in which the behavior is available]

Frequency / cadence:
[the expected rhythm of repetition; it has no carrier in the workspace, `G18`]

Minimum version:
[...]

Target version:
[...]

Environment / friction design:
[...]

Success rule:
[...]

Recovery rule:
[...]

Tasks:
[linked Task instances; the record of completions is derived from them and is not kept separately]
```

The fields are defined by [“10.2. Behavior System structure”](../1-methodology.md#102-behavior-system-structure); `Lifecycle` and `Automaticity / form` are different dimensions ([“10.1. Lifecycle and automaticity — different dimensions”](../1-methodology.md#101-lifecycle-and-automaticity--different-dimensions)), and the values of `Lifecycle` are in [`contracts/canonical.yaml`](../../contracts/canonical.yaml). `Frequency / cadence` has no carrier in the workspace ([Degradation register](../3-policy.md#degradation-register), `G18`).

### CBT / Behavioral Experiment

This template takes one behavioral experiment from the situation to an update to a belief or behavior; there is no separate field contract for it in [`contracts/canonical.yaml`](../../contracts/canonical.yaml).

```markdown
## Situation
[...]

## Automatic interpretation
[...]

## Emotion / urge / behavior
[...]

## Prediction
[What I expect if I do it differently]

## Alternative interpretation
[...]

## Experiment
[A concrete, safe test]

## Observed result
[...]

## Update
[What should change in the belief / behavior / system]
```

The structure is defined by [“17.2. Thought model”](../1-methodology.md#172-thought-model) and [“17.3. Behavioral experiments”](../1-methodology.md#173-behavioral-experiments).

### Weekly Control Review

A checklist for one Weekly Control Review; the completion criterion is restored trust in the system, not boxes checked off.

```markdown
# Weekly Control Review

Capture / Clarify
- [ ] Main inboxes processed enough to trust them

Control
- [ ] Calendar reviewed
- [ ] Waiting For Tasks and follow-ups reviewed
- [ ] Upcoming Scheduled Tasks reviewed
- [ ] Planning Projects are clarified enough to progress or intentionally remain Planning
- [ ] Active Projects have a valid current Task path
- [ ] Paused Projects are still intentionally paused; any real Calendar commitments/deadlines are renegotiated
- [ ] Installing / problematic Behavior Systems reviewed

Alignment
- [ ] Areas of Focus scanned for neglect
- [ ] Relevant Key Result data checked

Simplify
- [ ] Stale commitments renegotiated according to object type
- [ ] Unnecessary tracking or system overhead removed

Next week
- Main constraints:
- Primary focus:
- Risks / follow-ups:
```

The sequence and the criterion are defined by [“22. Weekly Control Review”](../1-methodology.md#22-weekly-control-review); the item on unnecessary tracking and overhead is covered in [“25. Anti-Bureaucracy Rules”](../1-methodology.md#25-anti-bureaucracy-rules).
