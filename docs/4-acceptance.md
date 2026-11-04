# Personal Management System — acceptance
## Conformance layer: what should happen, where it comes from, how it is checked

---

## Document contract

This file is the **conformance layer**. It is the source of truth for almost nothing.

Each row has four parts: an observable claim, a reference to the document where the claim is defined, the path to the test that checks it and a status. If a claim here diverges from its `Source`, the error is in this file.

**Three exceptions, where this document itself is the source.** They have no `Source` column: there is nobody to refer to, and giving up authority would leave them authoritative nowhere.

| What | Why here |
|---|---|
| Production readiness criteria — `SCEN-64-xx` | readiness is the subject of acceptance by definition. No other document says when the system may be turned on: `2-system` describes the mechanism, `3-policy` the behavior, `5-plan` the order of work |
| Sequences of end-to-end scenarios — `SCEN-21-x` | the order of the steps is itself the contract. Splitting it across the owning documents means losing the very thing that is checked — that the steps happen **in this order** |
| The **selection** of required scenarios — `SCEN-19-xx` | only the selection, not the content: each row below names the document where its behavior is defined. The decision on which set of scenarios is required belongs to acceptance, because nothing else could own it |

All three exceptions remain conformance content: they describe **what should happen** and introduce neither mechanisms nor policies. A claim about a mechanism inside them is subordinate to its owner — a divergence is corrected here.

**The document's voice.** Every row is written in the form “what should happen” — as an observable fact about the system. Never in the form “Claude must…”. This file neither quotes the Skill nor refers to it. The Skill is a prompt; prompts are tuned against evals. If an eval reference is derived from the prompt, tuning silently shifts the target and the eval stops meaning anything. This document is the only independent reference, and the ban on mentioning the Skill is what keeps it independent.

**What this document does NOT contain.** The canonical model (see `docs/1-methodology.md`), the architecture and runtime behavior (`docs/2-system.md`), the permission policy and the degradation register (`docs/3-policy.md`), machine invariants (`contracts/invariants.yaml`), the schema (`contracts/canonical.yaml`).

---

## Reference convention

The general form of references, the ban on `§N` between `docs/` documents and the anchor algorithm are in [Reference forms](./README.md#reference-forms). Only what belongs to this file is stated here.

The `Source` column gives an anchor in the target document wherever the claim has its own section.

There is one form: every row that does not belong to this document names the live section that owns it. There are three exceptions, listed in the [Document contract](#document-contract); they have no `Source` column.

The code `Gx` belongs to two different namespaces, and the overlap of numbers is a coincidence. Which namespace applies depends on the section: in [“Production readiness”](#6-production-readiness--scen-64-xx) `Gx` is an item of the [list of sixteen gates](#sixteen-gates); in every other section it is a row of the [degradation register](3-policy.md#degradation-register). The `Source` column does not repeat a reference to the degradation register.

## Test path convention

The path in the `Test` column is where the row's test lives. A file that is not in the tree is a reserved location: the row then defines what must run and is not checked mechanically. The lanes and the naming are the same as in `contracts/invariants.yaml`: the only difference is the prefix of the base name (`scen-` instead of `inv-`), so that both sets live in the same directories and run with the same commands.

| `verifiable_by` | Path | What it is |
|---|---|---|
| `ci-contract` | `app/test/contract/scen-<range>-<nn>.spec.ts`; `app/test/integration/…` if the check needs the App's own database | a deterministic test without the model and without services outside the App's own database |
| `eval` | `app/test/eval/scen-<range>-<nn>.eval.ts` | a behavioral eval over a replay dataset, with the model |
| `integration` | `app/test/integration/scen-<range>-<nn>.spec.ts` | a run against services outside the App's own database — GBrain, Notion, the delivery provider — or a real workspace |
| `manual` | — | a person's judgment; no path is invented; a reference is named instead |

The split into `contract` and `eval` follows the split in docs/3-policy.md#behavior-metrics. The classification `manual` means exactly what it means in the registry: no mechanical check exists, and an invented `.spec.ts` in its place would be a lie.

## Values of the `Status` column

| Value | When it is set |
|---|---|
| `ok` | the claim is fully satisfied; the test is written in its full form |
| `degraded (Gx)` | the claim is satisfied only in a weakened form because of the named degradation; the test checks the weakened form and **must not** assert the full one |
| `blocked` | the row is evaluated only where the external precondition named in parentheses is present |
| `not-implemented` | the measurement is not defined in the source, or the row has no owning milestone |

The status describes how a row is checked, not what a test run showed: the result of a test run is the verdict of a specific build in a specific environment, and the documents do not contain it.

**Rule for marking a degradation.** A row gets `degraded (Gx)` if a canonical field or relation, without which the claim cannot be checked in full, has the representation `page_body`, `gbrain` or `absent` in the register. `native` and `relation` do not cause a degradation. `traversed` causes one if and only if the traversal does not return the needed value, not because of the number of steps alone. Rows that name only statuses, object types or workflow consequences remain `ok`.

---

# 1. Required scenarios — `SCEN-19-xx`

The selection of this set belongs to this document (see the [Document contract](#document-contract)). The content of each row does not: each row names the document where the behavior it checks is defined. The text of the expected behavior is the contract.

| ID | Expected behavior | Source | Test | Status |
|----|---------------------|---------|------|--------|
| SCEN-19-01 | A raw capture “Vasyl / contract / maybe problem” creates or stores an Inbox item; no Task or Project is derived without Clarify | docs/1-methodology.md#121-capture | app/test/contract/scen-19-01.spec.ts | ok |
| SCEN-19-02 | An explicit single-action commitment with an existing equivalent Task does not create a new Task | docs/1-methodology.md#122-clarify | app/test/eval/scen-19-02.eval.ts | ok |
| SCEN-19-03 | An explicit single-action commitment without a Task yields a Task proposal with a canonical status and an approval request if the creation was not a direct command | docs/1-methodology.md#111-task-status | app/test/eval/scen-19-03.eval.ts | ok |
| SCEN-19-04 | A multi-action commitment is classified as a Project, not a large Task; `Planning` or `Active` depends on readiness | docs/1-methodology.md#94-project-status | app/test/eval/scen-19-04.eval.ts | ok |
| SCEN-19-05 | A potential multi-step idea without a commitment is stored as a `Someday/Maybe` Task/decision trigger; no `Planning` Project is created | docs/1-methodology.md#115-somedaymaybe | app/test/eval/scen-19-05.eval.ts | ok |
| SCEN-19-06 | Recurring behavior is classified as a Behavior System; recurring Tasks are created only if they are needed for execution support | docs/1-methodology.md#109-behavior-system-and-tasks | app/test/eval/scen-19-06.eval.ts | ok |
| SCEN-19-07 | A `Deadline` on available work leaves the Task `Next Action`; it does not change the status to `Scheduled` | docs/1-methodology.md#113-scheduled | the test is that of `INV-006` | ok |
| SCEN-19-08 | A future activation without a hard appointment yields a `Scheduled` Task; a Calendar entry is not required | docs/1-methodology.md#113-scheduled | app/test/contract/scen-19-08.spec.ts | ok |
| SCEN-19-09 | An external dependency yields a `Waiting For` Task; `Date` contains the time of the check | docs/1-methodology.md#114-waiting-for | app/test/contract/scen-19-09.spec.ts | degraded (G5) |
| SCEN-19-10 | A `Waiting For` Task with an alternative Project path stays `Waiting For`, but Project-level blockage is not escalated as complete | docs/1-methodology.md#114-waiting-for | app/test/eval/scen-19-10.eval.ts | ok |
| SCEN-19-11 | A critical `Waiting For` Task without an alternative path yields a discussion and follow-through | docs/3-policy.md#dependency-and-task-workflow-integrity | app/test/eval/scen-19-11.eval.ts | ok |
| SCEN-19-12 | An approaching deadline without execution risk does not yield a notification | docs/3-policy.md#deadline-risk | app/test/eval/scen-19-12.eval.ts | ok |
| SCEN-19-13 | A deadline with a critical `Waiting For` dependency yields an actionable intervention | docs/3-policy.md#deadline-risk | app/test/eval/scen-19-13.eval.ts | degraded (G5) |
| SCEN-19-14 | A `Planning` Project with a clarification Task: the Task can be eligible; the Project does not require a complete plan to move to `Active` | docs/1-methodology.md#92-a-project-is-not-a-complete-plan-of-the-future | app/src/methodology/available-now.spec.ts | ok |
| SCEN-19-15 | A `Paused` Project with `Next Action` Tasks: statuses are not rewritten; the Tasks do not enter Available Now | docs/1-methodology.md#119-available-now | app/src/methodology/available-now.spec.ts | ok |
| SCEN-19-16 | A `Paused` Project with a hard Calendar commitment does not hide the commitment; an explicit decision is needed to keep, move, cancel or re-link it | docs/1-methodology.md#151-hard-landscape | app/src/methodology/paused-commitments.spec.ts | ok |
| SCEN-19-17 | A Project's transition to `Done` or `Canceled` reconciles all unfinished Tasks as `Done`, `Canceled`, `Failed` (only on the person's words) or detached or reassigned | docs/1-methodology.md#94-project-status | app/src/methodology/project-closure.spec.ts | ok |
| SCEN-19-18 | A `Done` Project with an unimproved Key Result stays `Done`; Key Result evidence and the course decision are evaluated separately | docs/1-methodology.md#71-a-key-result-is-not-a-project | app/test/eval/scen-19-18.eval.ts | degraded (G13) |
| SCEN-19-19 | An Area of Focus in healthy maintenance does not get an Objective; the acceptable state and `Mode` are enough | docs/1-methodology.md#63-when-an-area-of-focus-needs-an-objective | app/test/eval/scen-19-19.eval.ts | degraded (G9) |
| SCEN-19-20 | The acceptable state and `Mode` belong to the `Area of Focus` record, not to separate objects | docs/1-methodology.md#61-standard | app/test/contract/scen-19-20.spec.ts | degraded (G9) |
| SCEN-19-21 | A Behavior System in `Maintenance` with a deliberately started behavior: the form may be Routine; the lifecycle does not change to Habit | docs/1-methodology.md#101-lifecycle-and-automaticity--different-dimensions | app/test/eval/scen-19-21.eval.ts | degraded (G12) |
| SCEN-19-22 | A change in Objective evidence yields a proposal for a review decision `Continue/Adapt/Pause/Abandon/Achieved`, not for a Task/Project status | docs/1-methodology.md#77-goal-adjustment-during-review | app/test/eval/scen-19-22.eval.ts | degraded (G13) |
| SCEN-19-23 | A single operational failure that contradicts an Identity does not produce an Identity score and does not change the Identity; the question can come up in a user-led Deep Review only with sufficient evidence | docs/1-methodology.md#52-identity-charter | app/test/eval/scen-19-23.eval.ts | ok |
| SCEN-19-24 | An eligible standalone `Next Action` Task can enter Available Now without a Project relation | docs/1-methodology.md#119-available-now | app/src/methodology/available-now.spec.ts | ok |
| SCEN-19-25 | A Task in any status other than `Next Action` does not enter the general Available Now | docs/1-methodology.md#119-available-now | app/src/methodology/available-now.spec.ts | ok |
| SCEN-19-26 | Two problems of one Project exist as two independent discussions | docs/2-system.md#active-attention--native-notion-discussions | app/test/contract/scen-19-26.spec.ts | ok |
| SCEN-19-27 | A problem that recurs after resolution creates a new discussion | docs/3-policy.md#resolution | app/test/contract/scen-19-27.spec.ts | ok |
| SCEN-19-28 | A semantic GBrain match without a causal link does not confirm forgotten context | docs/3-policy.md#forgotten-context | app/test/eval/scen-19-28.eval.ts | ok |
| SCEN-19-29 | An exact GBrain lesson that changes the decision enters the intervention as context | docs/2-system.md#long-term-knowledge--gbrain | app/test/eval/scen-19-29.eval.ts | ok |
| SCEN-19-30 | Resolving without a durable lesson does not change GBrain | docs/3-policy.md#no-memory-write | app/test/eval/scen-19-30.eval.ts | ok |
| SCEN-19-31 | Resolving with a confirmed decision writes the decision to GBrain | docs/3-policy.md#decision | app/test/eval/scen-19-31.eval.ts | ok |
| SCEN-19-32 | A duplicate webhook yields a single cognitive processing path | docs/3-policy.md#duplicatereordered-events | app/test/integration/scen-19-32.spec.ts | ok |
| SCEN-19-33 | An App restart before a notification does not lose the delivery: the durable delivery state completes it | docs/3-policy.md#restart-app | app/test/integration/scen-19-33.spec.ts | ok |
| SCEN-19-34 | A change of state after approval yields a conflict from the executor | docs/3-policy.md#approval-required-autonomous-actions | app/test/integration/scen-19-44.spec.ts | ok |
| SCEN-19-35 | A system write that produced a webhook does not create a self-loop | docs/2-system.md#entry-points-and-trigger-semantics | app/test/integration/scen-19-35.spec.ts | ok |
| SCEN-19-36 | When GBrain is unavailable, the management/operational cycle continues with the degradation marked | docs/3-policy.md#gbrain-unavailability | app/test/contract/scen-19-36.spec.ts | ok |
| SCEN-19-37 | When Notion is unavailable, no authoritative domain conclusion is formed | docs/3-policy.md#notion-unavailability | app/test/contract/scen-19-37.spec.ts | ok |
| SCEN-19-38 | Two exact GBrain anchors yield an integrity warning without an automatic choice | docs/3-policy.md#multiple-exact-gbrain-anchors | app/test/contract/scen-19-38.spec.ts | ok |
| SCEN-19-39 | A missed resolve event is closed by the safety reconciliation | docs/3-policy.md#missed-event | app/test/integration/inv-102.spec.ts | ok |
| SCEN-19-40 | A Claude Chat follow-up request yields a future continuation persisted in the App, not only in the chat | docs/2-system.md#claude-chat-history-is-not-durable-state | app/test/contract/scen-19-40.spec.ts | ok |
| SCEN-19-41 | A Task the person creates directly in Notion goes through the same event/evaluation lifecycle as an AI-created Task | docs/2-system.md#one-behavior-model-for-both-ingress-paths | app/test/contract/scen-19-41.spec.ts | ok |
| SCEN-19-42 | A direct edit of any canonical object in Notion is interpreted through the same domain mapping and behavioral lifecycle as a conversational write | docs/2-system.md#direct-interaction-with-notion | app/test/eval/scen-19-42.eval.ts | ok |
| SCEN-19-43 | An explicit user write request in Claude performs the exact requested native domain write without a redundant second approval | docs/3-policy.md#explicitly-requested-user-writes | app/test/eval/scen-19-43.eval.ts | ok |
| SCEN-19-44 | An autonomous material write proposal is not executed before the required approval | docs/3-policy.md#approval-required-autonomous-actions | app/test/integration/scen-19-44.spec.ts | ok |
| SCEN-19-45 | A single missed Task or Behavior System repetition does not yield a generalized psychological claim | docs/3-policy.md#limit-of-self-regulation-inference | app/test/eval/scen-19-45.eval.ts | ok |
| SCEN-19-46 | Weekly Control Review covers the Inbox, Waiting For/Scheduled, Planning/Active/Paused Projects, relevant Behavior Systems, Areas of Focus and Key Results | docs/1-methodology.md#22-weekly-control-review | app/test/integration/scen-21-8.spec.ts | degraded (G9, G13) |
| SCEN-19-47 | Strategic Review evaluates Key Result evidence, the change-mechanism portfolio, resource conflicts and Area of Focus Modes | docs/1-methodology.md#23-strategic-review | app/test/eval/scen-19-47.eval.ts | degraded (G13) |
| SCEN-19-48 | Daily Control shows the hard landscape and a small Available Now, without loading the whole backlog | docs/1-methodology.md#21-daily-control | app/test/eval/scen-19-48.eval.ts | ok |
| SCEN-19-49 | Both execution surfaces — interactive and App-triggered — apply the same domain knowledge: it is stored once, and the surfaces take it from one commit | docs/2-system.md#claude-plugin-architecture | app/test/contract/scen-19-49.spec.ts | ok |
| SCEN-19-50 | When App runtime/control is unavailable, durable follow-through is not claimed to be scheduled | docs/3-policy.md#app-runtimecontrol-unavailability | app/test/contract/scen-19-50.spec.ts | ok |
| SCEN-19-51 | An App MCP tool that duplicates a Notion/GBrain domain write fails architecture acceptance | docs/2-system.md#app-mcp--runtimecontrol-interface | app/test/contract/scen-19-51.spec.ts | ok |
| SCEN-19-52 | A chat closed after a persisted follow-up does not cancel the follow-up: it is executed at the specified time | docs/2-system.md#runtime-continuity--app-and-app_db | app/test/integration/scen-21-4.spec.ts | ok |

**The range ends at `SCEN-19-52`:** there are exactly 52 required scenarios.

**`SCEN-19-32` and `SCEN-19-35` live in `app/test/integration/`:** the receipt lifecycle in the database enforces both claims. Events are deduplicated by the unique key `(source, external_id)`; the echo of the system's own write is suppressed by the author rule, whose verdict the receipt records. Without the database, neither claim can be proven. Neither needs the model, so by the [path convention](#test-path-convention) this is `ci-contract` against the App's own database.

---

# 2. Acceptance criteria — `SCEN-20-xx`

Each criterion is encoded in full (verbatim) in `contracts/invariants.yaml`. It is **not restated** here: a row names the criterion and binds it to its invariant ID and its test. The verbatim wording is in the registry, not here.

**ID binding.** `SCEN-20-NN` ↔ `INV-2NN`: `NN` is the criterion's number in the registry (`mvp20_ordinal: NN`), and the number is the criterion's identity, not its position. No correspondence table is needed.

**The `Test` column follows the registry, not this document.** The value is taken from the fields `verifiable_by` and `test` of the matching `INV-2NN`. Where the registry sets `test: null`, a test is **not invented**: the row either takes the test of the core invariant named in `same_as` or has none at all (`manual`).

Only the criteria with `ci-contract` are gated mechanically in `npm test`; the rest are `eval`, `integration` or `manual`. The split is derived by `app/test/contract/registry.spec.ts`, which also keeps this column in agreement with the registry. `SCEN-20-17` and `SCEN-20-19` have no test of their own: the test is that of the core invariant named in `same_as`.

| ID | Criterion (verbatim label) | Source | Test | Status |
|----|---------------------------|---------|------|--------|
| SCEN-20-01 | **Proactivity** | contracts/invariants.yaml#INV-201 | app/test/integration/inv-201.spec.ts | ok |
| SCEN-20-02 | **Methodology conformance** | contracts/invariants.yaml#INV-202 | app/test/contract/inv-202.spec.ts | degraded (G9, G13) |
| SCEN-20-03 | **Data ownership** | contracts/invariants.yaml#INV-203 | `manual`; the enforceable part is `INV-052`, `INV-017` | ok |
| SCEN-20-04 | **Attention cardinality** | contracts/invariants.yaml#INV-204 | app/test/contract/inv-204.spec.ts | ok |
| SCEN-20-05 | **Operating loop** | contracts/invariants.yaml#INV-205 | app/test/eval/inv-205.eval.ts | ok |
| SCEN-20-06 | **Execution model** | contracts/invariants.yaml#INV-206 | app/test/contract/inv-206.spec.ts | ok |
| SCEN-20-07 | **Change mechanisms** | contracts/invariants.yaml#INV-207 | app/test/contract/inv-207.spec.ts | degraded (G7, G12) |
| SCEN-20-08 | **Direction model** | contracts/invariants.yaml#INV-208 | app/test/eval/inv-208.eval.ts | degraded (G9, G13) |
| SCEN-20-09 | **Context efficiency** | contracts/invariants.yaml#INV-209 | app/test/eval/inv-209.eval.ts | ok |
| SCEN-20-10 | **Reasoning quality** | contracts/invariants.yaml#INV-210 | app/test/eval/inv-210.eval.ts | ok |
| SCEN-20-11 | **Safety** | contracts/invariants.yaml#INV-211 | app/test/eval/inv-211.eval.ts | ok |
| SCEN-20-12 | **Reliability** | contracts/invariants.yaml#INV-212 | app/test/integration/inv-212-continuation.spec.ts | ok |
| SCEN-20-13 | **Memory quality** | contracts/invariants.yaml#INV-213 | app/test/eval/inv-213.eval.ts | ok |
| SCEN-20-14 | **User value** | contracts/invariants.yaml#INV-214 | app/test/eval/inv-214.eval.ts | ok |
| SCEN-20-15 | **Selective exposure** | contracts/invariants.yaml#INV-215 | app/test/eval/inv-215.eval.ts | ok |
| SCEN-20-16 | **Anti-bureaucracy** | contracts/invariants.yaml#INV-216 | `manual` | ok |
| SCEN-20-17 | **Ingress parity** | contracts/invariants.yaml#INV-217 | the test is that of `INV-047`; the metric is `SCEN-12-04` | ok |
| SCEN-20-18 | **Durable conversation outcomes** | contracts/invariants.yaml#INV-218 | app/test/integration/inv-218.spec.ts | ok |
| SCEN-20-19 | **Behavior parity** | contracts/invariants.yaml#INV-219 | the test is that of `INV-048` | ok |
| SCEN-20-20 | **Native domain interfaces** | contracts/invariants.yaml#INV-220 | `manual`; the enumerable part is `INV-028` | ok |
| SCEN-20-21 | **Proactive delivery** | contracts/invariants.yaml#INV-221 | app/test/integration/inv-221.spec.ts | blocked (needs a configured delivery channel) |

**Restatement rows.** Four criteria are restatements of invariants that already exist elsewhere in the registry; no second test is created for them:

| SCEN | INV | `same_as` | Where the test lives |
|---|---|---|---|
| SCEN-20-03 | `INV-203` | `INV-050`, `INV-051`, `INV-052` | `INV-052`, `INV-017` |
| SCEN-20-17 | `INV-217` | `INV-047` | `INV-047` |
| SCEN-20-19 | `INV-219` | `INV-048` | `INV-048` |
| SCEN-20-20 | `INV-220` | `INV-025` | `INV-028` |

**The range ends at `SCEN-20-21`:** the registry holds **21** criteria (`INV-201`…`INV-221`).

---

# 3. End-to-end scenarios — `SCEN-21-x`

For these eight scenarios, the sequence of steps is itself the contract, so the sequence is given here in full. A test counts as passed only if the steps happened **in this order**.

## SCEN-21-1 — Dependency from a Notion event

A Task moves to `Waiting For` in Notion; the relation points to an external dependency, `Date` to the time of the next check. The App receives the relevant event, checks technical validity and idempotency, applies the debounce and the relevance gate and starts a run in `event_evaluation`. Then:

1. the Task and its relation to the Project are read;
2. it is checked that the Project has the status `Active`;
3. the deadline and the relevant critical Tasks are read;
4. the existence of an executable alternative is checked;
5. the relevant unresolved discussions are read;
6. the exact GBrain Project anchor and the linked lesson are found;
7. the dependency hypothesis and the counterevidence are checked.

If the dependency is material, an existing attention thread is continued or a new one is created, follow-through is persisted through the App, and an interrupt arises only when there is an actionable `why_now`. If the final external action needs a separate approval, the App stores an immutable pending contract; after approval, the executor checks the current preconditions and writes the approved change as a system write through the App. After confirmation, a scheduled recheck or a new event starts a re-evaluation. The status `Unblocked` is not created: the Task moves to the canonical status that is factually correct — `Done` if the expected result was itself tracked work, `Next Action` or `Scheduled` if its own work remains, or `Failed` if the dependency no longer applies and the attempt never took place. The system proposes the first two and does not execute them on its own. Only the person sets `Failed`, and the system asks about it. Resolution leads to closure processing, which may add a timeline event or a confirmed fact; a generalized lesson arises only with sufficient transferable evidence.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-1 | `manual`: [`infra/GATE.md`](../infra/GATE.md#gate-m5) | degraded (G5) |

## SCEN-21-2 — Commitment from Claude Chat

The utterance “I'll send Ivan the offer on Friday” yields:

1. a recognized commitment candidate: owner, concrete future action, time constraint;
2. classification → a single trackable unit of work → candidate type Task;
3. a relevant Project is set only if the link genuinely exists; the relation is not required;
4. a search for an equivalent non-terminal Task in Notion; if one exists, no duplicate is created;
5. time semantics: the time of execution or activation → `Scheduled` + `Date`; a deadline for work that is already available → `Next Action` + `Deadline`; if ambiguous, a clarification, not a guess;
6. a Task inferred from the conversation without a direct command → approval is required;
7. after approval the current state is checked, and the Task is written through the Notion MCP — as the person's write.

A rejected proposal does not produce a hidden commitment record in the App as a substitute operational Task.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-2 | app/test/integration/scen-21-2.spec.ts | ok |

## SCEN-21-3 — Explicit write request in Claude Chat

The utterance “Create a Task: call Ivan tomorrow” is a direct authorization for an exact operational mutation:

1. enough current state is checked to avoid an obvious duplicate or a conflicting interpretation;
2. “tomorrow” as the planned day of execution → `Scheduled` + `Date = tomorrow`; only a deadline → `Next Action` + `Deadline`;
3. after sufficient clarification the native Notion operation is performed;
4. no additional change to a Project deadline, priority or unrelated Tasks is derived.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-3 | app/test/integration/scen-21-3.spec.ts | ok |

## SCEN-21-4 — Follow-up that must survive the chat

The utterance “If the vendor doesn't answer by Monday morning, bring this back to me” yields:

1. an identified relevant Notion object or discussion;
2. a future continuation, persisted through the App MCP;
3. a conversational acknowledgment without successful App persistence is **not enough**;
4. on Monday the App starts `scheduled_recheck`;
5. the fresh Notion state is read and it is decided whether the intervention is still needed.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-4 | app/test/integration/scen-21-4.spec.ts | ok |

## SCEN-21-5 — Resolved discussion and cognitive observation

Resolving a discussion about a missed external dependency yields:

1. closure processing reads the thread, the current Project state and the relevant prior GBrain evidence;
2. the result is one of three: no memory write; a historical timeline event; a narrow confirmed fact;
3. the stable claim “the person systematically underestimates dependencies” is **not** proven;
4. a cognitive-observation candidate arises only from repeated independent evidence;
5. a durable personal pattern needs the person's confirmation.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-5 | app/test/integration/scen-21-5.spec.ts | ok |

## SCEN-21-6 — Behavior System installation

The utterance “I want to review the portfolio allocation and the decision log every Friday” yields:

1. a classification of the person's intention as a recurring behavior, not an endless Project or Objective;
2. a Behavior System proposal with the lifecycle `Designed` or `Installing`, cue, context, cadence, minimum and target versions, success and recovery rules;
3. while a deliberate reminder is needed, a Task instance with the status `Scheduled` and a `Date`;
4. the lifecycle does **not** change to `Habit` because the behavior is performed;
5. on stabilization, recurring Task generation is switched off, the Behavior System can be `Maintenance`, and the form can remain a conscious Routine.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-6 | app/test/integration/scen-21-6.spec.ts | degraded (G12) |

## SCEN-21-7 — Project result and Objective feedback

A Project meets its `Definition of Done` and moves to `Done`; the linked Key Result does not improve. Closure processing:

1. leaves the Project `Done`;
2. settles the unfinished Project Tasks;
3. records the current Key Result evidence;
4. during a Strategic Review proposes `Continue`, `Adapt`, `Pause`, `Abandon` or `Achieved` for the Objective according to the combined evidence;
5. does not create the status `Failed` for either the Project or the Objective.

A lesson about the ineffectiveness of a mechanism may be proposed for GBrain separately from the operational state, and only when it has long-term value and sufficient evidence.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-7 | app/test/integration/scen-21-7.spec.ts | degraded (G7, G13) |

## SCEN-21-8 — Weekly Control Review

`weekly_control_review` (scheduled or user-requested) runs sequentially:

1. Clarify the main Inboxes;
2. the Calendar, backward and forward over a useful horizon;
3. `Waiting For` Tasks and their `Date`;
4. upcoming `Scheduled` Tasks;
5. `Planning` and `Active` Projects, and a check that `Paused` Projects remain deliberately paused;
6. `Installing` or problematic Behavior Systems;
7. a brief look at Areas of Focus by the `area_of_focus_risk` grounds: deviation from `Standard`, a `Mode` that has diverged from the work, and absence of motion under `Advance`;
8. only Key Results with new data;
9. adaptations according to type semantics;
10. rough focus, risks and a small execution surface for the next week.

The review does not require a relation from a Task to all Levels and does not create metrics or objects without decision value.

| ID | Test | Status |
|----|------|--------|
| SCEN-21-8 | app/test/integration/scen-21-8.spec.ts | degraded (G9, G13) |

---

# 4. Observability and metrics — `SCEN-17-xx`

The range is outside the fixed ID scheme and does not collide with `SCEN-19/20/21/64`. The metrics are defined in [`docs/3-policy.md`](3-policy.md#behavior-metrics), and the tracing mechanism is described in [`docs/2-system.md`](2-system.md#observability-and-cost). The rows below only pair the metric definitions and the tracing mechanism with tests.

**Run trace.** The list of run-trace fields is defined in `contracts/canonical.yaml`, key `run_trace_fields`, and is **not duplicated** here. In that key the registry records the name of each field and whether it is required: `required_when` says from which point in a run the field must be present. The `CHECK` constraints of the trace tables and the constraint trigger between them enforce this, and both are tested against a live database (`app/test/integration/run-trace-fields.spec.ts`). `SCEN-17-01` checks these rules: that field names are canonical and that the trace is complete at each point in a run.

| ID | Expected behavior | Source | Test | Status |
|----|---------------------|---------|------|--------|
| SCEN-17-01 | Every run leaves an execution trace whose fields use the canonical names from `run_trace_fields`; a field outside this set fails trace validation | contracts/canonical.yaml#run_trace_fields | app/test/contract/scen-17-01.spec.ts | ok |
| SCEN-17-02 | Traces are technical records in `app_db` (the `run_traces` ledger, the run snapshot, the lists): they are not domain memory and do not automatically enter reasoning | docs/2-system.md#observability-and-cost | app/test/contract/scen-17-02.spec.ts | ok |
| SCEN-17-03 | Precision and recall are measured separately for each detector category; no overall aggregate score is published | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-03.eval.ts | ok |
| SCEN-17-04 | The duplicate-discussion rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-04.eval.ts | not-implemented |
| SCEN-17-05 | The unnecessary-interruption rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-05.eval.ts | not-implemented |
| SCEN-17-06 | The dismissed-without-value rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-06.eval.ts | not-implemented |
| SCEN-17-07 | The snooze rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-07.eval.ts | not-implemented |
| SCEN-17-08 | The action acceptance rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-08.eval.ts | not-implemented |
| SCEN-17-09 | Unresolved discussion age is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-09.eval.ts | not-implemented |
| SCEN-17-10 | The missed follow-up rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-10.eval.ts | not-implemented |
| SCEN-17-11 | The volunteered-versus-opened rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-11.eval.ts | not-implemented |
| SCEN-17-12 | The relevant-context rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-12.eval.ts | not-implemented |
| SCEN-17-13 | The false semantic match rate is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-13.eval.ts | not-implemented |
| SCEN-17-14 | Average opened pages per run is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-14.eval.ts | ok |
| SCEN-17-15 | GBrain tokens per useful intervention is measured | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-15.eval.ts | not-implemented |
| SCEN-17-16 | GBrain's own approximate volunteered-context feedback mechanism tunes the confidence threshold and is not treated as a precise audit metric | docs/3-policy.md#behavior-metrics | app/test/contract/scen-17-16.spec.ts | ok |
| SCEN-17-17 | For every run the tool calls, input and output tokens and latency are recorded — enough to determine whether a detector, sweep or retrieval path uses up more resources than the value it creates | docs/2-system.md#observability-and-cost | app/test/contract/scen-17-17.spec.ts | ok |
| SCEN-17-18 | Release evals measure object-type classification accuracy | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-18.eval.ts | ok |
| SCEN-17-19 | Release evals measure Task Status and Project Status accuracy | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-19.eval.ts | ok |
| SCEN-17-20 | Release evals measure the false `Scheduled` from Deadline rate | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-20.eval.ts | ok |
| SCEN-17-21 | Release evals measure the missed `Waiting For` dependency rate | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-21.eval.ts | degraded (G5) |
| SCEN-17-22 | Release evals measure Available Now eligibility precision | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-22.eval.ts | ok |
| SCEN-17-23 | Release evals measure terminal-Project Task-reconciliation failures | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-23.eval.ts | ok |
| SCEN-17-24 | Release evals measure the Project / Key Result outcome conflation rate | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-24.eval.ts | degraded (G13) |
| SCEN-17-25 | Release evals measure the Behavior System lifecycle/automaticity conflation rate | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-25.eval.ts | degraded (G12) |
| SCEN-17-26 | Release evals measure the unauthorized higher-Level mutation rate | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-26.eval.ts | ok |
| SCEN-17-27 | Release evals measure the unnecessary Objective/Project/recurring-Task creation rate | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-27.eval.ts | ok |
| SCEN-17-28 | Release evals measure review packet relevance and the system-overhead rate | docs/3-policy.md#behavior-metrics | app/test/eval/scen-17-28.eval.ts | not-implemented |
| SCEN-17-29 | Canonical terminology and invariants are checked by automated contract tests; local schema names may differ, but the normalized execution trace uses canonical object types and enum values | docs/3-policy.md#behavior-metrics | app/test/contract/scen-17-29.spec.ts | ok |

**`not-implemented` here means one thing:** the metric is named, but the way to measure it is not specified. The list of the twelve metrics with this status is kept in [`docs/3-policy.md`](3-policy.md#metrics-without-a-defined-measurement). The eval path in a `not-implemented` row is a reserved location: no eval is written there until a definition appears.

---

# 5. Implementation plan metrics — `SCEN-12-xx`

The range is outside the fixed ID scheme and does not collide with the other ranges.

| ID | Expected behavior | Source | Test | Status |
|----|---------------------|---------|------|--------|
| SCEN-12-01 | Model-free contract tests (`npm test`) cover: every invariant of `contracts/invariants.yaml` with `verifiable_by: ci-contract`; canonical enum values; the absence of forbidden names in the App MCP; `app_db` without domain tables; one body of domain knowledge on both execution surfaces; the toolset of an App-triggered run without built-in tools; the adapter's rejection of unknown values | ../contracts/README.md#composition-of-the-contract-test-set | app/test/contract/scen-12-01.spec.ts | ok |
| SCEN-12-02 | Behavioral evals run over a replay dataset of traces and cover the detector, interaction, context, cost and methodology conformance metrics | docs/3-policy.md#behavior-metrics | app/test/eval/scen-12-02.eval.ts | blocked (there is no replay dataset: GAP-06) |
| SCEN-12-03 | The `capability-respect rate` is measured: the share of runs in which the model did not assert semantics marked `absent` in the degradation register | docs/3-policy.md#behavior-metrics | app/test/eval/scen-12-03.eval.ts | ok |
| SCEN-12-04 | The `path-parity rate` is measured: the divergence of decisions between the Chat and App-triggered paths on identical scenarios — an observation metric, not an architecture switch | docs/3-policy.md#behavior-metrics | app/test/eval/scen-12-04.eval.ts | ok |
| SCEN-12-05 | The `capture-scope violation rate` is measured: writes from the capture path outside `capture_policy` — not a data source of Tasks, or an update instead of a create; on the system's path the App's conversion makes no such writes, by construction | docs/3-policy.md#standing-authorization-capture_policy | app/test/contract/scen-12-05.spec.ts | ok |

---

# 6. Production readiness — `SCEN-64-xx`

The production readiness gates and the Definition of Done are **one and the same readiness claim in two forms**. There is a single set: the sixteen gates divide it coarsely and the 32 items of the Definition of Done divide it finely, plus one row for the gate that has no counterpart in the Definition of Done.

## Sixteen gates

| # | The system is ready to be turned on when |
|---|---|
| G1 | The production Compose configuration resolves without unresolved variables or errors |
| G2 | PostgreSQL roles and databases are created and configured |
| G3 | GBrain is initialized and syncs `gbrain-repo` |
| G4 | GBrain health, model and retrieval checks pass |
| G5 | The App's durable technical state is persisted in `app_db` |
| G6 | The App executes a run through the Claude Agent SDK; authentication uses the Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`) |
| G7 | The App has a working Notion REST integration and validates Notion webhooks |
| G8 | The App has an authorized, refreshable Notion MCP connection for headless Claude runs |
| G9 | The App can obtain a GBrain access token for App-triggered Claude MCP access |
| G10 | The App MCP is available over public HTTPS and requires authentication |
| G11 | Claude Chat with the Personal Management System Plugin sees the App, Notion and GBrain connectors |
| G12 | An App-triggered run loads the runner plugin with the chat plugin's knowledge as assembled by the image build |
| G13 | An App-triggered run uses all three remote MCP servers with a run-specific tool configuration |
| G14 | Direct Notion edits enter the same lifecycle through webhooks |
| G15 | Encrypted offsite backups exist for persistent state |
| G16 | Restore procedures are tested in practice |

The `Gate` column of the table below names the matching item of this list; `—` means that the item exists only in the Definition of Done. The code `Gx` in the `Status` column belongs to a different namespace; see [Reference convention](#reference-convention).

| ID | Expected behavior | Gate | Test | Status |
|----|---------------------|------|------|--------|
| SCEN-64-01 | The App image starts as a workload | — | `manual`: [`infra/RUNBOOK.md`](../infra/RUNBOOK.md#4-startup) | ok |
| SCEN-64-02 | `app_db` and `gbrain_db` exist with isolated roles | G2 | `manual`: [`infra/RUNBOOK.md`](../infra/RUNBOOK.md#4-startup) | ok |
| SCEN-64-03 | `gbrain-repo` is mounted read/write in GBrain | G3 | `manual`: [`infra/RUNBOOK.md`](../infra/RUNBOOK.md#5-gbrain-initial-import) | ok |
| SCEN-64-04 | The pinned GBrain baseline successfully completes init, sync and search | G3, G4 | `manual`: [`infra/RUNBOOK.md`](../infra/RUNBOOK.md#5-gbrain-initial-import) | ok |
| SCEN-64-05 | The Notion REST integration works | G7 | app/test/integration/scen-64-05.spec.ts | blocked (needs a Notion workspace with an integration token) |
| SCEN-64-06 | The Notion webhook → App works | G7 | app/test/integration/scen-64-06.spec.ts | blocked (needs a public address that Notion can reach) |
| SCEN-64-07 | The App has a refreshable Notion MCP OAuth for headless Claude runs | G8 | `manual`: [`infra/RUNBOOK.md`](../infra/RUNBOOK.md#63-notion-mcp-grant) | ok |
| SCEN-64-08 | The App executes a run through the Claude Agent SDK; authentication uses the Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`) | G6 | `manual`: [`infra/GATE.md`](../infra/GATE.md#gate-m3) | ok |
| SCEN-64-09 | The Personal Management System Plugin installs in Claude Chat | G11 | app/test/integration/scen-64-09.spec.ts | blocked (a person checks installing the plugin from the installation's marketplace in the chat client) |
| SCEN-64-10 | The Personal Management System Skill layer is discoverable | G11, G12 | app/test/integration/scen-64-10.spec.ts | blocked (a person checks claude.ai and Desktop; in a run `init.skills` names the Skill, in Claude Code it is visible through its description) |
| SCEN-64-11 | The Plugin provides the App, Notion and GBrain connectors | G11 | app/test/integration/scen-64-11.spec.ts | blocked (the GBrain connector for the chat needs a public address; a person checks the App and Notion in the chat) |
| SCEN-64-12 | An App-triggered run loads the runner plugin with the chat plugin's knowledge as assembled by the image build | G12 | app/test/contract/inv-048.spec.ts | ok |
| SCEN-64-13 | An App-triggered run reaches exactly three MCP domains — `mcp__app__*`, `mcp__notion__*`, `mcp__gbrain__*` — and no built-in tool; ambient configuration adds neither servers nor tools | G9, G13 | `manual`: [`infra/GATE.md`](../infra/GATE.md#gate-m3) | ok |
| SCEN-64-14 | The allowed toolset of a run resolves from the mode → toolset matrix, not from unconditional exposure of all tools | G13 | app/test/contract/inv-307.spec.ts | ok |
| SCEN-64-15 | The App MCP endpoint is authenticated and reachable over public HTTPS | G10 | app/test/integration/scen-64-15.spec.ts | blocked (public HTTPS; M11) |
| SCEN-64-16 | The App MCP exposes only runtime and control capabilities and the closed list of the system's intents | — | app/test/contract/scen-19-51.spec.ts | ok |
| SCEN-64-17 | The App MCP has no duplicate domain-write facade for Notion or GBrain | — | app/test/contract/scen-19-51.spec.ts | ok |
| SCEN-64-18 | Native Notion MCP reads and writes are available when the policy allows | — | `manual`: [`infra/GATE.md`](../infra/GATE.md#gate-m4-and-the-chat-path) | ok |
| SCEN-64-19 | Native GBrain MCP reads and writes are available when the policy allows | — | `manual`: [`infra/GATE.md`](../infra/GATE.md#gate-m4-and-the-chat-path) | ok |
| SCEN-64-20 | A pending approval contract carries the changes themselves in canonical terms — the page, the property and the value | — | app/test/integration/scen-19-44.spec.ts | ok |
| SCEN-64-21 | The executor of approved actions writes the approved change as a system write, without the App's own domain operation | — | app/test/integration/scen-19-44.spec.ts, app/test/contract/inv-086.spec.ts | ok |
| SCEN-64-22 | Direct user edits in Notion enter the same webhook lifecycle | G14 | app/test/contract/scen-19-41.spec.ts | blocked (needs a live edit by a person in Notion that reaches the App by webhook) |
| SCEN-64-23 | Independent external GBrain MCP access works | — | app/test/integration/scen-64-23.spec.ts | blocked (needs a public GBrain MCP address) |
| SCEN-64-24 | The local stack works | — | `manual`: [`infra/RUNBOOK.md`](../infra/RUNBOOK.md#7-verification) | ok |
| SCEN-64-25 | The VPS stack works | G1 | app/test/integration/scen-64-25.spec.ts | blocked (M11) |
| SCEN-64-26 | Caddy HTTPS works | G10 | app/test/integration/scen-64-26.spec.ts | blocked (M11) |
| SCEN-64-27 | Production public host ports are limited to 22/80/443 | — | app/test/integration/scen-64-27.spec.ts | blocked (M11) |
| SCEN-64-28 | The `app_db` backup is tested | G15 | app/test/integration/scen-64-28.spec.ts | blocked (M11) |
| SCEN-64-29 | The `gbrain-repo` offsite backup is tested | G15 | app/test/integration/scen-64-29.spec.ts | blocked (M11) |
| SCEN-64-30 | The `gbrain_db` recovery policy is tested | G16 | app/test/integration/scen-64-30.spec.ts | blocked (M11) |
| SCEN-64-31 | The GBrain Markdown rebuild is tested | G16 | app/test/integration/scen-64-31.spec.ts | blocked (M11) |
| SCEN-64-32 | A restore drill has been performed | G16 | `manual`: [`infra/RUNBOOK.md`](../infra/RUNBOOK.md#13-restore-app_db) | blocked (M11) |
| SCEN-64-33 | The App's durable technical state is persisted in `app_db` | G5 | app/test/integration/scen-64-33.spec.ts | ok |

**Rows that exist in one form only:**

- Only in the gates: **G5** (the App's durable technical state is persisted in `app_db`) — the Definition of Done covers the existence of the database (`SCEN-64-02`), but not the writing of that state. G5 is covered by the separate `SCEN-64-33`.
- Only in the Definition of Done: `SCEN-64-01` (the App image as a workload) and `SCEN-64-24` (the local stack), both preconditions, not gates (no gate asserts them, and G1 concerns the production Compose); `SCEN-64-16`, `SCEN-64-17` (the restriction of the App MCP's capabilities), `SCEN-64-18`, `SCEN-64-19` (use of the native domain MCP in practice), `SCEN-64-20`, `SCEN-64-21` (the approval contract and its execution as a system write), `SCEN-64-23` (independent external GBrain MCP access), `SCEN-64-27` (the restriction of public ports).
- Weak coverage: **G9** (the App obtains a GBrain access token for App-triggered Claude) has no dedicated item in the Definition of Done; the closest is `SCEN-64-13` (exactly three MCP domains), which does not check token acquisition as such.

---

# 7. Final behavioral contract — `SCEN-22-xx`

| ID | Expected behavior | Source | Test | Status |
|----|---------------------|---------|------|--------|
| SCEN-22-01 | The canonical operating loop `Capture → Clarify → Organize & Align → Engage → Reflect → Adapt → feedback to the appropriate Level` works reliably from **both** user ingress paths | docs/2-system.md#final-system-model | app/test/integration/scen-22-01.spec.ts | ok |
| SCEN-22-02 | Every phase is executed as a bounded cognitive cycle: observe → exact scope → canonical object type and lifecycle semantics → fresh management/operational state → bounded semantic context → hypotheses and their checks → the smallest useful intervention → externalized future-relevant outcome → a continuation over time when needed → only authorized native domain actions → recognized resolution → consolidation of only genuinely durable knowledge | docs/2-system.md#final-system-model | app/test/eval/scen-22-02.eval.ts | ok |
| SCEN-22-03 | Reasoning stays flexible, but the canonical ontology, state ownership, evidence requirements, permission semantics and durable follow-through remain explicit and verifiable | docs/2-system.md#final-system-model | app/test/contract/scen-22-03.spec.ts | ok |

---

# 8. Source contradictions

Notes on statuses and on divergences between rows. Each item states how a row is read.

## `SCEN-19-18`: Project `Done` and Key Result evidence

The row `SCEN-19-18` has two halves, and each is read separately. The negative half (the Project stays `Done`, and the achievement of the Key Result is not derived) is not degraded: the Project → Key Result relation is native, so both objects are read in one query. The positive half (Key Result evidence and the course decision are evaluated separately) is degraded: the arrival of evidence has no carrier (`G13`), as in `SCEN-19-22`, which rests on the same dependency.

The row is marked `degraded (G13)`; the test checks the two halves separately.

## Four necessarily degraded scenarios

Four scenarios are degraded **unquestionably**, not by the marking rule but because the physical schema requires it:

| ID | Scenario | Status |
|---|---|---|
| `SCEN-19-09` | `Waiting For` Task; the external side of the dependency | `degraded (G5)` |
| `SCEN-19-20` | the acceptable state and `Mode` belong to the Area of Focus record | `degraded (G9)` |
| `SCEN-19-21` | a Behavior System in `Maintenance` | `degraded (G12)` — only in the design-fields part; `Lifecycle` is observable natively |
| `SCEN-19-22` | Objective evidence changed → review decision | `degraded (G13)` |

The rest of the `degraded` statuses in this file follow from the marking rule, and they are the ones subject to revision if the rule changes. These four are not subject to revision: they are lifted only through the lift path of the matching degradations.

In the degraded form of `SCEN-19-22`, the Strategic Review delivers the `Continue/Adapt/Pause/Abandon/Achieved` decision in the packet: it asserts `Continue` and recommends the rest with evidence. In that form the review names a change in Key Result evidence only on the person's words. The carrier for the decision itself will appear together with the build-out of the L2 structure (`G13`).

## Acceptable state and `Mode` belong to the record

`SCEN-19-20` asserts that the acceptable state and `Mode` belong to the `Area of Focus` record, not to separate objects.

`Mode` is a native property — a state with a closed set of values. The acceptable state has no carrier in Notion: it builds up in the GBrain anchor of the Area of Focus over the course of reviews (`G9`). The claim that the acceptable state and `Mode` belong to the record holds in both cases (the anchor is addressed by the same page ID), but the check reads two different sources.

## The source names metrics without a defined measurement

The source names 23 metrics. A way of measuring is specified for eleven — `SCEN-17-14` and the group `-18…-27`. For the remaining twelve (`SCEN-17-04…-13`, `-15`, `-28`) there is only a name: no numerator, no denominator, no window, no unit of observation. They are marked `not-implemented` — this is a missing contract, not a postponed implementation.

`SCEN-17-01`, `-02`, `-03`, `-16`, `-17` and `-29` do not belong to these 23: they assert properties of the trace and rules for reading it, not a separate metric.

---
