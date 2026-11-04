# Personal Management System documentation

This is a routing map: it says which file to open for which question. It is not a table of contents; each document has its own.

## Where to go with a question

| Question | File |
|---|---|
| What does the `Waiting For` status mean? What are an Area of Focus, a Key Result and a Behavior System? How is the operating loop built, and when is the Weekly Control Review held? | [`1-methodology.md`](./1-methodology.md) |
| How does the App suppress a self-loop? Who owns which state? What can each of the three MCPs do? Where and how is the data stored? | [`2-system.md`](./2-system.md) |
| When may the system send a notification? What counts as sufficient evidence? What may be executed without confirmation? What goes into long-term memory? | [`3-policy.md`](./3-policy.md) |
| What must work for something to count as ready? Where does this requirement come from, and which test checks it? | [`4-acceptance.md`](./4-acceptance.md) |
| What do we do next? What is broken? Which decisions are still open? | [`5-plan.md`](./5-plan.md) |
| Why is the rule what it is? | the section that owns the rule — [Where the “why” lives](#where-the-why-lives) |
| Why this option and not another? | [`decisions/`](./decisions/) |
| What is the **exact** value of an enum, a status, a limit or a budget? | [`../contracts/canonical.yaml`](../contracts/canonical.yaml) |
| Which invariant fails `npm test`? | [`../contracts/invariants.yaml`](../contracts/invariants.yaml) |
| Which databases, properties, relations and formulas must the Notion workspace have? | [`../contracts/notion-workspace.yaml`](../contracts/notion-workspace.yaml) |
| How do I bring the stack up locally or on a VPS and take a backup? What do I do when it does not work? | [`../infra/RUNBOOK.md`](../infra/RUNBOOK.md) |
| How do I accept a milestone with its gate? | [`../infra/GATE.md`](../infra/GATE.md) |
| Need a full example, a starter template or a primary research source? | [`appendix/`](./appendix/) |

## Who owns what

| Source | Authoritative for | Changes when |
|---|---|---|
| `README.md` (root) | the product overview: what kind of system it is and what it is for, what an installation needs, the status line | the product, its requirements or the scope of what is implemented changes |
| `1-methodology.md` | domain ontology, the five Levels, object types and status semantics, the operating loop, reviews, decision rules | the methodology itself changes |
| `2-system.md` | components and boundaries, topology, ownership of state, MCP interfaces, the App, persistence, authentication, security — and why the mechanism is what it is | the mechanism changes, which means the code must be redeployed |
| `3-policy.md` | evidence standards, attention lifecycle, intervention policy, permission classes, memory policy, the degradation register — and why the policy is what it is | behavior changes, which means the evals must be rerun |
| `4-acceptance.md` | **nothing.** Every row quotes its source and names the test. Any divergence from the source is an error in this file | the source or the test changes |
| `5-plan.md` | the sequence of milestones and their gates, spikes, scope limits, the registers of defects and gaps | the set of milestones, their gates or an open register entry changes |
| `decisions/` | decisions in force (ADRs): context, the choice and the rejected options, consequences and cost. An ADR says why this option was chosen; the rule in force and its “why” live in a normative section | a decision is adopted, changed or withdrawn: an ADR is written, rewritten or deleted |
| `contracts/*.yaml` | canonical lists of values, lifecycle rules (`rules:`) together with their rationale, machine-readable invariants, the physical schema of Notion | the fact itself changes |
| `infra/RUNBOOK.md` | procedures: commands, the order of steps, checks, troubleshooting | the procedure changes |
| `infra/GATE.md` | gates: the gate environment, running the gate, scenarios, the verdict and the limits of each gate | a gate or its environment changes |
| Skill (`plugin/skills/`, `app/plugin/skills/`) | **nothing.** The Skill is a prompt; it implements decisions rather than making them | — |
| `appendix/` | **nothing.** Reference material: examples, templates, research notes | — |
| `app/` code | **no norm.** The implemented mechanism is what the system actually does. A comment states a local invariant and points to the rule's home; it does not restate the rationale | the code changes |

`contracts/` is **code, not documentation**. A fact is stated once, in `contracts/`; documents refer to it and never copy values by hand. A value duplicated by hand in `docs/*.md` is already out of date. The same goes for the rationale: it is stated once, in the rule's home — [Where the “why” lives](#where-the-why-lives).

## Roles

The **installation owner** is the person whose system it is: their Notion workspace, their subscription token, their data. The installation serves only that person.

The **project maintainer** is whoever decides questions about the project itself: which of two contradictory norms prevails, the set of milestones and the scope limits.

## Terms

These words carry a fixed meaning in the documents, the contracts and the code. Each entry says what the term is and links to the section that owns it; the section is authoritative, and its rules are not repeated here.

| Term | What it is | Defined in |
|---|---|---|
| **anchor** (GBrain) | The GBrain page that stands for one long-lived Notion object, such as an Objective, a significant Project or an Area of Focus. It is an identity bridge: it holds the object's exact Notion page ID and the current summary, and it is an entry point into the graph. | [Canonical anchors](./2-system.md#canonical-anchors) |
| **App MCP** | The MCP server of the App, the interface for runtime and control. It exposes the capabilities that belong to the system's runtime continuity (comments in the system's voice, Inbox capture, continuations, delivery, proposals, memory writes, introspection), while the Notion MCP and the GBrain MCP perform the person's own operations. | [App MCP — runtime/control interface](./2-system.md#app-mcp--runtimecontrol-interface) |
| **approval**, **proposal** | A proposal is an immutable contract that an autonomous run makes for a change it wants written: the effects (property changes with their values) and the preconditions under which the change is still the one shown. Approval is the person's decision on it, given with a channel button or in the chat; the executor then writes exactly what was shown. | [Approval-required writes](./2-system.md#approval-required-writes) |
| **attempt**, **trial** | In a queue, an attempt is one run that a row has caused; it is recorded before the launch and counts toward the row's attempt limit unless a refund gives it back. In a gate, a trial is one repetition of a scenario, and an attempt is one try at a trial, with a world built from scratch under its own tag; an infrastructure failure earns the trial one more attempt. | [Scheduler and outbox](./2-system.md#scheduler-and-outbox), [Gate M6](../infra/GATE.md#gate-m6) |
| **attention** | The state the system keeps for a situation that needs consideration, until the situation is resolved. It lives in a native Notion discussion, an attention thread (also called an attention episode), and the `attention` class of the App MCP writes the system's comments there. | [Active attention — native Notion discussions](./2-system.md#active-attention--native-notion-discussions), [Discussions as the attention layer](./2-system.md#discussions-as-the-attention-layer) |
| **binding** | The installation's record of how the canonical model sits in its Notion workspace: which database is each type, which property carries each field and which option id each status has. It holds identifiers only (`infra/notion/mapping.yaml`, outside git), and the running App reads only the binding. | [Onboarding mapping](./2-system.md#onboarding-mapping) |
| **capability** | A thing the system does, owned by one module: App code is grouped by capability, and each capability checks, applies and shows its own kind of write. The App MCP exposes capabilities in classes (attention, capture, continuation, delivery, approval, memory, introspection). | [App MCP — runtime/control interface](./2-system.md#app-mcp--runtimecontrol-interface), [ADR 0011](./decisions/0011-capability-modules-over-platform.md) |
| **continuation** | A durable record that the system will look at a thread or a page later: a `scheduled_checks` row with a time (`run_at`), a reason (`reason_code`) and, once a conversation has taken place, the thread's `discussion_id`. It carries only identifiers; the run it starts reads the current state again. | [`scheduled_checks`](./2-system.md#scheduled_checks) |
| **digest** | A hash that identifies content without storing it. A run's trace keeps the digest of the plugin directory the run loaded, a gate verdict names the digests of the Skill, the result schema and the gate code, and the OAuth tables keep digests of codes and tokens in place of the secrets. | [Skill layer contract](./2-system.md#skill-layer-contract), [Gate M6](../infra/GATE.md#gate-m6) |
| **disposition** | What happens to a claimed queue row after its run, chosen once from the run's outcome for every run source: the row is concluded, released unchanged, released with a reason, released with its attempt refunded, or sent to wait for Notion. | [Scheduler and outbox](./2-system.md#scheduler-and-outbox) |
| **evaluation window** | The `evaluation_windows` row that collects the events of one Notion page. There is one open window per page; each further relevant event is absorbed into it and pushes its end back, and when the window comes due, one run evaluates what changed. | [`evaluation_windows`](./2-system.md#evaluation_windows) |
| **evidence** | The support a claim needs before the system acts on it. Each detector label states what evidence it needs, and a notification requires that the claim has enough support; when the evidence is insufficient, the result is `no_action` or a scheduled recheck. In the methodology, a Key Result is evidence of progress on an Objective. | [Detector ontology — label semantics](./3-policy.md#detector-ontology--label-semantics), [Intervention policy](./3-policy.md#intervention-policy), [Stopping conditions](./3-policy.md#stopping-conditions), [Level 2 — Objectives & Key Results](./1-methodology.md#7-level-2--objectives--key-results) |
| **fate** (of a proposal) | What a proposal has become: `approved`, `rejected`, `executed`, `conflict`, `failed` or `expired`. The person's decision and the non-execution of what was approved are written to the proposal's thread, and the message in the channel is rewritten with the fate next to its line. | [Approval differs by who performs the write](./2-system.md#approval-differs-by-who-performs-the-write), [ADR 0043](./decisions/0043-proposal-fate-in-thread.md) |
| **gate**, **gate run** | A gate is a milestone's acceptance test: a command from `app/test/gate/` that runs the real Skill on real connectors and writes a verdict. The project maintainer launches it, and one launch is a gate run (`./bin/gate m5`). A scenario's status over its trials (`Standing` in the code) is `proven`, `failed`, `error` or `not_proven`. The scheduler's checks before a run are the run gates, listed separately. | [Running the gate](../infra/GATE.md#running-the-gate) |
| **Inbox item**, **parking** | An Inbox item is a captured input on which no decision has been made yet. It has no status: it exists while it is unresolved and goes to the trash once it is resolved. Parking is the chat writing into the Inbox what a conversation left unresolved, in the bot's name and with a comment that gives the reasoning (`park_inbox_item`). | [Resolvability model](./3-policy.md#resolvability-model), [Conversation trigger](./2-system.md#conversation-trigger) |
| **installation owner** | The person whose system it is: their Notion workspace, their subscription token and their data. The installation serves only that person, and the documents also call them the owner. | [Roles](#roles) |
| **item of attention** | What a continuation is about, and what the queue keeps one open wake for: an attention thread, identified by its `discussion_id`, or, when no conversation has taken place yet (a deadline follow-up, a safety recheck), the pair of page and reason code. | [`../contracts/canonical.yaml`](../contracts/canonical.yaml), key `scheduled_check` |
| **lease** | The time-limited hold a queue row is under while a worker is on it: claiming sets `locked_until` to a time in the future. A lease that expires releases its row automatically, so a crash loses nothing, and the claimant's `locked_until` stamp lets only the lease owner record an outcome. | [Scheduler and outbox](./2-system.md#scheduler-and-outbox) |
| **origin** | Where a run came from: the class of the row behind it (a change in Notion, the person's reply, an Inbox item the person added, a continuation, a scheduled review) or the operator's manual launch. Every run has exactly one origin, and the origin decides its priority class and whether it counts against the daily limit. | [Run priority](./2-system.md#run-priority), [Observability and cost](./2-system.md#observability-and-cost) |
| **perimeter** | The limit of what a run can reach: the three MCP servers and `Read` in the plugin directory. The pair of `allowedTools` and `permissionMode: 'dontAsk'` sets it, and the runner checks it against the tools the run actually received. | [Tool surface boundaries](./2-system.md#tool-surface-boundaries) |
| **precondition** | A condition in a proposal under which the change is still the one the person was shown: the page exists, a property equals or reads as a value, a property is empty, or the page is unchanged since a time. The executor checks it again on a freshly read page before it writes, and a precondition that no longer holds ends the proposal in `conflict`. | [Preconditions and executor](./2-system.md#preconditions-and-executor) |
| **reconciliation** | The periodic App job that finds threads the person has resolved in Notion, which sends no event for it, and requests closure for them: a closure-processing run then reads each thread and writes its facts, events and decisions to memory. | [Resolved-thread reconciliation](./2-system.md#resolved-thread-reconciliation) |
| **run** | One invocation of the Claude Agent SDK by the App: a separate process with one session and several turns of the model, started from a trigger envelope. | [Path App-triggered Claude](./2-system.md#path-app-triggered-claude), [Observability and cost](./2-system.md#observability-and-cost) |
| **run gates** | The checks the scheduler makes before it claims a row: the runner and its Notion MCP grant are ready, the plan quota is open, the breaker and the daily limit allow autonomous work, and a slot is free. Closed gates write nothing to the rows, and a row waits as it was. | [Run priority](./2-system.md#run-priority) |
| **run source** | A run queue as the scheduler sees it, through a single port: it retires rows that will do no more of their work, lists the due candidates, disposes of the claimed row after the run and prunes concluded rows. Evaluation windows, continuations and review occurrences are run sources. | [Scheduler and outbox](./2-system.md#scheduler-and-outbox) |
| **runner** | The App module that executes a run by calling `query()` from the Claude Agent SDK. The runner plugin is the local plugin directory a run loads, and `RUNNER_ENABLED` is the switch that turns the runner on. | [Claude runner](./2-system.md#claude-runner), [ADR 0013](./decisions/0013-runner-explicit-switch.md) |
| **Skill** | The prompt the model reads: the behavior contract that tells Claude how to route tools, apply permissions and detect situations. It has a chat entry in `plugin/skills/` and a run entry in `app/plugin/skills/`, and it implements the decisions that the documents make. | [Skill layer contract](./2-system.md#skill-layer-contract) |
| **snooze** | A time the person names for the system to come back to a thread, kept as a continuation with the reason `user_snooze`. Only the person sets it, and until it fires, reviews stay silent about that page and thread. | [Snooze](./3-policy.md#snooze) |
| **staged write**, **deferred write policy**, **immediate write policy** | A staged write is an App write that a run has recorded and checked but that is applied only when the run ends with a valid result. The deferred write policy (`StagedWrites`) holds a run's writes this way; the immediate write policy (`ImmediateWrites`) applies the chat's writes on the call, because the chat has no run result. | [App MCP](./2-system.md#app-mcp), [ADR 0014](./decisions/0014-app-effects-after-valid-result.md) |
| **standing authorization** | The person's permission, granted once and scoped, for a kind of write that the system makes without asking each time. `capture_policy` is that permission for capture: its switches say which writes the system makes from captured input without approval. | [Standing authorization `capture_policy`](./3-policy.md#standing-authorization-capture_policy) |
| **sweep** | The App's periodic pass over Notion that finds situations arising only from the passage of time or from a lost event, such as a `Waiting For` check date that has come or a deadline that has passed on an open Task. It wakes the page with a `safety_recheck` continuation, and the run decides what to do about the situation. | [Periodic safety sweep](./2-system.md#periodic-safety-sweep) |
| **toolset** | The tools a run may call, set per mode: each row of the mode → toolset matrix names bundles of capabilities for the Notion MCP, the GBrain MCP and the App MCP, and the bundles expand into the run's allow-set. A chat session has its own `chat_toolset`. | [mode → toolset](./2-system.md#mode--toolset) |
| **trail** | A comment the App leaves as the record of what the system did. On a proposal's thread the trail states the proposal's fate under a kind label (“Your decision”, “Outcome of the change”); on a trashed Inbox item, the origin comment records what the item became or why it was closed. | [Approval differs by who performs the write](./2-system.md#approval-differs-by-who-performs-the-write), [Resolvability model](./3-policy.md#resolvability-model) |
| **wake** | A continuation set to wake a thread or a page at its `run_at`: the App then starts a run for it, with the continuation's reason (`user_snooze`, `deadline_followup`, `await_external_event`, `safety_recheck`). A thread has at most one open wake. | [`scheduled_checks`](./2-system.md#scheduled_checks), [`../contracts/canonical.yaml`](../contracts/canonical.yaml), key `scheduled_check` |

## Reference direction — one-way

```text
1-methodology  ←  2-system  ←  3-policy  ←  4-acceptance  ←  5-plan
```

A document refers **only to the left**. `1-methodology.md` cites no one; its only external dependency is `contracts/canonical.yaml`. `5-plan.md` cites everyone.

The one-way rule applies to **normative content**: a document neither repeats nor redefines a fact that belongs to the document on its right. A reference that points to the right but carries no normative content is not an error. There are exactly two kinds of such references: a pointer to the owner of a fact (“`3-policy.md` owns the semantics of this”) and a pointer to a register that tracks a known defect or an open decision. When normative content diverges, the right-hand document is corrected and the left-hand one stays as it is.

`contracts/`, `infra/RUNBOOK.md` and `infra/GATE.md` are outside this chain: references to them come from everywhere. `infra/RUNBOOK.md` and `infra/GATE.md` do not refer to `docs/` at all; `contracts/` refers back: the `origin` field of each invariant names the existing section that states it. That reference is a pointer to the owner of a statement, not normative content, so it does not break the one-way rule. The registers of `5-plan.md` (of defects, gaps and risks) are referred to from everywhere in the same way.

## Where the “why” lives

The rationale for a rule lives in one place, **the rule's home**:

| What is justified | Home |
|---|---|
| policy: when the system acts, what it does and on what evidence | `3-policy.md` |
| mechanism: how a component is built and why it is built that way | `2-system.md` |
| the lifecycle of a status or value | a key of `contracts/canonical.yaml` |
| a choice between options | an ADR in `decisions/` |

Outside its home the rationale is not repeated:

- **a comment in code** contains the local invariant, the consequence of violating it in one sentence (“otherwise …”) and a reference to the home;
- **`///` in `schema.prisma`** says what the value means and gives a reference: these comments end up in the generated client and the container image;
- **a test docstring** says what the test enforces and which fault it catches;
- **`infra/RUNBOOK.md`** states the consequence for the operator; it does not refer to `docs/`.

A local technical rationale — a quirk of a library, the shape of a query, a workaround for a compiler limitation — stays in the code: it has no other home.

**Final state, not history.** A document and a comment describe the system as it is, and a decision in its final form, without the history of how it got there. They contain no “earlier — now”, “no longer” or “instead of the old one” comparisons, and they do not narrate migrations or changes in prose: the rationale is a property of the design as it stands, not a contrast with a superseded model. The counterfactual “otherwise X” is not history: it names the consequence the rule protects against. The rule applies across the whole tree, ADRs and appendices included. An ADR describes a decision that is in effect; a decision that is not in effect is deleted together with its ADR, and an ADR does not amend another ADR: a changed decision is rewritten where it lives. History lives in git. A migration file in `app/prisma/migrations/` is a schema change: its comment justifies that change, and once it is applied the file does not change.

A milestone is a unit of the plan, not a point in time. Outside the plan and the status line of [`README.md`](../README.md) it appears only as the name of its gate (“gate M3”): “measured at M0” becomes the claim itself, “rows older than M3” becomes a property of the rows, and “will appear in M3” becomes a statement of what exists. A future milestone is a pointer to the plan and stays in the text: “a consumer will appear in M10”. The status line in `README.md` says which milestones have their scope implemented. Whether a gate passed on a specific build is stated by that build's verdict, the result of a run; the documents do not contain it.

The registers of [`5-plan.md`](./5-plan.md) hold only what is open. An open entry says what remains open, not that it was narrowed. An entry that has stopped being open is removed from the register: the rule's home (the table above) states what holds, and the number is not reused. Code and other documents refer only to open entries. The origin of a value — where it was taken from or what it was combined from — is history too: the contract holds the value itself.

The unambiguous part of this rule is enforced by `app/test/contract/final-state.spec.ts`, even when a line break splits a phrase. The test flags words and phrases that narrate change (“the App now writes”, “as on the previous build”, “after the fix”, “following the audit”, “the old model”, “the previous form”, “was renamed”, “used to”, “merged from”), a status tied to a milestone, a completed milestone mentioned outside the name of a gate, and a closed register entry. This applies to the Skill as well: it is read by an agent for whom the history of the project is of no use. “Still”, “no longer”, “earlier” and “instead of” also have legitimate uses, in the behavior of the system and in a choice between options, so those words, along with any contrast with a superseded model, are left to review.

**When text and code diverge:**

- if the description of a mechanism has diverged from the code, the text is corrected;
- if the code does not meet the norm and the fix is small, the code is fixed, test first;
- if the code does not meet the norm and the fix is large, the norm stays, a gap or a defect is entered in the register of `5-plan.md`, and the text does not claim that the norm is met;
- if two norms contradict each other, the project maintainer decides; a discrepancy between values lives in the `conflicts:` block in `contracts/canonical.yaml`.

## Reference forms

One form for each kind of target:

| Target | Form |
|---|---|
| invariant | `INV-042` |
| document section — from code and contracts | `` `docs/README.md` § “Reference forms” `` |
| contract key | `` `contracts/canonical.yaml`, key `scheduled_check` `` (for several: `` keys `a` and `b` ``) |
| decision | `ADR 0011` or `` `D11` `` |
| RUNBOOK step | `RUNBOOK §6.2` |
| register entry | `DEF-nn`, `GAP-nn`, `` `Cn` ``, `SCEN-nn-nn` |
| document → document | an inline Markdown link with an anchor |

A section is referenced by its heading in typographic double quotes (“…”), not by number: section numbers in `docs/` change. `§N` is used only for RUNBOOK steps, where the number is part of the heading. The match ignores a heading's leading number. In the `origin` field of `contracts/invariants.yaml` the heading is written without quotes: the field already delimits the value.

An anchor is computed by the GitHub algorithm (`github-slugger`), not by a custom convention: the text is lowercased; punctuation is removed entirely; spaces become `-`; repeated `-` are **not** collapsed; hyphens and underscores are kept. Three consequences that look like errors but are not:

| Heading | Anchor |
|---|---|
| `### 11.3. Scheduled` | `#113-scheduled` — the period disappears rather than becoming a hyphen |
| `### 11.5. Someday/Maybe` | `#115-somedaymaybe` — the `/` disappears |
| `### App MCP — runtime/control interface` | `#app-mcp--runtimecontrol-interface` — a double hyphen in place of the dash |

A heading is renamed together with the references to it: the check described below catches a dangling reference.

The reference forms are checked by `app/test/contract/references.spec.ts` in `npm test`: a dangling reference fails the test just as a broken import does. Every form in the table is resolved, in code, contracts and normative documents. A reference that resembles one of these forms but does not match it is a violation in code and contracts; a section number outside RUNBOOK is a violation in the documents as well. A reference to a closed register entry outside the register itself is also a violation: that is history. The check does not see reference-style or HTML links, so they are not used.
