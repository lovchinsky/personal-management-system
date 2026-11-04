# A personal system for management, productivity and behavior change

**Methodology and architecture**

> This document describes a coherent personal management system: from identity and domains of responsibility to goals, projects, behavior systems and concrete Tasks. The system draws on GTD, OKR, *Atomic Habits*, cognitive-behavioral approaches and research on self-regulation, but it is not a simple merger of these methodologies. Where the approaches it started from conflict, add needless complexity or work poorly in real life, they are adapted or deliberately set aside.

> **Document contract.** This document is authoritative for the domain rules: the types of managed objects, their semantics, the operating loop, reviews and decision rules. It is the most stable document in the repository: nothing generates it, and all the other documents refer to it.
>
> It cites no other normative document. Its only external dependency is `contracts/canonical.yaml`, the machine-readable lists of canonical values. Examples, templates and research notes live in `docs/appendix/`.

---


## Contents

- [0. The system in brief](#0-the-system-in-brief)
- **Part I. Foundations:** purpose, sources, design principles
- **Part II. Architecture:** the five Levels and the logic of their links
- **Part III. Direction:** Identities & Principles, Areas of Focus, Objectives & Key Results
- **Part IV. Change Mechanisms:** Projects, Behavior Systems, Routines, Habits
- **Part V. Execution:** Tasks, Task Statuses, Available Now, WIP
- **Part VI. The operating loop:** Capture → Clarify → Organize & Align → Engage → Reflect → Adapt
- **Part VII. Supporting Structures:** Inbox, Calendar, Task Views, Reference
- **Part VIII. Self-Regulation and CBT:** diagnosis, perfectionism, procrastination, autonomy
- **Part IX. Feedback and Reviews:** Daily, Weekly, Strategic, Deep Review
- **Part X. Integrity:** anti-bureaucracy rules and failure modes
- **Part XI. Reference:** canonical definitions, decision rules
- **Conclusion**

Starting the system, full examples, minimal templates, research notes and the origin map live in `docs/appendix/`. The machine-readable lists of canonical types, statuses, lifecycle values and review decisions are in `contracts/canonical.yaml`.

---

## 0. The system in brief

This system is not meant to plan every minute or turn life into a set of metrics. Its aim is to create a reliable structure that helps, all at once, to keep commitments under control, to understand the direction of travel, to sustain the important life domains, to change behavior and to correct course in light of reality.

The system has five Levels of management:

```text
LEVEL 4 — IDENTITIES & PRINCIPLES
Who do I choose to be, and by what principles do I act?

LEVEL 3 — AREAS OF FOCUS
What must remain under responsible attention?

LEVEL 2 — OBJECTIVES & KEY RESULTS
What must change meaningfully, and what evidence will show that the change is happening?

LEVEL 1 — CHANGE MECHANISMS
Through what mechanisms do we influence reality?
Projects + Behavior Systems

LEVEL 0 — TASKS
What specific unit of work is tracked, and what state is it in?
```

The Levels do not form a rigid tree. A Project can directly support an Area of Focus without having an Objective. A Behavior System can support a Key Result, an Area of Focus or a Project. A standalone Task can appear with no strategic superstructure, for example a Task to call the dentist or answer a letter. Its current `status` determines the local workflow: whether the Task is `Next Action`, `Scheduled`, `Waiting For`, `Someday/Maybe` or already in a terminal state. Whether a Task is in fact available to work on may also depend on the Project Status and the context.

This is an important principle: the system has enough structure to give control, but it must not demand an artificial hierarchy where none exists.

The architecture answers the question of **what we manage**. Separately, there is the operating loop, which describes **what we do with the system**:

```text
Capture
↓
Clarify
↓
Organize & Align
↓
Engage
↓
Reflect
↓
Adapt
↺
```

The operating loop uses the five GTD steps — `Capture`, `Clarify`, `Organize`, `Reflect`, `Engage` — and a separate step, `Adapt`. `Adapt` changes mechanisms, goals and assumptions when feedback shows that the current configuration does not work.

Besides the architecture and the operating loop, there are two cross-cutting layers. **Behavior Design** shapes the conditions in which the needed behavior becomes easier and more stable. **CBT and Self-Regulation** helps tell an organizational problem from a psychological one: an unclear action from fear of failure, overload from perfectionism, a task of low value from emotional avoidance.

The system's core logic can be stated briefly:

> **Key Results are evidence. Projects and Behavior Systems are mechanisms of influence. Tasks are units of execution, and their status determines their current place in the workflow.**

And one more principle, no less important:

> **A trusted system may be complete; the execution interface must be selective.**

The system can know about hundreds of potential actions. The person must not see all of them at the point of execution.

---

# Part I. Foundations

## 1. What the system is for

Traditional productivity systems often solve one problem well and create another. A detailed list of tasks reduces the risk of forgetting something, but it can cause choice overload. Long-term goals set a direction, but they do not guarantee daily behavior. Habit trackers encourage repetition, but they easily turn normal life into a series of checkboxes. Strict planning improves predictability, but it can reduce autonomy and make the day feel psychologically “already lived”.

So the system does not optimize tasks, habits or goals separately. It manages the transition between different types of control: from what matters to what needs to change; from the change to a mechanism; from the mechanism to a concrete action; and from the action back to feedback.

In practice this means the system must perform five functions at once. It must be an external memory for commitments; sustain a strategic direction; protect life domains from unnoticed decline; create conditions for stable behavior; and correct itself when reality contradicts the plan.

### 1.1. What the system does not do

The system does not try to optimize every hour, turn every life domain into Objectives, create a Key Result for every responsibility or measure everything that can be measured. Nor does it assume that more structure automatically means better productivity.

It is especially important that the system does not treat a deviation from the plan as a moral failure. If a plan regularly goes unfulfilled, that is information. The cause may be the wrong Project, a conflict of goals, an excessive volume of work, a badly designed environment, a perfectionist standard, emotional avoidance or simply an initial decision that no longer makes sense.

In this approach a plan is not a contract with one's past self. It is a current model of reality that may be updated.

---

## 2. Intellectual sources

### 2.1. GTD: the operational foundation

From Getting Things Done the system keeps the central idea of an external trusted system and the five workflow steps: `Capture`, `Clarify`, `Organize`, `Reflect`, `Engage`. Projects, the concepts of Next Action, Waiting For, Someday/Maybe and Reference, and the principle of the Calendar as the hard landscape also come from GTD. In this architecture they are normalized around a single entity, `Task`: `Next Action`, `Waiting For` and `Someday/Maybe` are Task statuses and matching views, not different types of records. The official GTD materials define the five workflow steps as Capture, Clarify, Organize, Reflect and Engage [R1].

GTD is especially strong where you need to offload memory, turn a vague “something needs to be done” into a concrete action and keep control over a large number of open commitments. There is no point in reinventing this part of the methodology.

The strategic architecture of the system differs from GTD. It uses `Levels` as types of managed objects. `Identities & Principles` provide the top-level orientation. There is no separate `Vision` Level. A meaningful strategic change is described through `Objectives & Key Results`, and recurring behavior is represented by `Behavior Systems`. The operating loop contains a separate step, `Adapt`, for correction based on feedback.

### 2.2. OKR: the language of strategic change

From OKR the system takes the division between `Objective` and `Key Results`: an Objective describes a desired direction or a meaningful change, and Key Results set the measurable signs that the change is happening. In the classic formulation of OKR, the Objective answers the question of what we want to achieve, and the Key Results answer how we will know it has been achieved [R2].

In this system OKR is used only where there is **meaningful intentional change**. Ordinary upkeep of health, household matters or financial discipline needs no artificial Objective. The universal rule by which 70% completion of a stretch goal automatically counts as a “success” is not used: the result is judged in the context of the initial uncertainty, the difficulty and the feedback received.

### 2.3. Atomic Habits: a practical behavioral heuristic

Identity-based framing, attention to the cue, environment design, friction, repetition and four practical rules (make it obvious, attractive, easy, satisfying) are retained from *Atomic Habits* [R3].

But these “Four Laws” are not treated as exhaustive scientific laws of behavior. James Clear himself presents them as a practical framework. In our system they are used as convenient design heuristics, not as a complete theory of behavioral psychology.

For recurring behavior the system uses the broader concept of a `Behavior System`, because not every recurring action is a Habit in the psychological sense. A `Behavior System` is deliberately designed recurring behavior; it can be performed as a conscious Routine or gain more automaticity and appear as a Habit.

### 2.4. CBT and the science of self-regulation

CBT is not a separate Level and does not replace task management. Its function is to help where the reason things go undone is not organizational vagueness but interpretations, emotions or avoidance.

Especially important for the system are cognitive restructuring, behavioral experiments, behavioral activation, graded engagement, work on perfectionism and implementation intentions. A meta-analysis of randomized trials of CBT for perfectionism showed medium and large effects on various measures of perfectionism, although the body of research has its limitations [R4]. A meta-analysis of interventions against procrastination likewise showed that cognitive-behavioral approaches are promising [R5].

Implementation intentions — statements of the form “if situation Y arises, I do action X” — have their own body of evidence. A meta-analysis of 94 independent tests found a positive effect on goal attainment [R6]. In the system they are used not as a universal answer to every motivation problem but as one means of tying an intention to a specific situation.

---

## 3. Design principles

The system is built around a few principles that take priority over individual techniques.

### Externalize what must be remembered

What needs to be remembered for reliable execution should be kept outside your head. This is a direct extension of GTD.

### Separate direction, mechanisms and execution

Identity, Area of Focus and Objective describe direction and responsibility. Project and Behavior System describe mechanisms of influence. A `Task` is a unit of execution, and `Task Status` describes its current workflow state. Mixing these classes creates confusion: a metric turns into a task, a Project into a goal, and a Habit into an endless recurring reminder.

### Outcomes are not interventions

A Key Result shows whether reality has changed. A Project or a Behavior System is only an attempt to influence it. A successfully completed Project can leave the Key Result unchanged; this difference is what makes learning possible.

### Maintenance is different from improvement

Keeping an Area of Focus in a healthy state is not the same as actively transforming it. Maintenance is therefore handled mainly through its `Standard` and Behavior Systems, while Objectives are used for meaningful changes.

### Capture broadly; expose selectively

A reliable system can hold a large backlog. The execution interface must not show all of it. The visible amount of work is a separate management decision.

### Progressive elaboration

The further the work is from execution, the fewer details need to be defined. A plan should resolve the uncertainty at hand, not simulate the future down to the last step.

### Preserve autonomy

A good plan reduces unnecessary uncertainty but does not remove meaningful choice. This matters most where an overly detailed day itself becomes a source of resistance.

### Feedback moves upward

The lower Levels do not merely carry out the decisions of the upper ones. Real results can call into question a Project, an Objective, the distribution of attention among Areas of Focus or even an Identity assumption.

### Higher Levels change slower

Tasks and their statuses can change in the course of a day. Projects change regularly. Objectives change more cautiously. Areas of Focus and Identities have greater inertia. At the same time, information about problems can move up immediately.

### System overhead must justify itself

No tag, metric, review or template should exist merely because “it is the right thing to do”. If an element does not help make decisions, does not reduce risk and does not support behavior, it should be removed.

---

# Part II. Architecture

## 4. The five Levels

A Level in this system means neither importance nor a time horizon as such. It means a **type of managed object**.

```text
L4  IDENTITIES & PRINCIPLES
        ↓
L3  AREAS OF FOCUS
        ↓
L2  OBJECTIVES & KEY RESULTS
        ↓
L1  CHANGE MECHANISMS
    PROJECTS + BEHAVIOR SYSTEMS
        ↓
L0  TASKS
        ↓
     REALITY
        ↓
     FEEDBACK
```

The arrows show the general movement from the abstract to the actionable, but they do not impose a mandatory parent-child structure. In reality the links are many-to-many. For example, the Area of Focus `Health` can have the Behavior System `strength training three times per week` and the Project `complete annual screening`, even if there is no active Objective.

It is also useful to see the architecture through three functional zones:

```text
DIRECTION
Identities → Areas of Focus → Objectives & Key Results

CHANGE CONTROL
Projects + Behavior Systems

EXECUTION
Tasks + Task Status
```

This separation is one of the methodology's central decisions, and an original one.


### 4.1. Why Levels, not Horizons

In GTD, `Horizons of Focus` describe different altitudes from which to look at commitments. In this system the word `Level` has a different function: it denotes different **types of managed objects**. A Project and an Area of Focus differ not only in time horizon but also in the logic of their completion, review and connection to execution.

The numbering of the Levels therefore does not mean importance. Level 4 is not “more important” than Level 0. It only shows the movement from more abstract management of direction to concrete execution.

### 4.2. Why there is no separate Vision Level

The system has no separate `Vision` Level. Its typical functions are already covered by two parts of the architecture: long-term orientation is set by `Identities & Principles`, and desired future changes are described through `Objectives & Key Results`.

This does not forbid writing a five- or ten-year narrative about the desired future. Such a text can be a useful reflection exercise. But it is not a mandatory managed object and does not create a separate Level unless it serves a unique operational function.

---

# Part III. Direction

## 5. Level 4 — Identities & Principles

Identity here does not mean an affirmation or a rigid self-definition such as “I am always a disciplined person”. A formulation like that easily turns an accidental failure into a threat to self-esteem.

An Identity is a relatively stable chosen orientation: **how I want to behave in a meaningful part of life and which principles to be guided by**.

For example, `Builder` can mean: creating useful things instead of endless preparation; getting feedback earlier; preferring good-enough quality and iteration to endless polishing. `Investor` can mean: thinking in probabilities, separating the thesis from the emotion, protecting the downside, recording decisions before the outcome is known.

The concept combines two ideas from its sources. From GTD it takes the function of `Purpose & Principles`, the highest criteria for judging decisions. From *Atomic Habits* it takes the link between recurring behavior and self-concept [R3]. At the same time, Identity is not treated as a self-sufficient cause of behavior: the self-definition “I am a person of type X” alone is not enough for the needed behavior to appear automatically.

**Canonical definition:** `Identity` is a relatively stable chosen orientation that describes who the person strives to be, and how, in a meaningful context, together with the principles that govern decisions.

### 5.1. Principles

A Principle is neither a goal nor a rule for every case. It is a decision rule that helps choose among several permissible options.

For example:

```text
Identity: Reliable Professional

Principles:
- Do not hide a risk until the last minute.
- State explicitly what counts as finished.
- Do not promise what I cannot control.
- Match quality to the consequences of a mistake, not to a perfectionist maximum.
```

Principles are especially useful where it is impossible to create a procedure for every situation in advance. They reduce repeated decisions without excessive regimentation.

### 5.2. Identity Charter

An Identity Charter should be short. Its aim is not to describe the whole personality but to record a few orientations that really influence choices.

For each Identity it is enough to have a name, a short summary and a few Principles. If needed, boundaries can be added: what this Identity does not mean. For example, `Builder` does not mean constantly launching new projects; `Healthy Person` does not mean maximizing fitness metrics at the cost of the rest of life.

An Identity needs no score. If you feel the urge to rate yourself at 84% as a “good investor”, the system starts to confuse direction with performance measurement.

---

## 6. Level 3 — Areas of Focus

`Area of Focus` comes from GTD, but in this system it has a clear management role: it describes an ongoing domain of responsibility, its acceptable state through `Standard` and its current mode of attention through `Mode`. It is not just a category for sorting Projects.

An `Area of Focus` is an **ongoing domain of responsibility that has no natural point of completion and whose state matters over time**.

`Health`, `Personal Ventures`, `Job`, `Investments`, `Relationships`, `Finances` and `Home` are examples of Areas of Focus. Unlike a Project, an Area of Focus cannot be “closed”. Unlike an Objective, it does not necessarily call for improvement.

**Canonical definition:** `Area of Focus` is an ongoing domain of responsibility whose state needs to be assessed and maintained periodically but which has no Definition of Done. Its current management mode is set by `Mode`: `Advance`, `Maintain` or `Minimum`. The idea of an acceptable state, `Standard`, is not declared in advance: it emerges during reviews and may still be absent for a new Area of Focus.

### 6.1. Standard

`Standard` is an idea of the acceptable state of an Area of Focus, one that is enough to tell normal maintenance from a state that needs intervention.

It is not drawn up in advance. The system sees the state of an Area of Focus in its records — overdue Tasks, stalled Projects, broken habit streaks — and asks “what does ‘normal’ mean for you here?” when there is something to base the question on. The answer settles into durable memory and is refined from then on rather than written from scratch.

The reason is that a list of acceptable states, drawn up in advance for every life domain, is an exercise in wording and an obstacle to getting started, not a tool.

For `Finances`, a standard like this can mean: regular payments are under control, enough liquidity is available, critical risks are not ignored, documents are organized, and the investment policy is not breached without a conscious decision.

`Standard` is not a checklist for an ideal life. Its function is to make it possible to answer the question:

> **Is this Area of Focus currently healthy enough not to need a separate strategic change?**

If so, no Objective is needed.

### 6.2. Mode: Advance, Maintain, Minimum

An equal distribution of time among all Areas of Focus is not the aim. In real life resources are limited, and several goals can compete with one another. A meta-analysis of research on goal conflict shows that greater conflict between goals is associated with lower psychological well-being and greater distress [R7].

So the system uses not “life balance” but **conscious imbalance**.

The `Mode` property shows the current management mode of an Area of Focus:

- `Advance` means deliberately investing extra resources and allowing for meaningful change.
- `Maintain` means keeping the acceptable state without active expansion.
- `Minimum` means temporarily protecting only the critical minimum, while recognizing the trade-off.

These modes are not moral judgments. `Minimum` for Recreation during the launch period of a venture can be a reasonable temporary decision; `Minimum` for Health over a year can signal a dangerous systemic imbalance.

### 6.3. When an Area of Focus needs an Objective

An Objective arises not because an Area of Focus exists but because there is a gap between its current and desired state that is worth a focused change.

For example:

```text
Area of Focus: Investments
Current state: the portfolio is managed reactively.
Desired change: create a disciplined process for making investment decisions.
→ An Objective makes sense.
```

Another example:

```text
Area of Focus: Home
State: everything functions acceptably.
→ No Objective is needed.
```

This protects the system from turning normal life into an endless set of goals.

---

## 7. Level 2 — Objectives & Key Results

Level 2 is meant for meaningful, deliberate change.

An `Objective` describes a desired direction or state that is important enough to receive concentrated resources for a period of time. `Key Results` set observable signs that this movement is taking place.

**Canonical definition:** `Objective` is a meaningful desired change or direction that justifies the focused use of resources over a defined period.

**Canonical definition:** `Key Result` is observable evidence or a target condition by which progress on, or achievement of, an Objective can be assessed.

The key word here is **evidence**.

### 7.1. A Key Result is not a Project

Suppose:

```text
Objective:
Make a personal SaaS commercially viable.

Key Result:
MRR reaches €5,000.
```

This is not work that can be done directly. It is a property of reality that can be influenced.

Project:

```text
Launch a referral program.
```

is an intervention. It can be completed according to its Definition of Done. But after the launch, MRR may stay the same.

So the following is possible:

```text
Project status: Done
Key Result improved: NO
```

This is not a contradiction. It is useful feedback: the chosen mechanism did not produce the expected effect.

The difference can be summarized like this:

| | Key Result | Project |
|---|---|---|
| Main role | evidence of an outcome | organization of bounded work |
| Can it be “done” directly | mostly no | yes |
| Degree of control | often partial | mostly higher |
| Criterion | target or evidence | Definition of Done |
| Example | retention 45% → 60% | redesign onboarding |

### 7.2. Strategic Objective and feedback cycle

In this system, strategic Objectives can look ahead roughly 12–24 months, the horizon of the longer-term GTD goals, into which the system embeds OKR.

This does not mean that feedback must also wait two years. Key Results and mechanisms can be reviewed in shorter cycles. The strategic direction stays relatively stable, while the ways of achieving it change faster.

### 7.3. Leading and lagging evidence

Not all Key Results are equally close to the final outcome.

`Revenue`, `retention`, `net worth` and `VO₂max` can be lagging evidence: they reflect an outcome that follows a combination of causes.

Some Key Results can be closer to leading evidence, but they should not be turned into a list of completed actions. For example, “50% of new users complete the activation flow” is closer to the mechanism than revenue, but it still describes the behavior of the system, not the completion of a specific Project.

If a Key Result is phrased as:

> “launch a website”, “write 20 articles”, “take a course”,

you need to check whether the Key Result is really evidence of the desired change or a hidden Project or output.

Sometimes a Key Result in the form of a milestone is acceptable, but that should be a deliberate decision, not a confusion of types.

### 7.4. Learning Objectives

Not all Objectives need to assume that the right result is already known.

Under high uncertainty a useful Objective can be learning-oriented:

```text
Objective:
Determine whether problem X is valuable enough to build a venture around.

Possible Key Results:
- Enough high-quality customer interviews have been conducted to identify recurring patterns.
- A testable problem thesis has been formulated.
- Real commitments to a prototype test have been obtained.
```

Here success is not “launching a company” but reducing critical uncertainty.

### 7.5. No universal 70% rule

A popular OKR practice often uses roughly 0.7 as normal completion of an aspirational goal. This system has no such general rule.

70% can mean an excellent result for an experimental goal, a serious failure for a compliance requirement and nothing at all for a poorly worded Key Result.

A review must ask not “what is the score?” but:

> Was the target well calibrated? What changed in reality? What did we learn? Do the Objective, the Key Result or the mechanisms need to change?

### 7.6. Goal portfolio

The number of active Objectives is limited not by a neat number but by capacity. If two Objectives claim the same hours, money, attention or cognitive energy, they conflict in practice, no matter how good they look on paper.

This is why the Strategic Review evaluates not only each Objective separately but also the portfolio as a whole.

### 7.7. Goal adjustment during review

An Objective has no separate formal state machine like a Task's or a Project's. During a Strategic Review, what matters is not scores or a `Failed` label but the decision about the course ahead.

The possible review decisions are:

```text
Continue — the direction remains relevant without substantial change
Adapt    — change the wording, scope, Key Results or approach based on evidence
Pause    — temporarily stop actively investing resources
Abandon  — deliberately give up the Objective
Achieved — record that sufficient evidence confirms the achievement
```

`Pause` is not an ending: the Objective can return to active pursuit. `Adapt` also means a revision, not a terminal state. `Achieved` and `Abandon` end the current goal cycle but do not require a symmetric `Failed` status.

The ability to give up goals that are unattainable or no longer relevant and to switch to others is associated with adaptive self-regulation; meta-analytic reviews of goal adjustment show that disengagement and reengagement are linked to indicators of quality of life, although the effects depend on context [R8].

Giving up an Objective is sometimes a good decision, not a defeat.


# Part IV. Level 1 — Change Mechanisms

## 8. Two ways to change reality

Once it is settled what matters and which change is needed, another question arises: **by what means can this change happen?**

At Level 1 the system uses two parallel classes of mechanisms:

```text
CHANGE MECHANISMS

Project
→ bounded work

Behavior System
→ recurring behavior
```

A Project organizes bounded multi-step work. A Behavior System organizes recurring behavior.

They sit at the same Level not because they are identical but because they perform the same architectural function: **they turn direction into a mechanism of influence on reality**.

There is no universal sequence `Habit → Project` or `Project → Habit`. They are siblings, not parent and child.

---

## 9. Projects

A Project is needed when the desired change requires several Tasks and has a defined point of completion.

**Canonical definition:** a `Project` is a bounded multi-action commitment through which a defined deliverable or change is produced, mostly under the direct control of the person doing the work.

Three elements of this definition matter.

`Bounded` means that a Project can end. If a “Project” goes on indefinitely, it is probably an Area of Focus or a Behavior System.

`Multi-action` means that completing it takes a sequence or a set of Tasks, not a single unit of work. “Send an invoice” is usually a Task. “Prepare and file the annual tax return” is usually a Project.

`Defined change/deliverable` means that a Project has an “after” state that can be recognized.

### 9.1. Definition of Done

A Project's name is rarely enough. Naming a Project “Website”, “Investments”, “Career” or “Research” gives no reliable control.

A Project has a short `Definition of Done`: the conditions under which it no longer needs to be kept active. A Definition of Done is needed as a separate record when the boundary of the work does not follow from the name and the makeup of its Tasks; its absence is not a problem in itself.

For example:

```text
Project:
Launch a personal website.

Definition of Done:
- the production version is publicly available;
- the key pages work;
- analytics is installed;
- the mobile layout is checked;
- there are no known critical defects.
```

A Definition of Done is especially important where there is a tendency toward perfectionism. The wording “do it as well as possible” is forbidden as a completion criterion because it creates no finish line.

The quality standard should match the consequences of an error. Code for a financial transaction and an internal presentation should not have the same quality threshold.

### 9.2. A Project is not a complete plan of the future

A Project may have a rough map, milestones, risks and dependencies if that helps. But it is not required to contain a complete list of future Tasks.

`Progressive elaboration` means that Tasks are created as far ahead as reliable control requires. For a predictable Project it is useful to know several future Tasks and dependencies. For uncertain work the current path and the next point, after which new information will appear, are enough.

Excessive detailing spends resources on decisions that may become outdated, creates an illusion of precision and, psychologically, turns the work into a script lived through in advance.

> **A Project is detailed to the level needed for a reliable next move, not to the greatest possible level of detail.**

### 9.3. Project and Tasks

A Project has no separate internal lists for the statuses `Next Action`, `Waiting For` or `Scheduled`. It has linked `Tasks`, and the workflow of each Task is determined by its `status`.

For example:

```text
Project: Launch website

Tasks:
- Finish homepage copy        → Done
- Implement payment flow      → Next Action
- Receive legal approval      → Waiting For
- Production launch           → Scheduled
```

This allows a Project to be seen as one work package, without duplicating GTD categories inside it. Views such as `Next Action` or `Waiting For` are built from the same Tasks by status.

A Project can stay `Active` even if all its Tasks are currently in `Waiting For` or `Scheduled`. Waiting is a property of the current work, not a separate type of Project.

### 9.4. Project Status

A Project has one lifecycle status. The core statuses are deliberately short and describe the state of the commitment itself, not the workflow of individual Tasks:

- `Planning` means that the Project is already accepted as a commitment but still needs enough clarification and design before ordinary execution; planning and clarification Tasks can be done in the meantime.
- `Active` means that the Project belongs to the current work portfolio and can move forward through Tasks.
- `Paused` means that the Project remains a current commitment but its progress is deliberately suspended.
- `Done` means that the Definition of Done is met.
- `Canceled` means that the Project is deliberately closed without meeting its Definition of Done.

`Planning` is not a backlog of future ideas. Potential work becomes a Project only after the decision to take it on as a commitment. A Planning Project may have Tasks with the status `Next Action`, `Scheduled` or `Waiting For` if they are needed for clarification and design. Planning should end when the Project is defined well enough to move on to ordinary execution; a complete or perfect plan is not a condition for moving to `Active`.

Project status and Task status describe different dimensions. A Project can stay `Active` even if all its current Tasks have the status `Waiting For` or `Scheduled`. That is why `Waiting` is not needed as a Project status: the operational view “blocked or waiting projects” can be computed from the linked Tasks.

`Paused` acts as a higher availability constraint. By default the Tasks of a Paused Project stay out of flexible execution views such as Available Now; there is no need to change their own Task statuses in bulk for that. This does not hide real Calendar commitments or deadlines: during a pause they need to be explicitly kept, moved, canceled or re-linked. After `resume` the Project returns to `Active`, and whether its Tasks are still current is checked.

`Done` and `Canceled` are terminal statuses. When a Project moves to a terminal status, all its unfinished Tasks should be settled: those no longer needed become `Canceled`, those already completed become `Done`, those that had a commitment behind them and did not happen become `Failed`, and those that remain needed regardless of the Project are re-linked or left as standalone Tasks. Active Tasks must not stay linked to a closed Project out of sight.

If a Project fails to influence a Key Result, that does not make the Project `Failed`: if the Definition of Done is met, the Project is `Done`, and the strategic outcome is evaluated separately through the Key Result and feedback.

### 9.5. Minimal Project record

For most personal Projects the following is enough:

```text
Name
Supporting Area of Focus
Supporting Key Results — optional
Definition of Done — if the boundary does not follow from the name and the Tasks
Status
Tasks — linked collection/view
Relevant support material — link/reference
```

Tasks are stored as separate Level 0 objects and linked to the Project. This lets a single Task have its own status, dates, dependency and context without duplicating information in the Project record.

If a Project needs a risk register, a roadmap, a budget or complex dependencies, they can be added. But they are not mandatory for all Projects.

## 10. Behavior Systems, Routines and Habits

In everyday speech the word `Habit` often means any regular action. That is not enough for a precise system.

Behavioral science usually links a habit to the idea that repetition in a stable context gradually strengthens the automaticity of a response. A 2024 systematic review and meta-analysis of habit formation showed considerable variability: in some studies the median time was about 59–66 days, mean values could exceed 100 days, and the individual spread was very large [R9]. This makes rules such as “21 days” or “60 days”, or any other universal time frame, unacceptable as an architectural principle.

So the broader concept `Behavior System` is used.

**Canonical definition:** a `Behavior System` is deliberately designed recurring behavior together with the conditions for triggering, performing, maintaining and reviewing it.

A `Routine` is recurring behavior that may still require conscious initiation and control.

A `Habit` is a behavioral state with higher automaticity, in which a familiar context or cue increasingly triggers the action without a separate conscious decision. It is a characteristic of how a Behavior System is performed, not its lifecycle status.

This means that a quarterly portfolio review can be a perfectly good Routine yet never become an automatic Habit — and that is fine.

### 10.1. Lifecycle and automaticity — different dimensions

A Behavior System has its own lifecycle:

```text
Designed
↓
Installing
↓
Stabilizing
↓
Maintenance
↓
Retired
```

`Designed` means that the Behavior System has been formulated but is not yet installed. `Installing` means that it is being actively installed. `Stabilizing` means that repetition is already happening but the structure or the conditions still need correction. `Maintenance` means that the system is stable enough and mostly needs periodic oversight. `Retired` means that the Behavior System is no longer needed or is replaced by another mechanism.

`Routine` and `Habit` are not lifecycle statuses. They describe **how the behavior is performed**. A stable Behavior System may remain a deliberately initiated Routine or, over time, gain more automaticity and become Habit-like. That is why lifecycle and automaticity should not be stored in one field.

### 10.2. Behavior System structure

A full record may contain:

```text
Behavior
Supports — Identity, Area of Focus, Key Result or Project
Cue
Context
Frequency / cadence
Minimum version
Target version
Environment design
Success rule
Recovery rule
Lifecycle state
Automaticity / form — if useful
```

Not every field is always needed. They exist as diagnostic levers.

`Lifecycle` is a state with a closed set of values, not prose. `Supports` links the behavior to the objects it serves. `Cue` and `Context` are different dimensions: the first triggers the behavior, the second describes the conditions in which it is available. The record of completions is derived from Task instances ([Behavior System and Tasks](#109-behavior-system-and-tasks)).

For example, take a Behavior System “Deliberate technical practice” in the `Installing` state. It supports the Area of Focus “Personal Development” and the Key Result “Three production incidents resolved without escalation”. The cue comes after morning coffee on weekdays. The minimum version is to open the current material and work for five minutes; the target version is forty-five minutes of practice. For the environment, the material is prepared in the evening and notifications are off. The success rule is four meaningful sessions in an ordinary working week; the recovery rule is not to “catch up” after a miss but to return at the next available cue.

### 10.3. Four Laws as design heuristics

The *Atomic Habits* model is useful in redesign:

`Make it obvious` → make the cue obvious or stable.

`Make it attractive` → reduce emotional aversion, add a meaningful immediate reward or link the action to a valued Identity.

`Make it easy` → reduce friction, prepare the environment, lower the starting threshold.

`Make it satisfying` → create immediate feedback or reinforcement.

For unwanted behavior the logic can be inverted.

But diagnosis should not end with the phrase “the third law is violated”. The real mechanism needs to be found: an unstable cue, an aversive task, a reward that is too delayed, physical fatigue, a conflict of goals, a lack of skill and so on.

### 10.4. Minimum version

The minimum version is not a quality norm. It is the **minimum entry threshold** that keeps the behavioral link intact on an unfavorable day.

For training the target may be 60 minutes, and the minimum is to go to the gym and do a short basic session. For writing the target is 45 minutes, and the minimum is to open the document and write a paragraph.

The minimum is useful if it lowers the friction of starting, but it should not become a way of simulating progress for years. If the person constantly does only the minimum, what is needed is a redesign, not praise for a streak.

### 10.5. Implementation intentions

When the problem lies in the transition from intention to action, a Behavior System may contain an implementation intention:

```text
If [relevant situation],
then I will [specific behavior].
```

For example:

> If I have finished my morning coffee on a working day, I open the current learning material before I open my messaging apps.

This does not mean that every Habit needs a formal if-then sentence. The technique is applied where the cue-action binding solves the problem.

### 10.6. Environment design

Behavior depends not only on “willpower”. The environment determines the availability of cues, friction and default choices.

So when installing a Behavior System, one needs to ask not only:

> How do I make myself do it?

but also:

> What conditions make the needed action the simplest logical answer?

A prepared work area, blocked notifications, workout clothes packed in advance or a document that opens automatically are often more useful than an additional reminder.

### 10.7. Tracking

Tracking makes sense if the information changes decisions or helps the stabilizing phase.

A meta-analysis of experimental studies on progress monitoring showed that interventions that increased progress monitoring improved goal attainment on average; the effects were larger when progress was physically recorded or reported [R10].

But it does not follow that every Habit has to be checked off for life.

What is worth simplifying is not the record of a repetition but the effort of confirming it. The instance remains the carrier of the fact; manual confirmation where it changes no decisions is unnecessary.

### 10.8. No universal consistency threshold

A rule such as “70% is enough” is too crude.

The success rule is determined by the function of the Behavior System.

For strength training it might be 3 sessions/week, with 2 as the minimum acceptable. For daily intake of critically important medication the requirements are entirely different. For optional creative exploration 60–70% may be more than enough.

The metric should follow from the purpose of the behavior, not from productivity folklore.

### 10.9. Behavior System and Tasks

A Behavior System instantiates Tasks at Level 0: each repetition exists as an instance, and the counters of completions, failed instances and streaks are derived from these instances.

```text
Behavior System:
Weekly portfolio review

Task:
Review the allocation and the decision log
Status: Scheduled
Date: Friday 16:00
```

Another Behavior System may create a Task with the status `Next Action` if the behavior is available in a particular context but is not tied to a specific time.

**A Behavior System is the definition of a behavior; a Task is a single execution of it.** Each repetition exists as an instance: it is the instances that are aggregated into the counters of completions, failed instances and streaks.

So the absence of instances does not mean that the behavior has become automatic. It means that no repetitions are recorded — and that is indistinguishable from an abandoned Behavior System.

# Part V. Level 0 — Execution

## 11. Tasks

All the higher Levels are models of direction or control. Level 0 contains the concrete units of work that the system tracks in the real world.

**Canonical definition:** a `Task` is the smallest trackable unit of Level 0, which represents concrete work, an expected result or a potential future action and has one current workflow status.

A Task may belong to a Project, be created by a Behavior System, or arise directly from the maintenance of a particular Area of Focus, an incoming request or a one-time commitment. The link to a Project is not mandatory.

A Task and its status are different concepts. The Task answers the question **“what is being tracked?”** The status answers **“what is the current state of this work?”**

### 11.1. Task Status

The core workflow uses seven statuses:

| Status | Means |
|---|---|
| `Next Action` | At the level of the Task itself there is no unresolved prerequisite event; actual availability may also depend on the Project Status and the current context. |
| `Scheduled` | The Task is deliberately tied to a future point in time or period and must not be a generally available action until then. |
| `Waiting For` | The progress or completion of the Task currently depends on an external person, system, event or dependency. |
| `Someday/Maybe` | The Task is stored as a potential future action but is not an active commitment at the moment. |
| `Done` | The work the Task describes is completed. |
| `Canceled` | The Task no longer needs to be done or tracked as an active commitment. |
| `Failed` | The commitment stood, but the attempt did not happen or did not finish. |

These statuses form one workflow over a single entity. In a practical interface `Next Action`, `Waiting For`, `Scheduled` and `Someday/Maybe` are views over the Tasks database, not separate data containers.

Task Status describes the **local workflow of the Task itself**. If a Task belongs to a Project, the Project's lifecycle can additionally limit its actual availability: Tasks of `Planning` and `Active` Projects can appear in execution views, whereas a `Paused` Project suppresses them by default. Whether a Task is in fact available to work on therefore depends not only on Task Status but also on the state of the linked Project and on the real constraints of context and time.

The workflow is not a linear state machine: a Task can move between `Next Action`, `Scheduled`, `Waiting For` and `Someday/Maybe` when the reason for its availability changes. `Done`, `Canceled` and `Failed` are terminal statuses.

### 11.2. Next Action as a status

`Next Action` comes from GTD, but in this architecture it is not a separate object type. It is a Task status.

**Canonical definition:** `Next Action` is a Task status meaning that at the level of the Task itself there is no unresolved prerequisite event: the work is concrete enough and can be started without a further decision about what the action consists of. If a Task belongs to a Project, its actual availability also depends on the Project Status.

For example:

```text
Task: Export the current portfolio allocation from the broker account
Status: Next Action
```

The wording “work on investment strategy” is usually not yet a concrete enough Task for the status `Next Action`. It needs Clarify.

The notion of concreteness should not be taken to the point of absurdity. If the person already understands how to start, decomposing the Task into “open the browser → enter the URL → press Enter” only creates noise.

> **Clarify until action ambiguity is removed, then stop.**

### 11.3. Scheduled

`Scheduled` means that the reason a Task is not in the general `Next Action` view is time or a future context.

For example:

```text
Task: Hold the quarterly portfolio review
Status: Scheduled
Date: Friday 16:00
```

`Scheduled` is not a synonym for any date. A Task can be `Next Action` and have a `Deadline` at the same time if it can already be worked on but must be finished no later than a certain time.

```text
Task: File the tax return
Status: Next Action
Deadline: March 31
```

Thus `status` describes the workflow, while the time fields describe constraints.

### 11.4. Waiting For

`Waiting For` is used when the current work depends on an external event or dependency.

```text
Task: Receive the signed contract from Legal
Status: Waiting For
Waiting for: Legal
Date: Friday
```

A `Date` on a `Waiting For` Task means the time to check the dependency and does not change the status of the Task itself. If a message to Legal needs to be written on Friday, that can be a separate Task:

```text
Task: Write to Legal about the contract
Status: Next Action
```

and the original Task stays `Waiting For` until the expected result is received or the commitment changes.

The same logic applies to dependencies inside a Project. A future Task that cannot move forward until another Task is finished can be `Waiting For`, with a reference to the dependency.

### 11.5. Someday/Maybe

`Someday/Maybe` means that the opportunity is stored but not yet accepted as an active commitment.

```text
Task: Look into a Japanese language course
Status: Someday/Maybe
```

Someday/Maybe Tasks should not routinely appear in the execution interface. Their value is that the idea does not have to be kept in memory and there is no need to pretend that it is already a commitment.

If an opportunity may become a multi-step Project but the commitment has not yet been accepted, there is no need to create a `Planning` Project. A Someday/Maybe Task worded as a future action or a decision trigger is enough, for example `Assess whether it is worth launching a podcast`. A Project appears only after the decision to take on the work.

### 11.6. Done and Canceled

`Done` means that the work the Task describes has been completed. It does not guarantee that the desired external outcome has been achieved.

```text
Task: Call the client
Status: Done
Result: No answer
```

The Task is completed even though the outcome is not the one that was hoped for. If a new action is needed, the relevant Task is created or activated.

`Canceled` means that the Task no longer needs to be done. A `reason` can be stored if needed, but it does not change the core state model.

`Failed` means that the commitment stood, but the attempt did not happen or did not finish. It differs from `Canceled` in what it records: `Canceled` releases the commitment, while `Failed` keeps it and states what was left undone.

An unsuccessful **outcome** is never expressed by a status: a completed Task may fail to change reality, and that difference is what the Key Result measures. A missed deadline is not a status either — it is derived from the date.

`Failed` is set by the person. The difference between “was not needed” and “was needed and did not happen” is a judgment about the commitment that cannot be observed in the data.

Likewise the core model does not need `In Progress`. A started Task can remain `Next Action` until `Done` or until the state changes. An additional execution state is justified only in an implementation where it really creates value.

### 11.7. Task time properties

Status is deliberately separated from time. If needed, a Task can have:

```text
Date      — when the work returns to attention
Deadline  — the latest time by which it must be finished
```

These are two different questions: **when this is mine again** and **by when it has to be ready**. I choose the first myself; the second is usually imposed from outside.

What `Date` means is set by the status:

```text
Scheduled      — when the work becomes relevant and it is time to do it
Waiting For    — when to check the dependency
Someday/Maybe  — when to return to the decision
```

A Task has one status, so these meanings do not coexist. `Deadline` does not depend on the status and coexists with `Date`: a `Scheduled` Task may have its own deadline. Why there are exactly two properties is explained in `contracts/canonical.yaml`, key `task_model.optional_time_fields`.

Not every Task needs these fields. They are added only where time changes decisions.

If a Task has both an external dependency and a date, the status must describe its real current workflow. For example, a Task with an unresolved dependency stays `Waiting For` even if it has a `Deadline`. A separate reminder action must not mask this dependency.

### 11.8. Tasks and Projects

A Project has Tasks, not separate sets of items for the statuses `Next Action`, `Waiting For` or `Scheduled`.

```text
Project: Prepare annual investment strategy

Tasks:
- Export portfolio data       → Done
- Calculate allocation        → Next Action
- Receive tax input           → Waiting For
- Review with adviser         → Scheduled
```

Views can show Tasks by Project, status, context, Area of Focus, Key Result or other useful dimensions. An Objective is not a direct filter: it is two steps away from a Task, through a Key Result. There remains a single underlying object.

`Progressive elaboration` is the basic rule of a Project: it is not required to have all future Tasks created in advance. The known structure needed to keep the next move under control is enough.

### 11.9. Available Now

The full Task database and the set of work the person sees at the time of Engage are different things.

`Available Now` is a small contextual view of the Tasks with the status `Next Action` that are not suppressed by the lifecycle of the linked Project and are in fact available in the current context. The next work is chosen from this view.

It is an adaptation of GTD's Engage for situations where a long list of available actions itself creates procrastination. GTD suggests choosing work according to context, time available, resources and energy [R1]. The system keeps these factors but additionally manages the **visible choice set**.

Available Now can be formed from the current context, available time, energy and cognitive state, strategic importance, constraints and the current WIP.

The context of a Task lives in the slot `task.context_or_constraint` (`contracts/canonical.yaml`, key `field_contract`). No record says whether it suits the person's current situation, so whether a context fits remains a judgment of whoever builds Available Now. `Cue` belongs to the Behavior System and takes no part in Available Now.

There is no universal number of items. If 25 options create paralysis, the view needs to be narrowed. If a wider set does not get in the way, an artificial limit is not needed.

### 11.10. WIP as an adaptive constraint

A WIP limit is useful not as a dogma but as protection against excessive switching and the psychological feeling of “everything at once”.

WIP can be applied to `Planning` and `Active` Projects, to Tasks, or to both levels, but the metric should match the real problem. Tasks in `Waiting For` do not consume the same execution resource as Tasks with the status `Next Action`, although they can still create follow-up load.

# Part VI. The operating loop

## 12. Capture → Clarify → Organize & Align → Engage → Reflect → Adapt

The Levels describe structure. The operating loop describes the movement of information and decisions through the system.

### 12.1. Capture

Capture answers a simple question:

> What currently has my attention and should not depend on memory?

A captured item is not yet a task. It is raw input.

A note such as:

> “Vasyl / contract / maybe problem”

can be a sufficient Capture if it is guaranteed to reach Clarify.

The aim of Capture is to save the trigger quickly, not to classify it correctly at the time it appears.

The number of inboxes should be small and known. An email inbox, a task-manager inbox, physical notes and voice capture are all acceptable if the review process really covers them.

### 12.2. Clarify

Clarify turns raw input into a decision.

Clarify uses the basic GTD logic, while actionable work in this system is represented through a single entity, `Task`:

```text
What is it?
Does it need action?

No:
→ Trash
→ Reference
→ Task with status Someday/Maybe, if it is a potential future action

Yes:
→ Task + the matching status, if it is one trackable unit of work
→ Project + the Tasks known so far, if bounded multi-action work is needed
→ Behavior System, if recurring behavior is needed
```

A Task's status follows from current reality:

```text
can be done right away              → Next Action
deliberately tied to the future     → Scheduled
depends on an external event        → Waiting For
is not a current commitment         → Someday/Maybe
```

Delegation does not need a separate type of record: work whose result is expected from another person is tracked as a Task with the status `Waiting For` and, if needed, a `Date` as the time of the check.

Clarify also asks **what type of managed object this is** if the raw input goes beyond a single Task. A new recurring behavior may become a Behavior System. A recurring concern about a life domain may call for clarifying the `Standard` or creating an Objective. A large desired change may turn out to be not a Project but an Objective.

Clarify does not mean building the whole hierarchy from Identity down to Task. Its aim is to reach a decision that is enough for reliable control.

### 12.3. Organize & Align

`Organize` comes from GTD: the result of clarification is placed in the appropriate trusted location.

`Align` checks whether a decision is consistent with the higher context and does not create a hidden resource conflict. It is a separate function of the system, alongside the GTD function `Organize`.

Alignment is not needed for every small action. Buying batteries does not require a link to Identity.

For a large Project the questions might be:

> Which Area of Focus does it support? Which Key Result should it move? Is it worth the current capacity? Which Project will have to be postponed if this one becomes Active?

That way alignment works as resource allocation, not as a tagging exercise.

### 12.4. Engage

Engage is the time of choice and execution.

A bad system tries to decide the whole of Engage in advance: it plans every hour in detail and leaves the person only the role of the one doing the work.

Our system separates **hard commitments** from **choice**.

At the time of Engage the following are used:

- the Calendar as the hard landscape;
- Available Now;
- constraints of time and context;
- cognitive and physical state;
- current importance;
- WIP;
- judgment.

Judgment is not a flaw of the system. It is impossible, and undesirable, to reduce every human situation to an algorithm.

### 12.5. Reflect

Reflect brings the system back up to date.

Without review a trusted system gradually stops being trusted: Projects lose their current Task structure, `Waiting For` Tasks are forgotten, `Scheduled` commitments stop matching reality, Behavior Systems continue to exist after they have lost their purpose, and Areas of Focus degrade unnoticed.

Progress monitoring has empirical support as a component of self-regulation [R10], but a review should be sufficient, not maximal.

### 12.6. Adapt

`Adapt` is a separate step of the operating loop, responsible for correcting the system itself or the course based on feedback.

Reflect answers:

> What is happening?

Adapt answers:

> What needs to change now in the system itself or in the course?

Possible adaptations:

```text
change Task or Task Status — including `Failed`, when the attempt did not happen
redefine Project
redesign Behavior System
replace intervention
recalibrate Key Result
pause Objective
change Mode of an Area of Focus
revise Principle
remove unnecessary process
```

Without Adapt a productivity system can become a very effective mechanism for repeating wrong decisions.

---

## 13. Classification Engine

When it is unclear what to create, the question to use is the one about the nature of the object, not the wish to find the “right template”.

| Question | Object |
|---|---|
| Who do I choose to be, and how? | Identity / Principle |
| What should stay under ongoing responsibility? | Area of Focus |
| What should change substantially? | Objective |
| What observable evidence will show the change? | Key Result |
| What bounded multi-step work can affect reality? | Project |
| What recurring behavior is needed? | Behavior System |
| What is the smallest concrete unit of work that needs tracking? | Task |

After a Task is created, its current status is determined separately:

```text
Can act now?            → Next Action
Future time/context?    → Scheduled
External dependency?    → Waiting For
Not committed now?      → Someday/Maybe
Completed?              → Done
No longer needed?       → Canceled
```

`Failed` is not part of this branch: the person sets it retrospectively, not at the time of classification ([Done and Canceled](#116-done-and-canceled)).

If the wording fits two Levels at once, that is a signal to clarify its function.

For example, “read investment reports” can be a Behavior System if it is a recurring practice; a Project if it is a specific bounded research cycle; or a Task if a specific report needs to be worked through. If that Task can be done right away, its status will be `Next Action`.

A behavior's name alone does not determine its type. The role in the system determines the type, while the status is the current workflow of that particular Task.

# Part VII. Supporting Structures

## 14. Components that are not Levels

Not everything in the system has to be a Level. Some elements are stores, views, time constraints or support material.

### Inbox

The `Inbox` is a temporary place for unprocessed inputs. Its value lies not in organization but in the fact that Capture can be fast.

The Inbox must not become a permanent task list. If an item sits there for a long time without a decision, the problem is not in Capture but in Clarify or Review.

### Calendar

The Calendar holds the hard landscape: events, appointments, real time-specific commitments and Tasks for which a specific time is truly a constraint.

The Calendar is not a complete database of Tasks. `Scheduled` as a Task status is broader than the Calendar: a Task can be scheduled for a future day or context without having to block a specific time in the calendar.

### Task Views

`Next Action`, `Scheduled`, `Waiting For` and `Someday/Maybe` are views over the single Task database.

```text
Next Action view    → status = Next Action
Scheduled view      → status = Scheduled
Waiting For view    → status = Waiting For
Someday/Maybe view  → status = Someday/Maybe
```

The Project view filters the same Tasks by `project`. The Area of Focus view filters them by `area_of_focus`. Available Now further narrows the `Next Action` Tasks to the work that is relevant to the current context.

This approach separates **data** from **presentation**: a single Task does not have to be moved between different physical lists or duplicated when its status changes.

### Reference

Information that requires no action must not live in the Task database as active work.

A Reference system can be simple or complex, depending on the work. Its job is retrieval, not accumulation.

### Checklists

A checklist is reusable support for recurring complex work or for quality control.

A checklist is not a Behavior System and is not a set of Tasks by default. For example, the `Weekly Control Review` can be a Routine; the checklist describes the checks, and Tasks are created only when a review produces specific work that needs to be tracked.

### Project Support

Notes, documents, research, designs and drafts linked to a Project are stored as support material, not as Tasks, unless they themselves need to be done.

### Metrics and Logs

Metrics and logs exist only when they help to assess the state or to make a decision.

> **Rule:** if a metric does not change a decision, does not explain a risk and does not help learning, it does not need to be measured merely because measuring it is possible.

## 15. Calendar, time and autonomy

Organizing time is where a productivity system most often becomes excessively rigid. The Task model therefore deliberately separates workflow status, dates and the Calendar. A meta-analysis of time-management research finds moderate associations with performance and well-being, but gives no grounds to think that more detailed calendar planning is always better in itself [R12].

### 15.1. Hard landscape

The Calendar is used for what is genuinely time-shaped: a meeting, an appointment, a flight, a hard event, a particular time-specific commitment or a protected time block.

```text
10:00 — call with client
15:30 — dentist
18:00 — deadline: submit application
```

A Task with the status `Scheduled` can appear in the Calendar if a specific time matters for it. If it is merely deferred to a certain day or to a future context, the `Scheduled` view in the task system is enough.

### 15.2. A Date is not a Deadline

`Date` answers the question **when this work must become relevant or be done**. `Deadline` answers the question **by when it needs to be finished**.

For example:

```text
Task: File the tax return
Status: Next Action
Deadline: March 31
```

Here the work can be done right away. Having a deadline does not make it `Scheduled`.

On a `Waiting For` Task, `Date` means the time when attention returns to the dependency, not a reason to change the Task's status.

### 15.3. Time blocks protect capacity

Time blocking is useful when a block reserves a resource:

```text
09:30–11:30 — Deep Work
```

but the specific Task inside the block can be chosen from Available Now when the block starts, or the day before. This way **capacity** is planned, not necessarily the whole scenario.

### 15.4. Daily plan as a skeleton

A good daily plan must fit real constraints and at the same time leave room for judgment.

The minimal structure of a day can include:

```text
Hard landscape / Scheduled commitments
1 primary anchor — if useful
A short Available Now list
Necessary maintenance/admin
Buffer / open capacity
```

`Primary anchor` is not a magical “MIT” that there must always be one of. It is a way to keep small reactive work from crowding out one important thing. On some days there is no anchor, because meetings, recovery or crisis work define the whole day.

### 15.5. Planning must not crowd out life

If merely knowing the exact sequence of Tasks creates a feeling that the day has already been lived, the system must reduce the resolution of the plan.

Instead of a sequence of ten Tasks, there is one work block and a small Available Now. Instead of choosing everything in the morning, there are defined constraints and the right to choose a specific `Next Action` Task at the time of Engage.

> **Principle:** a good plan reduces unnecessary uncertainty but does not eliminate meaningful choice.

# Part VIII. Self-Regulation and CBT

## 16. Diagnosis first, then intervention

When work does not get done, productivity systems often draw a premature conclusion: “more discipline is needed”.

In this system, work that does not get done is classified first. A Task with the status `Failed` is itself the record of such a case — the commitment stood and the attempt did not happen — so diagnosis starts not from nothing but from the evidence at hand.

Possible causes:

```text
action unclear
task too large
too many visible choices
resource conflict
low actual value
perfectionistic standard
fear of failure / evaluation
aversive emotion
low energy / recovery deficit
environmental friction
missing skill
wrong Project
wrong Objective
```

The same outward behavior — for example, putting off a report — can call for completely different solutions.

If the action is unclear, Clarify is needed.

If the work package is too large, a Project redesign is needed.

If there are ten competing options, the visible choice set needs to be reduced.

If the problem is “I cannot start because the result has to be perfect”, task management is no longer a complete answer. This is where CBT and self-regulation come in.

---

## 17. Perfectionism

In the context of this system, perfectionism matters not as a character trait but as a mechanism that distorts standards, risk assessment and the completion of work.

A typical cycle:

```text
High / vague standard
↓
fear of insufficient result
↓
over-analysis or avoidance
↓
delayed execution
↓
time pressure / guilt
↓
more evidence for "I must do better next time"
```

### 17.1. Operational standard instead of “do it perfectly”

A Project needs a Definition of Done. An important Task needs an acceptable quality criterion that is sufficient for its real purpose.

The question:

> What must be true for the work to be honestly considered complete enough for its real purpose?

This is better than the question:

> How can I do this as well as possible?

### 17.2. Thought model

A simple CBT structure is used for psychological analysis:

```text
Situation
↓
Automatic thought / interpretation
↓
Emotion + body response
↓
Urge / behavior
↓
Short-term consequence
↓
Long-term consequence
```

For example:

```text
Situation:
A draft needs to be sent to the client.

Thought:
"If there is a weak spot in it, he will decide that I am incompetent."

Emotion:
Anxiety.

Behavior:
Another two hours of polishing / not sending it.

Short-term:
Temporary relief.

Long-term:
Delayed feedback, more stress, reinforcement of avoidance.
```

Next the thought is checked: what the evidence is, how probable it is, what alternative explanation there is, what the real cost of a mistake is, which standard fits the context.

### 17.3. Behavioral experiments

Verbal persuasion does not always change a belief. That is why a behavioral experiment matters.

For example:

> Prediction: if I send the draft at a “good enough” level, the stakeholder will evaluate my competence negatively.

Experiment:

> Define the minimum professional quality, send the draft without an extra hour of polishing, record the actual reaction.

The goal is not to do poor work on purpose. The goal is to check whether the inflated standard is really needed.

CBT for perfectionism has empirical support: a meta-analysis of 15 randomized controlled trials found medium and large effects on several dimensions of perfectionism, although the number of studies and of active comparison conditions was limited [R4].

---

## 18. Procrastination

Procrastination is not a synonym for a bad calendar. It often contains a component of short-term mood repair: avoiding the task temporarily eases an unpleasant state, even if it worsens the long-term result.

For practical purposes, it is enough to tell four typical situations apart.

### Structural procrastination

The cause is task architecture: an unclear next step, a scope that is too large, too many options, missing prerequisite information.

The solution is Clarify, Task or Project redesign, Available Now and WIP reduction.

### Perfectionistic procrastination

The cause is an inflated or vague standard and fear of evaluation.

The solution is a Definition of Done, a quality threshold, thought examination and a behavioral experiment.

### Emotional avoidance

The cause is an unpleasant state associated with the task: boredom, shame, uncertainty, fear.

The solution can include a short graded start, behavioral activation, acceptance of discomfort and a redesign of the environment. The goal is not to wait until the emotion goes away but to learn to act with tolerable discomfort.

### Value conflict

Sometimes procrastination is data showing that the Task or Project does not deserve resources.

The question:

> If it were not for guilt and sunk cost, would I still deliberately choose this work?

If not, the decision depends on the type of object: an unneeded Task goes to `Canceled`; one that is needed but not done goes to `Failed`; delegated work goes to `Waiting For`; a Project can become `Paused` or `Canceled`; an Objective can be adapted, paused or abandoned. This is better than adding yet another anti-procrastination trick to work that is no longer worth doing.

A meta-analysis of intervention studies showed that procrastination is amenable to change, and that CBT-oriented interventions had stronger results among the approaches studied, although the evidence base was relatively small [R5].

---

## 19. Motivation, autonomy and boredom

Motivation is not treated as fuel that has to be constantly “topped off”. It is often more productive to change the structure of choice, the environment, the task size or the quality standard.

However, the system must take autonomy into account. If the person perceives a plan as an external order from their own past self, even interesting work can become psychologically controlled.

That is why planning must not decide for the future person more than is necessary.

Practical ways to preserve autonomy:

- plan blocks, not always a sequence;
- keep an Available Now drawn from the available `Next Action` Tasks instead of a single scripted path;
- build in a choice between several equally useful actions;
- leave a buffer;
- avoid filling the task manager with automatic actions that happen anyway;
- allow renegotiation during Review.

Novelty or a change of context can be used if boredom gets in the way, but the system must not turn into a gamification machine. Interest is a useful factor; entertainment is not a requirement for every piece of work.

---

# Part IX. Feedback and Reviews

## 20. Why different review frequencies are needed

The Levels do not all need the same frequency of attention.

If Identities are reviewed every day, the system will create excessive self-analysis. If Projects are reviewed once a year, the system will lose control.

The pace of review therefore roughly matches the rate at which the objects change:

```text
Tasks / statuses        fast
Projects                fast/moderate
Behavior Systems        moderate
Objectives/Key Results  moderate/slow
Areas of Focus          slow
Identities              very slow
```

This is not a strict calendar. It is a principle of inertia.

---

## 21. Daily Control

Daily Control should be short and should not turn into a morning strategy meeting.

Its functions:

- see the Calendar (the hard landscape) and the current `Scheduled` commitments;
- make sure that critical commitments are not hidden;
- determine the primary anchor, if one is needed;
- form a small Available Now from `Next Action` Tasks;
- leave a realistic buffer;
- quickly Capture anything new during the day.

In the evening there can be a short reset: record the unfinished loops, check tomorrow's hard landscape and adjust the status of those Tasks where the day decided something — `Canceled` if the work is no longer needed, `Failed` if it was needed and did not happen.

There is no requirement to replan the whole backlog every evening.

---

## 22. Weekly Control Review

The Weekly Control Review is the central maintenance process of the system. It rests on the GTD logic of regular review and covers how current the Tasks, Projects, Behavior Systems, Areas of Focus and relevant Key Results are.

Its goal is to restore trust in the system.

A typical sequence:

1. clear the main Inboxes;
2. review the Calendar backward and forward as far as is useful;
3. review the `Waiting For` Tasks and the follow-ups that are needed;
4. review the upcoming `Scheduled` Tasks and the real time constraints;
5. go through the `Planning` and `Active` Projects, check readiness and the current Task path; make sure the `Paused` Projects stay paused deliberately;
6. review the Behavior Systems that are being installed or are producing friction;
7. briefly scan the Areas of Focus for signs of neglect;
8. check the active Key Results only to the extent that new data has appeared;
9. renegotiate stale commitments according to the type of object: Task status, Project lifecycle or Objective review decision;
10. form a rough focus for the next week.

The Weekly Control Review does not necessarily have to take an hour. If the system is small, 20 minutes is enough. If the portfolio is complex, more may be needed.

A good criterion is not “I completed the checklist” but this:

> **I trust again that the system reflects my active commitments and risks accurately enough.**

---

## 23. Strategic Review

The Strategic Review works mainly with the Level 2 and Level 1 portfolio.

The questions:

> Do the Objectives remain relevant?  
> What do the Key Results show?  
> Which interventions really work?  
> Which Projects consume resources without a result?  
> Which Behavior Systems create meaningful leverage?  
> Where is there a resource conflict?  
> Which Areas of Focus are temporarily moving between Advance, Maintain and Minimum?

The cycle can be monthly, quarterly or something else, depending on the domain. There is no need to copy the corporate quarter if the natural feedback cycle is different.

---

## 24. Deep Review

The Deep Review happens much less often.

It asks questions that do not need to be settled every week:

> Do my Identities still describe the orientation I want?  
> Do the Principles really help in making decisions?  
> Does the set of Areas of Focus match my life?  
> Is the long-term allocation of resources consistent with what I consider important?  
> Hasn't the methodology itself become too complex?

A Deep Review can be tied to significant life changes rather than to a fixed calendar.

---

# Part X. Integrity and protection from the system itself

## 25. Anti-Bureaucracy Rules

These rules have a higher priority than the wish to “set the system up properly”.

1. **Do not create an object if it neither changes a decision nor preserves useful control.**
2. **Do not require every lower object to be linked to every higher Level.**
3. **Do not measure what does not affect a decision.**
4. **Do not require manual confirmation where it does not change decisions.**
5. **Do not spell out future work in more detail than the next reliable move needs.**
6. **Do not create Objectives for ordinary maintenance.**
7. **Do not confuse a completed intervention with an achieved result.**
8. **Do not treat a deviation from the plan as a moral failure.**
9. **Do not optimize the system when optimization is a way of avoiding real work.**
10. **If the maintenance cost of the system exceeds its decision value, simplify.**

---

## 26. Typical failure modes

### Everything becomes an OKR

Symptom: every Area of Focus has several Objectives and Key Results, and no way of saying whether they have moved.

Consequence: life turns into a performance dashboard.

Correction: put maintenance back under the `Mode` of the relevant Areas of Focus, and clarify the expectations for their state at the next review. Keep OKR only for meaningful change.

### Projects without endings

Symptom: “Marketing”, “Health” and “Investing” sit in Projects for years.

Correction: determine whether it is an Area of Focus, a Behavior System or a genuine bounded Project; add a Definition of Done.

### Key Results as task lists

Symptom:

```text
Key Result 1: create website
Key Result 2: publish article
Key Result 3: call 20 customers
```

Correction: check whether these items are evidence, or interventions or outputs.

### Habit tracker as second job

Symptom: dozens of daily manual checkmarks and guilt over a streak.

Correction: the burden lies in the confirmation, not in the record. The instance of the repetition stays; what is removed is the requirement to confirm it manually where that does not change decisions.

### Overplanning

Symptom: the coming day is known down to 15–30-minute slots, and the structure itself provokes resistance.

Correction: go back to hard landscape + blocks + Available Now + buffer.

### Huge Next Action view

Symptom: the `Next Action` view shows almost the whole Task database and itself becomes a source of paralysis.

Correction: separate the Task database from the execution views; use `Scheduled`, `Waiting For` and `Someday/Maybe` correctly; reduce Available Now to a relevant visible choice set.

### Permanent optimization

Symptom: new tags, dashboards, workflows and templates appear more often than meaningful Projects are completed.

Correction: forbid structural changes until the next Review unless there is a real failure signal.

### Identity rigidity

Symptom: “if I did not do the workout, I am not an athlete” or “a real entrepreneur has to...”.

Correction: the Identity returns to orientation + principles, not a verdict on self-worth.

### Goal persistence after evidence changes

Symptom: an Objective continues because of sunk cost.

Correction: allow Adapt, Pause or Abandon. Meta-analytic reviews of goal adjustment emphasize that disengagement, reengagement and flexibility have different adaptive functions, although the evidence is heterogeneous [R11].

---

Starting the system — the implementation spiral, top-down and bottom-up alignment — is in [`docs/appendix/examples.md`](appendix/examples.md#starting-the-system).

# Part XI. Reference

## 27. Canonical Definitions

This document owns the ontology of the system. The meaning of a term is set by its prose definition in the body of the document, next to the logic that produces it:

- `Identity`, `Principle`: [Level 4 — Identities & Principles](#5-level-4--identities--principles);
- `Area of Focus`, `Standard`, `Mode`: [Level 3 — Areas of Focus](#6-level-3--areas-of-focus);
- `Objective`, `Key Result`: [Level 2 — Objectives & Key Results](#7-level-2--objectives--key-results);
- `Project`, `Definition of Done`, `Project Status`: [Projects](#9-projects);
- `Behavior System`, `Behavior System Lifecycle`, `Routine`, `Habit`: [Behavior Systems, Routines and Habits](#10-behavior-systems-routines-and-habits);
- `Task`, `Task Status`, `Next Action`, `Scheduled`, `Waiting For`, `Someday/Maybe`, `Done`, `Canceled`, `Failed`, `Available Now`: [Tasks](#11-tasks);
- `Inbox`: [Inbox](#inbox).

The permitted values of the lists below are set by `contracts/canonical.yaml`; where the text quotes them, the contract prevails if they differ:

- the types of managed objects by Level: `contracts/canonical.yaml`, key `levels`;
- the `Mode` of an Area of Focus: `contracts/canonical.yaml`, key `levels.L3.area_of_focus_properties.mode.values`;
- Project Status: `contracts/canonical.yaml`, keys `project_model.core_statuses` and `project_model.status_semantics`;
- Task Status: `contracts/canonical.yaml`, keys `levels.L0.task_statuses` and `task_model.status_semantics`;
- the time properties of a Task: `contracts/canonical.yaml`, key `task_model.optional_time_fields`;
- Behavior System Lifecycle: `contracts/canonical.yaml`, key `behavior_system_model.lifecycle`;
- Objective review decisions: `contracts/canonical.yaml`, key `objective_review.decisions`;
- the steps of the operating loop: `contracts/canonical.yaml`, key `operating_loop`;
- supporting structures that are not Levels: `contracts/canonical.yaml`, keys `supporting_structures` and `supporting_structure_rules`;
- the machine-readable form of the prose definitions: `contracts/canonical.yaml`, key `definitions`.

---

## 28. Decision Rules

### Area of Focus or Objective?

If an element has no natural point of completion and describes an ongoing responsibility, it is an Area of Focus.

If we want to create a substantially different state and are ready to concentrate resources temporarily, it is an Objective.

```text
"Health" → Area of Focus
"Restore cardiovascular capacity after long inactivity" → Objective
```

### Objective or Project?

If the wording describes a desired change in reality, it is an Objective.

If it describes bounded multi-step work that can be organized and completed, it is a Project.

```text
"Make product activation materially stronger" → Objective
"Redesign onboarding flow" → Project
```

### Key Result or Project?

Ask:

> Is this evidence that the change has happened, or work we do in order to influence it?

```text
"Activation rises from 42% to 60%" → Key Result
"Implement onboarding checklist" → Project
```

### Project or Task?

If one tracked unit of work is enough, it is a Task.

If the Definition of Done needs several Tasks, it is a Project.

```text
"Email signed contract to accountant" → Task
"Complete annual tax filing" → Project
```

After that, the Task gets a status according to current reality.

### Which Project Status?

```text
The commitment is accepted, but the Project still needs enough clarification → Planning
The Project is in the current portfolio and progressing normally             → Active
Progress is deliberately suspended                                           → Paused
The Definition of Done is met                                                → Done
The Project is closed without meeting the Definition of Done                 → Canceled
```

`Planning` can have executable planning Tasks. `Paused` must not hide real Calendar commitments: they need to be renegotiated separately.

### Which Task Status?

```text
No prerequisite/blocker at the Task level               → Next Action
The work is deliberately tied to the future             → Scheduled
An external event / dependency is needed                → Waiting For
Only a potential future action                          → Someday/Maybe
The work is done                                        → Done
The work is no longer needed                            → Canceled
The commitment stood; the attempt did not happen → Failed
```

The person takes the last branch ([Done and Canceled](#116-done-and-canceled)).

`Deadline` does not determine the status. A Task without a task-level blocker remains `Next Action` even if it has a deadline; if it belongs to a `Paused` Project, the Project lifecycle separately suppresses its execution availability.

If a Task is blocked by a dependency, `Waiting For` takes priority as the description of the current workflow; the check can sit in `Date` or be a separate Task.

### Behavior System or Project?

If the mechanism is meant to recur, it is a Behavior System.

If it must produce a bounded result once and finish, it is a Project.

```text
"Review portfolio monthly" → Behavior System
"Consolidate brokerage accounts" → Project
```

### Routine or Habit?

If an action recurs but needs a conscious start, planning or complex reasoning, it is a Routine.

If the context itself increasingly triggers the behavior and the need for a conscious decision shrinks, the behavior acquires Habit-like automaticity.

This is a continuum, not a binary test.

### Scheduled Task or Calendar?

`Scheduled` is a workflow status. The Calendar is a presentation of hard time commitments.

If a Task simply returns to attention on a certain day, a Scheduled view is enough. If it must take place at a specific time, or that time is a real commitment, it also appears in the Calendar.

### Calendar or Available Now?

If the work has a hard time constraint, or capacity is deliberately protected by a time block, it belongs in the Calendar.

If a Task has the status `Next Action` and is simply available to be done, it can be part of Available Now.

---

Minimal object templates: `docs/appendix/templates.md`.

Research & evidence notes (the sources `[R1]`–`[R12]` that the text refers to) and the origin map (borrowed, adapted, original, rejected): `docs/appendix/research.md`.

A compact machine-readable map of the system for another system or an LLM: `contracts/canonical.yaml`.

---

# Conclusion

A personal management system must be at once complete enough to be trusted and light enough that one does not have to “live inside the system”.

GTD gives a strong mechanism for controlling open commitments. OKR adds a language of meaningful change and evidence. *Atomic Habits* gives practical levers for designing recurring behavior. CBT and research on self-regulation help with situations where the problem lies not in the task list but in interpretations, emotions, avoidance or an inflexible standard.

Yet the system is not the sum of these parts.

Its central architectural idea is the separation of **Direction**, **Change Mechanisms** and **Execution**, with Level 0 represented by a single Task model with clear workflow statuses. The central operating idea is a constant movement from Capture to action and back through feedback.

```text
Direction
↓
Mechanisms
↓
Execution
↓
Reality
↓
Feedback
↺
```

That is why the system does not aim to predict the future or to force the person to carry out an old plan. Its job is to maintain a sufficiently accurate model of what matters, what currently needs to change, which mechanisms are in use, what concrete work exists and what workflow state it is in.

The system is at its best not when it holds the most Projects, metrics, Habits or Tasks.

The system works when the person can look at reality without having to remember everything, and can understand what deserves attention, see only the relevant Tasks and choose an available `Next Action` without paralysis. After receiving new information, the person can change a status, a mechanism or a course without destroying the whole structure.

> **The system is not there to make life fully predictable. It is there to preserve control where control is useful, and freedom where it is needed.**
