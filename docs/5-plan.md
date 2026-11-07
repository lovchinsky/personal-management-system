# Personal Management System — roadmap

> **Purpose:** the order of milestones and their gates, scope limits, the registers of open defects, gaps and risks  
> **Domain contract:** [`1-methodology.md`](./1-methodology.md)  
> **Technical contract:** [`2-system.md`](./2-system.md)  
> **Behavior policy:** [`3-policy.md`](./3-policy.md)  
> **Verification criteria:** [`4-acceptance.md`](./4-acceptance.md)  
> **Machine-readable contracts:** [`../contracts/`](../contracts/)  
> **Recorded decisions:** [`decisions/`](./decisions/)

## Document contract

This is the **only** document that maintains the order of milestones M0–M11, their gates and scope limits; each gate's criteria are given in the milestone itself.

Authoritative for: the sequence of milestones and their gates, spikes, scope limits, the register of defects and gaps.

This document creates no parallel methodology, behavioral specification or architecture. The domain rule is in [`1-methodology.md`](./1-methodology.md). The behavior policy is in [`3-policy.md`](./3-policy.md). The technical mechanism is in [`2-system.md`](./2-system.md). Priority: where the plan diverges from them, the plan is corrected.

The registers of defects and gaps list what is open; they are not work to do. A fix is separate work, and some entries are contradictions in which the choice of a side belongs to the project maintainer.

# Recorded decisions

Each decision lives in its own ADR in `docs/decisions/`. The `Key` column holds the decision's short identifier, which `contracts/*.yaml` and the prose use to refer to it.

| ADR | Key | Decision |
|---|---|---|
| [0001](./decisions/0001-notion-schema-growth.md) | `D1` | Growth criterion for the physical Notion schema |
| [0002](./decisions/0002-pluggable-notification-channel.md) | `D2` | Delivery through a pluggable `NotificationChannel` port |
| [0003](./decisions/0003-ngrok-single-public-base-url.md) | `D3` | Public HTTPS on the local machine is a tunnel; webhook addresses derive from one operator-set value |
| [0005](./decisions/0005-hidden-task-status-non-canonical.md) | `D5` | `Task Status = Hidden` as a technical status outside the domain |
| [0006](./decisions/0006-capture-with-immediate-clarify.md) | `D6` | Capture with immediate Clarify; `Inbox` = the set of what is unresolved |
| [0007](./decisions/0007-telegram-first-delivery-adapter.md) | `D7` | Delivery adapter — Telegram |
| [0008](./decisions/0008-runprofile-per-mode.md) | `D8` | `RunProfile` per mode; model and effort shared until calibration |
| [0009](./decisions/0009-agent-sdk-app-triggered-run.md) | `D9` | App-triggered run harness — Claude Agent SDK on a subscription token |
| [0010](./decisions/0010-date-and-deadline.md) | `D10` | Two time properties of a Task |
| [0011](./decisions/0011-capability-modules-over-platform.md) | `D11` | App modules: capabilities over a neutral platform |
| [0012](./decisions/0012-run-profile-and-plan-quota.md) | `D12` | Run profile — Opus 5.5 · high; an exhausted plan quota is a deferral, not a failure |
| [0013](./decisions/0013-runner-explicit-switch.md) | `D13` | Runner — an explicit switch, off by default; the gate starts runs itself |
| [0014](./decisions/0014-app-effects-after-valid-result.md) | `D14` | App effects are applied after a valid result |
| [0015](./decisions/0015-capabilities-own-run-writes.md) | `D15` | Capabilities own a run's writes; the write policy sits outside the transport |
| [0016](./decisions/0016-one-run-scheduler.md) | `D16` | One run scheduler |
| [0017](./decisions/0017-two-authors-of-notion-changes.md) | `D17` | Two authors of Notion changes |
| [0018](./decisions/0018-run-row-rules-in-runs.md) | `D18` | Run row rules live in `runs/` |
| [0019](./decisions/0019-config-in-owner-modules.md) | `D19` | Configuration lives in owner modules and arrives typed |
| [0020](./decisions/0020-skill-delivery-in-runs.md) | `D20` | Skill in an App run: dispatch by name and `Read` only in the plugin directory |
| [0021](./decisions/0021-chat-path-oauth-and-chat-toolset.md) | `D21` | The chat path: the App is itself the authorization server, and chat gets its own toolset |
| [0022](./decisions/0022-channel-text-recorded-in-notion-first.md) | `D22` | The person's reply in a dialogue the system started lands in Notion first, and only then does the model take it up |
| [0023](./decisions/0023-close-inbox-item-intent.md) | `D23` | Closing an Inbox item without a Task is an intent of the system |
| [0024](./decisions/0024-property-reads-as-precondition.md) | `D24` | Precondition `property_reads_as`: a filled property changes under a condition on its value |
| [0025](./decisions/0025-app-derives-delivery-key.md) | `D25` | The App derives the delivery key, not the model |
| [0026](./decisions/0026-separate-plugin-entries.md) | `D26` | Chat and the App run have separate Skill entries over a shared knowledge layer |
| [0027](./decisions/0027-methodology-layer.md) | `D27` | Methodology rules — a deterministic layer over the records read |
| [0028](./decisions/0028-closure-as-continuation-row.md) | `D28` | Thread closure — its own place in the continuation queue |
| [0029](./decisions/0029-ask-first-reconciliation.md) | `D29` | A closed Project: the system asks first, the person names `Failed`, dependency comes from relations |
| [0031](./decisions/0031-vendor-tools-denied-not-fatal.md) | `D31` | An unknown vendor tool is denied rather than stopping runs |
| [0032](./decisions/0032-next-action-no-date.md) | `D32` | A Task does not stay with `Next Action` and a date: the rule checks the result of the write |
| [0033](./decisions/0033-detector-activation-contract-key.md) | `D33` | A label's mode is a contract key; the schema holds the result's content; shadow is not raised |
| [0034](./decisions/0034-anchor-convention.md) | `D34` | Anchor: id in the frontmatter and in the body, slug from the id, identity as a pure function |
| [0035](./decisions/0035-gbrain-writes-by-voice.md) | `D35` | GBrain writes by voice: on its own behalf the system writes through an App intent, and conversation writes natively at the person's request |
| [0036](./decisions/0036-scheduled-reviews.md) | `D36` | Scheduled reviews: an occurrence is a period, not an instant |
| [0037](./decisions/0037-safety-sweep.md) | `D37` | Periodic safety sweep wakes `safety_recheck` continuations and remembers what it has raised |
| [0038](./decisions/0038-resolution-reconciliation.md) | `D38` | A resolved thread is found by time-based reconciliation |
| [0039](./decisions/0039-daily-review-proposals.md) | `D39` | Daily Control shows open proposals, and only what it showed expires |
| [0040](./decisions/0040-page-content-intake.md) | `D40` | An edit to the body of a Task or Project opens an evaluation window |
| [0041](./decisions/0041-gate-environment.md) | `D41` | The gate works in a separate environment |
| [0042](./decisions/0042-app-texts-language.md) | `D42` | The language of the texts the App writes to the person itself |
| [0043](./decisions/0043-proposal-fate-in-thread.md) | `D43` | A proposal's fate lands in its thread, and system writes carry a kind label |
| [0044](./decisions/0044-bounded-approved-actions.md) | `D44` | An approved action has an attempt limit, and the system closes a proposal the person got ahead of |
| [0045](./decisions/0045-notion-unavailability-and-person-timed-wake.md) | `D45` | Notion unavailability and a time the person named |
| [0046](./decisions/0046-system-voice.md) | `D46` | The system's voice: how Personal Management System speaks to the person |
| [0047](./decisions/0047-chat-and-runner-plugins.md) | `D47` | The chat plugin and the runner plugin are separate, and domain knowledge lives once |
| [0048](./decisions/0048-notion-workspace-contract.md) | `D48` | The physical Notion schema lives in the repository, and the App image's command and the gate build workspaces from it |
| [0049](./decisions/0049-assistant-name.md) | `D49` | Assistant name: an optional setting carried by the channel accounts |
| [0050](./decisions/0050-search-language.md) | `D50` | Search language: a built-in Postgres configuration or a hunspell dictionary of the installation |
| [0051](./decisions/0051-notice-about-the-system-has-no-link.md) | `D51` | A notice about the system carries no link |

---

# Milestones

Twelve milestones, M0–M11. Each has its own scope, gate and list of blockers.

**Gate and verdict.** The gate of milestones M3–M9 is an executable artifact: the criteria are in this document, the command is in `app/test/gate/`, and the procedure for running it is in [`infra/GATE.md`](../infra/GATE.md). Gate M1 is proven by the adapter's conformance tests and gate M2 by integration tests against a live database, both without the model; gate M0 is an interface audit and has no artifact in the repository. A verdict is the result of running the command on a specific build in a specific environment: it names the digests of the plugin directory (`skill`), the result schema (`schema`) and the gate code (`digest`), the model and the time zone, and is valid only for a build with the same digests. Verdicts and run logs are run artifacts (`gate-*.json`, `infra/gate/`) that live outside git: the documents do not restate them. A milestone is implemented when its scope is in the code, its gate and tests are in the repository, and the gate has passed on the released build; for a build of one's own, that build's verdict says whether the gate has passed.

## M0 — Interface audit

**Depends on:** —

**Scope:** verification of external contracts; measured values in `contracts/canonical.yaml`; the integration harness. To verify: the Notion comments API (create a page-level thread, reply, resolve, read resolved threads); the catalog of webhook events and whether `authors` is present; `page.created` for the Inbox data source; whether moving a page to the trash through the API is reversible; headless Notion MCP OAuth PKCE; the GBrain MCP surface and the exact-identity path; the Agent SDK with a plugin directory and remote MCP servers. The shape of the App MCP's auth is declared here; the App MCP itself is M3 scope, and gate M3 verifies it.

**Scope of the interface map audit**. The first result is a confirmed map of the real interfaces, not a prompt. What needs to be verified:

- the actual data sources for Levels 4–0 and the Inbox;
- property IDs, relations and the direction of traversal;
- the exact binding for `Task Status`, `Project Status`, `Behavior System Lifecycle` and `Area of Focus.Mode`;
- `Standard`, `Definition of Done`, Key Result evidence and the Task time fields;
- views and action surfaces for the Calendar, Available Now, Waiting For, Scheduled and Someday/Maybe;
- the capabilities of comments and discussions;
- Notion webhook subscriptions and events;
- the native Notion MCP tools and the OAuth path;
- the pinned GBrain version, its MCP operations, schemas and the exact-identity path;
- a snapshot of the Notion MCP `tools/list` over the same transport a run uses, and the `mcp_toolsets` entries for it;
- App MCP connectivity and auth, and the runtime capability surface;
- loading the runner plugin through the Agent SDK and the actual set of `tools` on the run's init message.

**Gate:** the integration harness performs a representative read in two external MCP domains — Notion and GBrain — and one policy-permitted native write in each. The App MCP is the system's own code; its reachability is proven by criterion 2 of gate M3.

**Agent SDK.** The gate proves the run's `init`: the plugin is loaded from the declared directory, and `tools` does not go beyond the three MCP prefixes, the declared harness tools and `Read` (`INV-049`, `INV-302`, `INV-306`, `INV-307`). The set of `tools` does not depend on the credential, while `skills` and `slash_commands` do ([“Run invocation”](2-system.md#run-invocation)). A run without a token on a machine with a logged-in `claude` gets “Not logged in”: the declared `env` is the subprocess's whole environment (`INV-306`).

Whether a subscription token is suitable for a server-side run without a person present is not confirmed: `GAP-14` (M11).

**Blockers:** none.

## M1 — Semantic adapter

**Depends on:** M0

**Scope:** retrieval of property and option IDs through REST; the capability model; `Date` and `Deadline`; the body parser; degradations derived from the binding.

**Gate:** the adapter resolves all the IDs of the section [“Entities in scope”](2-system.md#entities-in-scope); conformance tests reject an unknown status value, an unknown option in `Lifecycle` or `Mode` (instead of substituting a default) and `Waiting For` or `Scheduled` as a separate entity type.

**Blockers:** none.

The IDs the gate requires — including the option IDs of the eight `Task Status` values and the five `Project Status` values — come from the binding and are not stored in the repository.

## M2 — Runtime continuity

**Depends on:** M1

**Scope:** the Prisma schema and migrations; webhook intake; the scheduler and outbox; the channel port and the Telegram adapter; `pending_actions`, preconditions, the executor; the run budget; recovery.

**Implement and test before relying on proactive Claude behavior:**

- event deduplication;
- scheduled continuation;
- retryable delivery of notifications;
- the pending-approval lifecycle;
- recovery after a restart;
- self-loop suppression.

**Gate.** A synthetic test must prove:

1. a duplicate event does not duplicate a job or an effect;
2. a scheduled continuation survives a restart;
3. a duplicate notification does not create a second domain effect;
4. a logical delivery is queued once: parallel attempts to enqueue the same one collapse into one row.

**What proves it.** All four criteria are checked by integration tests against a live database, without the model:

| # | Evidence |
|---|---|
| 1 | `scen-19-32`: the same event twice yields one receipt, one window and one ledger row |
| 2 | `inv-212-continuation`: a row with an expired lease becomes claimable again, and an attempt is counted only when the row caused a run |
| 3 | `scen-19-44`: two presses yield one system write in Notion |
| 4 | `scen-19-33`: parallel enqueues of the same key collapse into one row |

The criteria are checked against a stub run port: gate M2 checks the mechanism, not the model's behavior. No run happens without the runner: while it is off ([ADR 0013](decisions/0013-runner-explicit-switch.md)), the origin waits, spending neither budget nor an attempt nor a ledger row.

Delivery on the wire stays at-least-once ([Telegram — channel adapter](2-system.md#telegram--channel-adapter)), so the gate checks that there is no second **domain** effect, not that there is no second message.

**Two limitations:** an action whose effect is **in the body** of a page cannot be proposed, and creating a page is not a declarable effect (`GAP-24`); [Preconditions and executor](2-system.md#preconditions-and-executor) explains why.

**Blockers:** none.

## M3 — App MCP and Agent SDK runner

**Depends on:** M2

**Scope:** the App MCP with tool classes as listed in `mcp_toolsets.app` and bearer authentication of the run (OAuth for chat is M4 scope, together with the chat path); a runner on the Claude Agent SDK (ADR 0009), enabled only by a switch (ADR 0013); `RunProfile` resolution (ADR 0012); the mode → toolset matrix; the envelope; validation of the result with the App's deferred effects (ADR 0014); traces.

**The App MCP over capability services.** The App MCP tools are a thin layer over the capability services: `AttentionService`, `CaptureService`, `ContinuationsService`, `DeliveryService` and `ApprovalsService`. The service itself validates the request and decides whatever cannot be left to the caller, according to who is acting (`Actor`): an admitted run (`AdmittedRun`) with its `id` and `provenance`, a person in chat or a person who pressed a button in the channel. Inspect operations (`get_*`) live in the services and answer in the capability's own shape; the tool's schema and the translation of the model's request live in the `*.wire.ts` of the same capability, for writes and reads alike (`INV-092`). `INV-030` limits the responses of these operations: `app_db` rows and retry bookkeeping do not reach the prompt. The tool by which the person decides on a proposal from chat is M4 scope, together with the chat path; the proposal row records the run that made it, because no step decides on its own proposal ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `pending_action`).

**Dependency and build.** `app/package.json` includes `@anthropic-ai/claude-agent-sdk`. The install does **not** use `npm ci --omit=optional`: otherwise the image has no CLI binary and the runner does not start. The binary is pinned to the SDK package version, so an SDK version bump changes the CLI; the version is raised by an explicit change to the manifest, not by a range (GAP-15).

**The shape of one run.** The runner builds exactly one SDK call:

- **plugin** — `plugins: [{ type: 'local', path, skipMcpDiscovery: true }]`: the same directory on disk that serves the interactive path;
- **three MCP servers** — entries `{ type: 'http', url, headers: { Authorization } }`; the App supplies each server's bearer from its own refresh state;
- **closed tool surface** — `tools: ['Read']` with an allow rule limited to the plugin directory, `disallowedTools`, `allowedTools` from the row of the mode → toolset matrix that names the tools one by one, `permissionMode: 'dontAsk'`. `disallowedTools` is **not optional** here: without it, all the tools of both servers are attached ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mcp_toolsets`), not just the ones the matrix row names. The runner builds it from the list of built-in tools reviewed for the pinned SDK plus the complement of the allow-set within the `mcp_toolsets` inventory;
- **reproducibility** — `settingSources: []` and `strictMcpConfig: true`: neither the machine's settings nor third-party servers reach the run;
- **per-run profile** — `model` and `effort` from `RunProfile`, alongside the `maxTurns` and `maxBudgetUsd` limits;
- **result** — `outputFormat: { type: 'json_schema' }`, with the schema emitted by zod in the draft-07 dialect;
- **trace** — the fields are taken from the run's result message: `session_id`, `modelUsage`, `num_turns`, `duration_ms`. `session_id` is the `id` of the ledger row, so a result with a different `session_id` is a technical failure ([Sessions](2-system.md#sessions)).

**Gate.** One run on real connectors proves five claims:

1. the plugin is loaded from the declared directory on disk (`init.plugins`); the plugin's skill surface is in gate M4, together with the Skill;
2. all three MCP servers are reached, with one representative read from each;
3. the result is valid against the json_schema, and an invalid result leaves no durable effects, neither App effects nor system writes in Notion; the comment of a valid run is written by the system, and Notion attributes it to the integration bot;
4. **no built-in tool except `Read` in the plugin directory is reachable** — `tools` on the init message contains nothing outside the three MCP prefixes, the declared harness tools and `Read`, and an attempt to call a built-in tool or to read outside the plugin directory fails. The criterion has two halves: `init.tools` does not go beyond the prefixes and equals the matrix row;
5. the trace contains `session_id`, `modelUsage`, `num_turns`, `duration_ms` and the resolved `model`; an unavailable model produces no fallback; the `INV-028` test passes.

That the trace fields are required is stated in the contract: [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_trace_fields` (`required_when`); the gate proves it on a live run.

**What the gate checks.** The command is [gate M3](../infra/GATE.md#gate-m3); the criteria are checked by live runs on real connectors (criterion 3 together with the system's writes in Notion):

| # | Check |
|---|---|
| 1 | `init.plugins` contains `personal-management-system-runner` from `/app/plugin`; the check skips the CLI's built-in plugins (`path: builtin`), because their set is not deterministic |
| 2 | all three servers are `connected` at init, and each server has been read from: `get_runtime_state`, `notion-fetch`, `whoami` |
| 3 | a valid run applies the system's comment and the deferred delivery, the comment first; the test page has exactly one comment, attributed to the integration bot; an invalid one, with evidence about something unread, is `failed`, and it has neither a delivery nor a comment |
| 4 | `init.tools` equals, character for character, the `event_evaluation` row together with `StructuredOutput` and `Read`; a run told to call `Bash` and read a file outside the plugin directory reaches neither |
| 5 | the trace contains `session_id` (the row's `id`), `modelUsage`, `num_turns`, `duration_ms` and the profile's model; a model that does not exist yields `failed`, and no other model takes up the work; `INV-028` passes |

A sixth check is a probe: the App MCP endpoint without a bearer answers 401. Public HTTPS for this endpoint belongs to M11.

**Blockers:** none. Open entries of the [defect register](#defect-register) and the [gaps](#gaps) that touch the run: DEF-29 (a domain response above the limit: the Skill's selection discipline), DEF-45 (a conclusion that is not recorded after the writes are applied causes the writes to be repeated), DEF-46 (a lost lease on the origin row does not stop the run), DEF-50 (a comment written before the failure to record its thread is outside what was applied), DEF-51 (messages without a run's `system/init` do not stop it), GAP-13 (managed policies: the consequences are visible in init, the set itself is not; M11), GAP-14 (the status of the subscription token for server-side runs; M11) and GAP-31 (a system comment without an idempotency key).

## M4 — Skill v1, dialogue, capture

**Depends on:** M3

**Scope:** the Skill source and the Plugin release as one directory for both execution paths; Capture / Clarify / Organize & Align; the full capture lifecycle.

**Gate.** The rows of [`SCEN-19-xx`](4-acceptance.md#1-required-scenarios--scen-19-xx) that concern dialogue pass, except the four [necessarily degraded ones](4-acceptance.md#four-necessarily-degraded-scenarios) (`SCEN-19-09`, `-20`, `-21`, `-22`); a resolvable input leaves no item; an unresolvable one leaves an item with a comment; a converted item is in the trash. The following is also proven:

- Claude Chat recovers bounded Notion and GBrain context;
- Capture does not perform premature classification;
- Clarify tells apart all the destinations of the list in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `clarify_destinations`;
- commitment detection checks for an equivalent object of the matching type, not only an existing Task;
- `Task Status` is determined by the workflow reason, not by the presence of any date;
- Organize & Align does not require an artificial full hierarchy;
- a future follow-up from chat is externalized through the App;
- a durable decision or fact is externalized to GBrain and does not stay only in chat;
- an explicit native domain write uses the original Notion or GBrain MCP operation, not an App facade.

**Criteria without an enforcement mechanism.** Three of the nine criteria are properties of the Chat path (bounded context, native write instead of a facade and, in part, capture). No milestone provides an enforcement mechanism for the Chat path: under “mode → toolset”, the owner defines the toolset on that path through the Plugin, and the policy is advisory. The criteria stay, but they are verified by the Skill instruction and the `path-parity rate` metric, not by a mechanism.

**Gate scenarios.** Fourteen gate scenarios run the real Skill on a live workspace with the runner enabled; the command is [gate M4](../infra/GATE.md#gate-m4-and-the-chat-path), and each scenario checks the effects of the run in Notion, not what the model says:

| Scenario | Expected effect |
|---|---|
| a vague item (`SCEN-19-01`) | stays an Inbox item with one system comment, no Task |
| a hard deadline (`SCEN-19-07`) | a `Next Action` Task with a `Deadline` and no `Date`, the item in the trash |
| tomorrow morning (`SCEN-19-08`) | a `Scheduled` Task with a `Date` and no `Deadline` |
| the Task already exists (`SCEN-19-02`) | no new Task, the item is closed as a duplicate |
| multi-step work (`SCEN-19-04`) | no Task, the item stays with a comment that proposes a Project |
| an idea with no commitments (`SCEN-19-05`) | a `Someday/Maybe` Task with no date |
| recurring behavior (`SCEN-19-06`) | no Task, the item stays with a comment |
| junk | a comment and the trash |
| an explicit fact from the owner | the fact goes to GBrain first, then a comment and the trash |
| a command inside an item | unrelated items are untouched, nothing is created |
| a channel reply “snooze until Monday” | the reply in the thread, a `user_snooze` for Monday, no Task |
| an invalid result | the item is intact, no comment and no Task |
| a Task change with no reason to say anything to the person (`SCEN-19-12`) | `event_evaluation` leaves no effect |
| a wait that holds (`SCEN-21-4`) | `scheduled_recheck` does not notify and does not change Notion; the only continuation is `await_external_event`, no sooner than an hour ahead |

The duplicate check needs the equivalent Task to be visible to Notion search, which lags behind page creation, so the gate gives it time, and the Skill additionally requires querying the Tasks data source.

**The chat path is a manual check** following the scenario in [gate M4](../infra/GATE.md#gate-m4-and-the-chat-path): a commitment without a direct command does not become a Task without consent, and an ambiguous “on Friday” is clarified (`SCEN-21-2`); a direct command is executed by a native Notion write with no extra changes (`SCEN-21-3`, `SCEN-19-43`); a follow-up is recorded in the App and confirmed after `applied` (`SCEN-21-4`, `SCEN-19-40`); without the App the model does not claim that the follow-up is saved (`SCEN-19-50`); a fact from the person's words is written to GBrain by a native operation; an unresolved thought stays an Inbox item with a comment.

**Gate limits.** claude.ai and Desktop need public HTTPS (`GAP-08`); the GBrain connector has no workaround (`GAP-08`); delivery of a notification to the person in Telegram is checked by `SCEN-20-21`.

**Blockers:** none. Open entries of the [gap register](#gaps) that touch M4: GAP-32 (an Inbox item that has become an object above a Task has no closing intent) and GAP-33 (chat consent rests on a single factor).

## M5 — Canonical domain behavior and vertical slice

**Depends on:** M4

**Scope:** seven Task statuses, five Project statuses, Available Now eligibility, suppression of the Tasks of a `Paused` Project, terminal-Project reconciliation, a `Done` Project with no conclusion about a Key Result; five Behavior System lifecycle states separate from automaticity, the `Mode` of an Area of Focus and the acceptable state from the GBrain anchor, the Objective and Key Result evidence model and review decisions without a separate state machine, Identity and Principle read and review without a score.

**Canonical domain rules before implementation**:

- seven Task statuses and two time properties of a Task;
- five Project statuses and the boundary of the work of a Project;
- five Behavior System lifecycle states, separate from automaticity and form;
- the `Mode` of an Area of Focus and the acceptable state from the GBrain anchor;
- the Objective and Key Result evidence model and review decisions without a separate state machine;
- Identity and Principle read and review semantics, without a score;
- Available Now eligibility;
- suppression of the Tasks of a `Paused` Project;
- reconciliation of the Tasks of a terminal Project;
- a `Done` Project without an automatic conclusion about a Key Result.

**Vertical slice**. One complete dependency scenario:

```text
detection
-> discussion
-> follow-through
-> user response
-> recheck
-> resolution
-> closure processing
```

This part proves the end-to-end lifecycle before the detector ontology is extended.

**Gate:** the scenario [`SCEN-21-1`](4-acceptance.md#scen-21-1--dependency-from-a-notion-event) passes end to end on a real workspace, and so do the non-degraded rows of `SCEN-19-xx`: Task status semantics including `Date` and `Deadline`, the Project lifecycle, `Paused` suppression, terminal-Project reconciliation, Available Now eligibility, dependency detection, structural contradictions on a Task (discrepancies at the Project level fall under `project_integrity`).

**Where the rules live.** The deterministic layer [`methodology/`](decisions/0027-methodology-layer.md) answers questions about a record that has been read: whether a Task is open or closed, a candidate for Available Now or excluded from it, what is left to settle in a closed Project, where a Task's status and its dependency disagree. Capture, the gate and, later, traversal and reviews use the same code, and the Skill describes the same rules for the model. The agreement test catches a discrepancy in the lists of statuses, in the ways to settle a Task of a closed Project (the code and the contract), in the list of blockers that resolve a dependency and in the Skill's key phrases; it does not prove the content of the rest of the Skill's sentences.

**Identity read and review.** The prose of an Identity lives in the page body (`page_body`, `G16`): querying by it is impossible, so the detector reads it in a Deep Review and does not filter by it.

**Gate scenarios.** The model-free check and nine scenarios run the real Skill on a live workspace; the command is [gate M5](../infra/GATE.md#gate-m5); each scenario checks the effects of the run in Notion, not what the model says:

| Scenario | Expected effect |
|---|---|
| model-free check | the `Blocked` signal agrees with the dependency rule for a blocker that is open, `Done`, `Failed` or `Canceled` and for a Task with two blockers; an approved status change that clears the date reaches Notion as a system write; a closure request schedules a continuation with the `closure_processing` mode, and the closure and the wake of one thread do not displace each other; a channel reply opens its own window; an anchor page is written to GBrain, found by searching for the Project's id and deleted |
| dependency (`SCEN-21-1`, `SCEN-19-11`) | the check date has come due, the deadline is near, there is no other path: the run names the dependency, finds the Project's anchor in GBrain by exact id and quotes it, writes one comment in the thread and sets a follow-up no sooner than an hour ahead; after the person's reply it proposes exactly one change, `Done`; the status is not written before approval; the approval and the executor write it; the recheck wakes no one; once the person has resolved the thread, the closure writes no comment or proposals, and no pages or links in GBrain, and does not move the status |
| alternative path (`SCEN-19-10`) | `Waiting For` stays, nothing is said on the Project, no notification |
| paused Project (`SCEN-19-15`, `-16`) | no statuses are rewritten, nothing is proposed, the Task with a deadline is mentioned to the person; the check date is not a candidate |
| closed Project (`SCEN-19-17`) | one comment names each unfinished Task, no statuses are changed; after the person's reply, one proposal for each named Task |
| structural contradiction | `Waiting For` with a `Done` blocker is named with evidence from both sides, the status is not changed |
| Identity without a score (`SCEN-19-23`) | a single failure does not change, comment on or remember either the Identity or the Area of Focus |
| the person's decision in a resolved thread (`SCEN-19-31`) | the closure writes a fact or an event to GBrain (the trace does not keep the content of the call, `GAP-07`); there are no comments, proposals, notifications, pages or links, the status is not changed |
| healthy Area of Focus (`SCEN-19-19`) | nothing is said or proposed on the Area of Focus, no Objective is written |
| Key Result evidence in the person's own words | Objective and Key Result are not changed, nothing is proposed |

**Gate limits.** The gate does not exercise the flow's ingress — the Notion webhook, relevance selection and the evaluation window: it wakes the run with the event the window would have composed. A thread cannot be resolved through the Notion API, so the operator performs the two closure steps (`--manual`). Notion sends no resolve event: a resolved thread is found by the App's resolved-thread reconciliation, while gate M5 requests closure directly through `requestClosure`; gate M8 proves the reconciliation. Available Now in Chat is checked by hand.

Acceptance rows that the gate does not prove:

- `SCEN-19-18`: world S4 has no Key Result, so nothing shows that “the Project stays `Done`, and the achievement of the Key Result is not derived”;
- `SCEN-19-20`: the claim of the healthy Area of Focus scenario does not see that the acceptable state and `Mode` belong to the `Area of Focus` record;
- `SCEN-19-21`: the row is `degraded (G12)`; gate M5 does not require it, and there is no scenario for it;
- `SCEN-19-22`: the Key Result evidence scenario shows only that the system changes nothing and proposes nothing; a review decision proposal needs a carrier for the decision (`G13`);
- `SCEN-19-30`: the closure claim forbids pages and links in GBrain but not a fact or an event, since `SCEN-21-5` allows an event, so “routine closure writes nothing” is not proven;
- `SCEN-21-5`: the closure scenario has no Project and no anchor, so the closure's reading of the Project and of prior evidence is not proven; besides, the procedure reads GBrain only when there is something to save, and only to avoid duplicating it, not before a decision, as step 1 of the row says.

**Blockers:** none. Open entries of the [register](#defect-register) and the [gaps](#gaps) that touch M5: DEF-52 (an evaluation window holds one thread per page) and GAP-35 (Skill behavior outside the gate scenarios).

## M6 — Universal Detector

**Depends on:** M5

**Scope:** proactive behavior covers `untracked_commitment`, dependency, narrow `deadline_risk`, high-confidence `project_integrity`, structural `contradiction` and high-confidence `forgotten_context`. The rest go into review packets or shadow mode. `unclarified_input` works on stale Inbox items and surfaces in Daily and Weekly Control; it is not a proactive notification.

**Activation order.** Proactive behavior is activated first for:

```text
untracked commitment
dependency
narrow deadline risk
project integrity
structural contradiction
high-confidence forgotten context
```

`unclarified_input` is handled in the Inbox and in reviews. Behavior System friction, Area of Focus risk, Objective evidence change and resource conflict work in review packets. General stagnation, opportunity and self-regulation inference remain shadow/user-led categories until the quality of evidence is sufficient.

**Gate:** the six listed categories are active in proactive mode, the rest in review packets or shadow mode according to the split above; no generalized psychological claim from a single episode.

The check of gate M6 measures both parts of the gate through the Skill's behavior. In the first part, proactive labels are raised where they apply (U1, W1, P1, K1, F1), and review-level and shadow labels are not (B1, A1, X1 and the negative recognition shared by every scenario). In the second part, diagnostic words in the texts of a run are flagged (`flags`), but the gate issues no verdict on a “generalized psychological claim”. Because a word without context does not prove one, a person reads the texts, and `accepted` is impossible without that reading.

**Gate M6 check.** The gate command measures the Skill's behavior on a live workspace: each scenario attempt builds a fresh world under its own tag, wakes a run with an event on a page or with the person's reply in the channel, and reads the effects the run wrote. The command and the launch procedure are in [gate M6](../infra/GATE.md#gate-m6). Observations come in three kinds, and diagnostic words get a separate flag:

| Kind | What it is | Violation |
|---|---|---|
| `perimeter` | what the App and the toolset guarantee: statuses unchanged, no new pages, at most one notification, the follow-up offset, pages untouched | fails the verdict as an App regression, not a Skill one; in the comparison, a separate rule with no confirming repeat, outside the behavior pools |
| `effect` | the model's choice, with zero tolerance: silence where the right answer is silence; a proposal only for the dependent Task; foreign writes; identifiers and label names in the text for the person | a violation in any judged attempt → `failed` |
| `recognition` | a share of at least two thirds of the judged attempts (rounded up) and at least two thirds of the trials in which all of the scenario's recognitions held together; positive polarity means the label is raised, a comment exists and the source is quoted; negative means the label is not raised | below the share → `failed` when enough are judged to prove it, otherwise `not_proven` |
| `flag` | not an observation but a flag in the artifact: diagnostic words in the texts of a run | does not fail `ok`, but `accepted` is impossible until a person has read the words |

Blocking scenarios are run `--trials` times and recorded ones `--recorded-trials` times (once by default). The trials rotate through all the scenarios. A scenario's `proven` status needs at least two judged trials when more than one is requested. A run that ended in an infrastructure failure does not count as judged and is repeated once; a harness fault in the scenario description is not repeated. The verdict contains the digests of the Skill, the result schema and the gate (all the gate modules, the App tools and the surfaces the model sees), as well as the model, the date, the day of the week and the time zone. The comparison refuses to compare verdicts that differ in gate, schema, model or time zone. Names in the gate world (Notion pages, GBrain slugs, the event identifier) do not refer to the gate or the scenario, because the model sees the names.

| Scenario | World and event | Measures |
|---|---|---|
| U1, U3, E1 | in a thread on a Task the person says they promised to send an offer (tomorrow; with no date; in English) | `untracked_commitment`: one comment in this thread that names the promise; no new pages |
| U2, U4 | an equivalent Task already exists in another Project; an intention instead of a promise | no label; for U2, also that the run searched for the equivalent |
| U5 | a third party made the promise | no expectation: the norm has not decided whether to raise a label for someone else's promise; the run is recorded in the artifacts |
| W1 | a `Waiting For` Task, the date has come due, the deadline in two days: an event; the same event with a new id; a recheck with the deadline “tomorrow” | `dependency` and `deadline_risk`, one comment and one notification per situation, a follow-up; the repeat stays silent; the recheck names the risk or notifies; `project_integrity` is not raised |
| N1, N2, N3 | a deadline in two days and a free `Next Action`; the deadline has passed; `Scheduled` with a date earlier than the deadline | `deadline_risk` only where it exists; silence in N1 |
| P1, P2, P3 | the last Task is done; `Planning` with a clarifying Task; all open Tasks are waiting or scheduled | `project_integrity` only in P1 |
| K1 | a `Next Action` with an open blocker | a `contradiction` that quotes both sides |
| F1, F2 | a constraint lesson in GBrain about this Project; a page of another Project on the same topic | `forgotten_context` in F1 with both halves; no label in F2 |
| B1, A1, X1 | a Behavior System `Installing` with one failed instance; an Area of Focus under `Advance` that has only done and `Someday/Maybe` Tasks; a `Someday/Maybe` with an opportunity window | restraint: review-level and shadow labels are not raised, nothing is left for the person |
| Q1, L1 | a routine edit in a Project of twelve Tasks; twelve Tasks and a hidden alternative | Q1: silence, no label and no continuation; L1: no deadline risk |

**Candidate comparison with the baseline.** The gate is a smoke acceptance test, not a comparison tool: N = 3 distinguishes only large differences. A separate command conducts the comparison under a rule fixed before the candidate is run, on scenarios that have at least two judged trials in both verdicts: (1) `effect`: zero violations where the baseline has zero; a suspicion is settled by a repeat of the candidate at N = 5 (at least two violations and a share above the baseline's); (2) `perimeter`: no new violation, and a repeat does not refute it, because a perimeter violation is an App regression; (3) `recognition` item by item: an item that held in the baseline keeps holding (otherwise a repeat at N = 5); (4) `recognition` in two pools, the positive and negative polarities separately: the share averaged over scenarios is not lower than the baseline's by more than ten percentage points, scenarios have equal weight, and an item shared by every scenario does not go into a pool; (5) the target observations of the Skill's changes: no worse as a pool, and where the baseline is below a hundred percent, better in at least half of such items; (6) duration and calls per run over the shared steps, without failed runs: no more than fifteen percent worse, and the shares of rejected results, failed runs and runs that hit the turn ceiling within tolerance; (7) a person reads the texts of the scenario pairs. A confirming repeat must be a repeat of this candidate: the same Skill, gate, schema, model and time zone. A `PASS` conclusion is possible only on the full set: a stopped verdict, or a blocking scenario without two judged trials in both verdicts, yields `INCOMPLETE`, not `PASS`. The comparison is a tool against regressions, not a condition of acceptance: the Skill is accepted on the gate's own verdict.

**Gate limits.** The norm for a third party's promise (U5) and for `unclarified_input` is open: the gate only records the behavior. No gate checks delivery through real Telegram automatically: `SCEN-20-21` needs a configured channel.

**Blockers:** none. Open entries of the [defect register](#defect-register) and the [gaps](#gaps) that touch M6: GAP-06 (eval dataset design: shadow categories leave no record, and the metrics exclude gate runs with their own instructions) and GAP-35 (Skill behavior outside the gate scenarios).

## M7 — GBrain knowledge lifecycle

**Depends on:** M5

**Scope:** canonical anchors, exact identity, structural-first retrieval, timeline, fact and decision writes, approval thresholds for lessons. The canonical types are `project`, `behavior_system`, `objective`, `area_of_focus` and `identity`; a Key Result has no anchor of its own. The Project → Key Result traversal is native; a graph link remains for relations that Notion does not express.

**Implement**:

- a convention for canonical anchors;
- verification of exact identity;
- structural-first retrieval;
- timeline, fact and decision writes;
- an approval threshold for lessons and cognitive observations.

Anchors and graph relations use the canonical types `project`, `behavior_system`, `objective`, `area_of_focus` and `identity`.

**Gate:** routine Task completion creates no memory noise; two exact anchors produce an integrity warning with no automatic choice.

**Gate M7 check.** The gate command measures how the Skill uses GBrain memory on a live workspace and a live GBrain: whether it finds an anchor by exact id, whether it writes only what is worth keeping, and whether it leaves memory untouched where the right answer is to write nothing. The harness is the same as in gate M6 (attempts, trials, digests, three kinds of observations), and the run evidence also includes the state of the memory pages before and after the run and the GBrain calls with their arguments. The command and the launch procedure are in [gate M7](../infra/GATE.md#gate-m7). Before the first quota is spent, a model-free check proves, on a live GBrain, the assumptions the scenarios rest on.

| Scenario | World and event | Measures |
|---|---|---|
| H1, H2 | a completed Task of a Project that is moving; the person's reply, which only clarifies a date | nothing is written to GBrain, the anchor is as it was |
| H3 | two anchors with the same id exist for a Project, and a note that mentions the id | nothing is written, no anchor is quoted, the run says there are several pages |
| H4, H5 | the person made a decision; the same decision is already recorded | H4: one `Decision:` event on the anchor, with a source and no text lost; H5: nothing is added |
| H6 | the person states a fact about a customer | one fact with the anchor as its entity, the page text intact |
| H7 | a decision about a Project that has nothing in memory yet | the App creates an anchor by convention, with one `Decision:` event on it; no other anchor is touched; the person is told nothing about the memory store |
| H8 | a missed repetition of a Behavior System; the history holds one similar event | nothing is written or proposed, no friction label |
| H9 | a lesson on a page linked to the anchor, and a lesson from a similar Project | `forgotten_context` quotes the right lesson, structure comes before free search, the anchor's links are read from both sides, at most four GBrain calls |
| H10 | the person says what is acceptable for the Area of Focus | recorded: a `Standard:` fact of kind `preference` on the Area of Focus's anchor |
| H11 | the person formulates a lesson in a thread on their own | recorded: one fact in the person's words on the Project's anchor, no lesson page |

**Gate limits.** The chat path (a memory write by an App intent from the conversation, a replacement of compiled truth, a lesson after confirmation, links) is guarded by unit and contract tests: a manual walkthrough would write to real memory. A memory write at thread closure (`closure_processing`) falls outside gate M7: H4–H7 and H11 go through the person's reply path, and S6 of gate M5 needs `--manual` and a person who resolves the thread. Refusals of a memory intent (several anchors, a foreign page at an anchor's address) are proven by the App's unit tests; H3 shows that a run in a world with several anchors leaves memory as it is. Stopping a write to GBrain at the run's deadline is proven by unit tests; the gate scenarios work with a fast GBrain. The lesson and cognitive observation thresholds are checked from below the threshold (H8: one episode leaves memory as it is); a write after the threshold and confirmation needs two real episodes in memory, and the scenario worlds have one each. The gate measures a link that points from an anchor to a page by the shape of the call (H9: links are read from both sides); in the scenario worlds the link points from the lesson page to the anchor. The search delay after a write to a page is `GAP-40`.

**Blockers:** none. Open entries of the [gap register](#gaps) that touch M7: GAP-35 (Skill behavior outside the gate scenarios), GAP-37 (facts with no entity stay in `gbrain_db`), GAP-38 (GBrain writes are not committed), GAP-39 (a GBrain upgrade) and GAP-40 (search after a write to a page).

## M8 — Time-based cognition and reviews

**Depends on:** M6

**Scope:** periodic sweep, safety reconciliation, four review workflows; stale Inbox items go into review packets (the sweep does not wake them); `objective_evidence_change` in the strategic review packet. The L2 structure is incomplete: Key Result evidence and a review decision have no carrier (`G13`), so the detector reacts to structural changes.

**Implement**: a bounded periodic sweep and safety reconciliation for lifecycle states that can become a risk without a new user edit, as well as the review workflows:

- `daily_control`;
- `weekly_control_review`;
- `strategic_review`;
- `deep_review`.

Review scopes and cadence stay distinct; the daily workflow does not load Identities and Principles without a concrete need.

Safety reconciliation also handles the closure of resolved threads: when Notion emits no separate event for a resolve, the reconciliation finds the thread and requests closure through `requestClosure`.

**Gate:** the Weekly Control Review covers the scope of [`SCEN-21-8`](4-acceptance.md#scen-21-8--weekly-control-review); Daily Control does not load the whole backlog and shows the stale Inbox.

**Gate M8 check.** The gate command measures scheduled reviews, the periodic safety sweep, the reconciliation of resolved threads and ingress by page content, using the real Skill on real connectors. The harness is the same as in gates M6 and M7 (attempts, trials, digests, three kinds of observations); each mechanism runs the way it does in normal operation: a review is driven by an occurrence row, the sweep and the reconciliation by a real tick, and ingress by a Notion event. Reviews read the databases in full, so before every attempt the gate checks that the gate environment holds only what was seeded: two stale Inbox items. Their capture time is given by the gate's overlay on the contract schema, so the seeded items are stale immediately. The run evidence also includes the pages read (from the attempt's stream) and the packet as the channel will render it; the gate manages the Notion MCP query allowance as an environment resource. The command and the launch procedure are in [gate M8](../infra/GATE.md#gate-m8).

| Scenario | World and event | Measures |
|---|---|---|
| C1 | three system threads on three Tasks; the person resolves one, the gate deletes the comment of another; reconciliation ticks | exactly one closure request, for the resolved one; the open one and the deleted one get none; a repeat stays silent |
| D1 | a Daily Control over a day with time-fixed commitments, Available Now, a backlog without dates, a paused Project, an Identity, stale items and an open proposal | the backlog and the Identity are not loaded; the day's commitments are named, Available Now is a selection, stale items are reported as a count, the proposal comes with buttons |
| W1 | a Weekly Control Review over the scope of `SCEN-21-8` without step 8 (there is no carrier for Key Result evidence: `G13`) | labels with evidence for every object; ≤ 2 new threads, only on pages with a finding; proposals only on pages with a finding, without `Failed`, and `Next Action` for a Task with a completed blocker; the calendar, an item that waits for a reply, and `Next Action` for the week |
| S1 | a Strategic Review of two Objectives with the person's words about a Key Result and a time limit | Key Result evidence comes only from the person's words; no proposals; every Objective and Area of Focus is named, the remaining Key Results are asked about; a resource conflict with evidence |
| SW1 | a `Waiting For` Task whose `Date` comes due and whose deadline is tomorrow, with no thread and no event | the sweep wakes exactly this Task, a repeat stays silent; the run names the dependency and the deadline risk |
| X1 | a promise to a client in the body of a Task, and a moved `Deadline` | the evaluation window contains both kinds of events; the run reads the body and raises `untracked_commitment` |
| S2 | recorded: two episodes with a common cause on the Project's anchor | one question about a lesson, nothing written |
| DP1 | recorded: an Identity with Principles and one `Failed` Task | only the packet, no comments, proposals or labels |

**Blockers:** none. Open degradations that touch M8: `G9` (the `Standard` of an Area of Focus lives in memory) and `G13` (an Objective decision and Key Result evidence have no carrier).

## M9 — Approvals by behavioral criteria

**Depends on:** M6

**Scope:** behavioral approval criteria over the executor and `pending_actions`, both implemented in M2.

**Gate.** It is proven that:

1. an autonomous proposal is not executed before approval;
2. an explicit instruction from the person can authorize the exact requested write without redundant confirmation;
3. delayed approval survives session and process boundaries (restart);
4. changed preconditions yield `conflict` instead of stale execution;
5. **a pending contract contains the changes themselves in canonical terms and is executed as a system write, not by the App's own domain operation;**
6. what the person rejected is not proposed again without new evidence.

**Criterion 5 is not cosmetic.** It forbids the App from creating a domain-operation surface of its own.

**Gate M9 check.** The gate command measures the proposals that runs make and the person's decisions on them, using the real Skill on real connectors. The harness is the same as in gates M6–M8, with its attempts, trials, digests and three kinds of observation. Every step takes the same path as in normal operation. Delivery goes through the queue worker to the Bot API listener of the gate environment, and a button press goes to the App's own webhook. An edit and the person's words in Notion are made with a personal token and arrive as an event at the same ingress as the webhook's. The executor and publication ticks are run by the same workers as in normal operation. The approval chain is proven by model-free checks, the model's behavior by scenarios AP1–AP4. The command and the launch procedure are in [gate M9](../infra/GATE.md#gate-m9).

| Criterion | Proven by | Kind |
|---|---|---|
| 1 not executed before approval | the “approval chain” check; AP1–AP4: an executor tick after every run, the proposal waits, the page is unchanged | perimeter |
| 2 a direct instruction: exactly one write | the manual walkthrough of the chat path CH1 ([gate M9](../infra/GATE.md#gate-m9)); on the run path, AP4: the scope of the proposal | effect |
| 3 approval survives the session and the process | AP1: the button on the proposal of run 1 after run 2; the process: `proposal-restart.spec.ts`; chat: CH3 | perimeter |
| 4 changed preconditions → `conflict`, not a stale write | the “outpaced proposal” and “not written” checks; AP2: a new proposal based on the live page (`INV-027`) | perimeter, effect |
| 5 the system write is exactly what was approved | the “approval chain” check: the property difference is exactly the contract's effect, no other pages are touched, the editor is the bot; canonical effects of the model's proposals (AP1, AP4); the App has no domain operation of its own: `inv-086`, `inv-028` | perimeter |
| 6 what was rejected is not proposed again | AP3 | effect |

| Scenario | World and event | Measures |
|---|---|---|
| AP1 | a `Waiting For` Task in a Project with other work; the person says “done” in the channel; then “yes” to the notification; then the button | exactly one `Done` proposal, only on the Task; “yes” is not a decision; a button on a proposal from an earlier conversation executes exactly that proposal |
| AP2 | a `Waiting For` Task with a `Date`; “I can get started”; the person sets `Scheduled` themselves; then, in the thread, “let's do it now” | `Next Action` with `Date` cleared by one contract; the outpaced proposal is a `conflict` with no trail; a new proposal based on the live page |
| AP3 | a `Waiting For` Task whose blocker is `Done`; the system's proposal is rejected; a recheck comes due | the rejected change is not proposed again, and there is no notification about it |
| AP4 | a `Next Action` Task with a `Deadline`; “move the deadline to <date>” | exactly one proposal: `Deadline` → the named date, with the current deadline as its precondition (`INV-211`) |
| AP5 | recorded: the control for AP3, the same world without the rejection | the recheck proposes `Next Action`: without this, the silence of AP3 distinguishes nothing |

**The chat path is a manual walkthrough**, CH1–CH3 ([gate M9](../infra/GATE.md#gate-m9)). In CH1, one `Deadline` write is made in the first reply; its author is the person, and there are no proposals. In CH2, nothing is written until the person agrees, and after “yes” exactly `Status` → `Done` is written. In CH3, the page, field and value come first, with no decision; after “approve it” the decision is recorded, the executor makes the change as the bot, and the proposal's fate is in the thread.

**Gate limits.** Closing a thread in S1 and S6 of gate M5 needs `--manual`. The gate does not check how natural the voice is ([ADR 0046](decisions/0046-system-voice.md)): the person judges it from voice samples.

**Blockers:** none. Open entries of the [gap register](#gaps) that touch M9: GAP-41 (lost integration access has no signal), GAP-42 (a wake that the runner is not ready to start waits silently), GAP-45 (a write that Notion did not accept when it was applied is a failure) and GAP-46 (a channel reply that Notion will never accept is lost silently).

## M10 — Evals and calibration

**Depends on:** M7, M8, M9

**Scope:** a replay dataset (real + synthetic), the metrics [`SCEN-12-xx`](4-acceptance.md#5-implementation-plan-metrics--scen-12-xx), a gate on changes to Skill instructions, the model, thresholds and budgets.

**Change policy**: changes to Skill instructions, detector thresholds, retrieval budgets or intervention policy are accepted only after comparing eval results.

**No gate.** M10 has no completion condition: it has a policy (“changes are accepted only after comparing eval results”), not a criterion. Writing the gate is blocked by GAP-06 (the eval dataset design does not exist) and by the risk `S8` (the volume of personal data is too small for threshold statistics).

**`model` under the eval gate.** A change of model is on the list of changes accepted only after comparing eval results ([ADR 0008](decisions/0008-runprofile-per-mode.md), risk `S7`).

## M11 — Production

**Depends on:** M10

**Scope:** [“Part I. Installation”](../infra/RUNBOOK.md#part-i-installation) on a server through `./bin/dcp` — RUNBOOK §1–8, from the requirements to verification and the runner; production gates G1 and G5–G16; a backup and restore drill.

**Gate: not duplicated here.** The criterion lives entirely in [“Production readiness”](4-acceptance.md#6-production-readiness--scen-64-xx): sixteen gates and 33 `SCEN-64-xx` rows.

**Blockers:** DEF-27 (destructive steps run without confirmation that the App has stopped and that the environment is the right one) and the gaps whose “Blocks” column names M11: GAP-03, GAP-07, GAP-08, GAP-13, GAP-14, GAP-16, GAP-19, GAP-22, GAP-25, GAP-33, GAP-38, GAP-41, GAP-42, GAP-46.

## Dependency graph

```text
M0 → M1 → M2 → M3 → M4 → M5 ┬→ M6 ┬→ M8 ┐
                             │      └→ M9 ┼→ M10 → M11
                             └→ M7 ───────┘
```

---

# Spikes

Open risks and unverified assumptions. A number stays with its entry and is never reused, so gaps in the numbering are normal. The “State” column says what mitigates the risk or where it is resolved.

| # | Risk | Consequence | State |
|---|---|---|---|
| S6 | A tunnel address that changes | breaks the Notion webhook subscription, Telegram's `setWebhook` and the chat connection | mitigated by [ADR 0003](decisions/0003-ngrok-single-public-base-url.md): the webhook addresses derive from one variable, `APP_PUBLIC_BASE_URL`, and the chat connection takes `APP_MCP_URL` and the GBrain variables (`GBRAIN_PUBLIC_URL`, `GBRAIN_MCP_URL`) |
| S7 | Plan quota consumption and latency per run | every relevant change means a model call drawn from the same quota the owner uses | mitigated by the relevance gate and the run budget; a model is down-shifted only on the basis of the M10 evals |
| S8 | Calibration on a small volume | there are no statistics for thresholds: a personal workspace has tens of records, not thousands | synthetic scenarios in M10 |
| S12 | The claude.ai connector against the App's authorization server: dynamic client registration from claude.ai's addresses, PKCE and the code exchange over public HTTPS | the assumption is that claude.ai completes the OAuth flow as its connector documentation describes; a deviation is corrected in the address allowlist or in the token endpoint's response | a manual check per [gate M4](../infra/GATE.md#gate-m4-and-the-chat-path); needs public HTTPS (`GAP-08`) |

---

# Out of scope

Gmail, an external Calendar provider, browser history, location, messengers in general. Growth of the physical Notion schema beyond the criterion in ADR 0001. A multi-instance App and an external queue. A mobile client.

---

# Defect register

The register keeps only what is open. An entry's number is stable and is never reused, so gaps in the numbering are normal. An entry says what remains open. Code and other documents refer to an entry by its number; the rule in force lives in the rule's home ([Where the “why” lives](README.md#where-the-why-lives)).

The boundary with the register of conflicts runs as follows. [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `conflicts`, holds discrepancies between contract values where both variants are internally consistent and the project maintainer chooses the winner; each has a milestone in the `resolve_in` field. What goes here is what is false or cannot be executed as written — regardless of how many sources state it — and contradictions between norms in prose, where the project maintainer also chooses the side (`DEF-18`). A fact lives in exactly one of the two registers.

| ID | Statement |
|---|---|
| **DEF-18** | Domain templates name fields for which no physical model exists, and treat the removal of a field in different ways. Three divergences are listed below. |
| **DEF-27** | **Destructive steps of the production procedures run without confirmation that their preconditions are actually met.** A restore stops the App container and runs a `pg_terminate_backend` sweep, but **nothing checks that the App has actually stopped**. The `./bin/dcp` wrapper is unconditionally production (`--env-file .env.prod -f compose.yaml -f compose.prod.yaml`) — no step confirms that the environment is the one the operator thinks it is. |
| **DEF-29** | A tool result over the CLI limit is written to a file and replaced with an error that names the path to it. The limit is 50,000 tokens (`MAX_MCP_OUTPUT_TOKENS` in the declared `env`), and above it there is a second CLI layer: output over ~100 KB is stored in a file, and the model sees only a preview. `Read` in an App-triggered run is allowed only in the plugin directory, so Claude cannot read this file: a Notion or GBrain response over either layer is a dead end with no recovery inside the run. No mechanism prevents this; there is only the Skill's retrieval discipline. |
| **DEF-33** | **The norm requires reading `Effort points` as evidence, but the adapter does not read it.** The adapter reads properties by the id that the binding names. `Effort points`, a select field that the person fills in, has no canonical slot, so the rule in [“Physical schema properties that determine the adapter”](2-system.md#physical-schema-properties-that-determine-the-adapter) requiring it to be read as evidence is not met. |
| **DEF-45** | **If the conclusion is not recorded after a run's writes are applied, the origin row goes back in the queue and the writes can be applied a second time.** The dispatcher applies the run's staged writes before it writes the conclusion to the ledger. If the conclusion write fails, the scheduler requeues the origin row with a reason, and after the lease expires the same origin gets a new run in which the writes are applied again. The idempotency key guards delivery against a repeat, the effects fingerprint guards an open proposal, a continuation collapses into a single thread row, and a comparison with what is already recorded on the anchor guards a memory write about a Notion object. Nothing guards a comment (`GAP-31`) or a memory write with no object; that memory write is applied first. |
| **DEF-46** | **A lost lease on an origin row does not stop the run.** Recording an attempt is a fenced update of the row: if the lease has already been taken away, the update changes nothing; the queue only logs a warning (`LeaseQueue.warnLost`), and the dispatcher goes on to launch the run. Meanwhile another tick may claim the row, and the same origin will get two runs. |
| **DEF-50** | **If the registry write for a comment's thread fails, the comment already written to Notion is missing from what was applied.** `AttentionService.comment` writes the comment to Notion, then records the thread in the registry of discussions, and only then returns the id. If the registry write fails, the comment is already in Notion but is not among the run's applied effects: the run trace has no record of it, and a retry of the run will write it a second time. |
| **DEF-51** | **`assistant`, `user` and `result` messages with no preceding `system/init` do not stop the run.** The observer stops a run only on an init that failed its checks. An init that never arrived is noticed by the classifier at the end (“the run reported no init”), so a run with no verified perimeter runs through all its turns up to the result. |
| **DEF-52** | **The evaluation window holds one thread per page, and the events of two threads on the same page are folded into it.** There is one open window per page, and its `discussion_id` is the thread of the latest event (`COALESCE`). The person's reply in a managed thread A and a comment in thread B on the same page produce one window, and the run's trigger envelope names B: the run sees the reply in A only as part of the page. Closure of a resolved thread does not depend on the window: it goes through its own `scheduled_checks` row (`ADR 0028`). Gate M5 does not combine two threads on one page. |

## DEF-18 — domain templates without physical encoding

The page body is read in full, so the question “which section is under which heading” is not at issue: the prose that the templates name as separate fields shares one carrier, and the model tells the parts apart.

The divergences are fields that the templates propose and the physical model lacks entirely:

1. **The review decision of an Objective and Key Result evidence.** The template has `Review notes` and the list `Continue / Adapt / Pause / Abandon / Achieved`; there is no carrier for either the decision or the arrival of evidence (`G13`). The L2 structure is incomplete.
2. **Optionality versus capability.** The templates open with the line “fields that do not help make decisions can be deleted”. `INV-009` reads the absence of prose as the capability `empty`. One document proposes deletion as hygiene, another treats it as a missing capability. The boundary between them is not drawn.
3. **The CBT/Behavioral Experiment template has no physical counterpart.**

No alignment is made until the project maintainer decides which side prevails.

---

# Gaps

Open questions for which the corpus has no norm or mechanism: what the system cannot do or what is not defined. These are not defects. There is no contradiction here: the answer itself is missing. The number is stable and is never reused.

| ID | Gap | What is known | Blocks |
|---|---|---|---|
| **GAP-03** | A pause on proactive work only, set by the owner | Switches exist: `RUNNER_ENABLED` stops all runs, `WORKERS_ENABLED` all background work, and the circuit breaker and the daily limit (`daily_limit`) stop budgeted origins automatically. The owner cannot set a pause that stops only proactive work and leaves replies to the person's words alone | M11 |
| **GAP-06** | Eval dataset design | A “replay dataset (real + synthetic)” is named, but there is no design. `detections` live as a document in the result, while per-label metrics need rows (`INV-083`); shadow categories leave no record, so no examples of them accumulate; gate runs with their own instructions include invented detections, and the metrics exclude them | M10 (without it, gate M10 cannot be written) |
| **GAP-07** | Trace retention and the position on PII | A run trace contains the conclusion (claims, evidence, messages) and a snapshot of its launch; tool calls (`run_tool_calls`) hold only metadata: server, tool, success. Call payloads — the full content of the Notion pages read and of the GBrain responses — are not stored and are deferred until this decision is made. The retention rule must take into account that the database makes the snapshot mandatory: it does not accept a completed run without init, report and result, and deleting a ledger row takes the trace with it by cascade. Neither a retention period nor a position on PII is defined. Unlike GAP-16, where retention is on the providers' side, here it is in the App's own `app_db` | M11 |
| **GAP-08** | Installing the plugin into chat clients from the installation's marketplace is not proven | The installation's marketplace is a separate repository with one file following the template `infra/marketplace.example.json`, whose entry points to `plugin/` through `git-subdir` with a pinned `sha` and contains the addresses of the installation ([RUNBOOK §6.4](../infra/RUNBOOK.md#64-app-mcp-and-chat)). Claude Code loads an enabled plugin automatically, as `personal-management-system@synced`, or the `plugin/` directory through `--plugin-dir`, where `.mcp.json` takes the addresses from the variables `APP_MCP_URL` and `GBRAIN_MCP_URL`. GBrain does not support dynamic client registration, so its connector has its own client (`gbrain auth register-client` with `--redirect-uri`). It is not proven that claude.ai and Desktop accept a marketplace entry with `git-subdir` together with the connectors, or that the plugin works with them in chat | M11 — together with public HTTPS (G10) |
| **GAP-13** | Managed organization policies over programmatic options | Managed organization settings take precedence over the options passed in the runner's code, and the CLI itself loads them. The runner cannot see what init does not show (the `effort` level, search isolation), nor the set of policies in force itself | M11 — a policy can change the behavior of a run without any change to the code, and part of this is visible only through its effects |
| **GAP-14** | Suitability of the subscription token for an unattended server run | `CLAUDE_CODE_OAUTH_TOKEN` is documented for Claude Code in CI; the Agent SDK hosting page does not cover it. Anthropic documents running an agent under one's own subscription, and the subscription's terms of use describe ordinary individual use. Technically a run under the token works, but no source confirms the token's suitability for a run with no person present on the server | M11 — the answer is needed before the runner works continuously on a VPS |
| **GAP-15** | The Agent SDK CLI binary under the eval gate | The binary arrives through optional dependencies and is pinned to the SDK package version, so an SDK upgrade changes the CLI along with it. It is not stated anywhere whether a CLI change falls under the comparison of eval results on a par with a change of prompt or thresholds | M10 (whether a CLI change goes through the comparison of eval results) |
| **GAP-16** | Data retention on the providers' side for the App-triggered path | An App-triggered run sends model traffic to `api.anthropic.com` under the plan quota and tool traffic from the container to three MCP hosts, while GBrain sends the text it indexes and searches to Voyage AI, for embeddings and rerank. It is not established which part of this is stored, for how long and under what contract. This holds for the model traffic under a subscription token, for the content passing through the hosted Notion MCP endpoint and for the text going to Voyage AI. The content here is the owner's entire personal management system: Tasks, Projects, page bodies, discussion threads and what GBrain returns about people and decisions. Unlike GAP-07, which concerns the retention of the App's own traces and the position on PII, here it is retention on the providers' side | M11 — the answer is needed before the system handles real data continuously, not after |
| **GAP-18** | The gate does not cover lanes other than `ci-contract` | The model-free run (`npm test`) checks only the entries of the `ci-contract` lane (`SCEN-12-01`); entries that need a model (`eval`), services outside the App's own database (`integration`) or human judgment (`manual`) have no gate, and for release criteria the gap is wider: `app/test/contract/registry.spec.ts` derives the distribution by lane and the number of entries with an existing check. The enforcement boundary of the chat path rests on the Skill instruction and the `path-parity rate` metric: the owner determines the chat toolset. The system's capture path is enforced by a mechanism, the App's conversion, while `INV-211` is in the `eval` lane. | M10 — the gate is defined together with the eval procedure |
| **GAP-19** | Encryption and offsite transfer of backups | The backup matrix (RUNBOOK §9) requires an encrypted copy off the machine for the environment file, `gbrain-repo` and `gbrain_home`, and [gate **G15**](4-acceptance.md#sixteen-gates) requires encrypted offsite backups for all persistent state. The RUNBOOK procedures have one path off the machine: `git push` of the committed `gbrain-repo` (RUNBOOK §12). The environment file, the `app_db` and `gbrain_db` dumps and the `gbrain_home` archive remain local files: there is no encryption command, no place to keep the key and no way to transfer them off the VPS. RUNBOOK §9 names a separate contract for retention, encryption and the recovery key and does not define it | M11 — G15 and `SCEN-64-29` cannot be passed by following the documentation, and `SCEN-64-32` (restore drill) has nothing to restore from offsite |
| **GAP-22** | Rotating `APP_ENCRYPTION_KEY` without re-authorization | The `SecretBox` version prefix names the algorithm, not the key, so a string sealed with a prior key does not open after rotation and is indistinguishable from a tampered one: GCM yields the same refusal in both cases. There is neither a `key_id` in the string nor a re-encryption pass: a new key means re-authorizing every connector ([RUNBOOK §6.3](../infra/RUNBOOK.md#63-notion-mcp-grant)) | M11 — together with the rest of the key storage questions (`GAP-19`) |
| **GAP-24** | Page creation is not once-only | The provider offers no idempotency key for page creation, so creation is not a declarable effect of a proposal: the page that the action will create does not exist before the write, and a precondition has nothing to look at. A failure between creating a Task by converting an Inbox item and moving the item to the trash fails the run, and a retry may create a second Task | returns when creation accepts an idempotency key from the client — or when the system creates a page with a machine marker property that lets the system query for it again |
| **GAP-25** | Stalled work has no signal: `failed` with no reader | The `failed` status means “the system took it on, could not do it and stopped trying”. No one reads the `failed` rows in `evaluation_windows`, `notification_outbox` and `webhook_receipts`, or in `scheduled_checks` with a reason chosen by the system: the reason is recorded (`last_error`), but neither the person nor the operator learns of such a row — a nudge that did not get through disappears without a trace | M11 |
| **GAP-31** | A system comment has no idempotency key | Notion accepts no idempotency key for a comment, and applying a run's writes is not atomic (ADR 0014): a run fails when the comment has been applied but the next write has not, and a retry of the origin may write to the same thread a second time | returns when Notion accepts an idempotency key for a comment — or when duplicates become visible in traces |
| **GAP-32** | An Inbox item that has become an object above a Task has no closing intent | Conversion creates a Task; closing without a Task has three reasons: `trash`, `duplicate`, `reference` ([ADR 0023](decisions/0023-close-inbox-item-intent.md)). When the person has decided in chat that the item is a Behavior System, Objective, Area of Focus or Identity, the system does not create those objects, and there is no way to close the item as “became X”: it stays in the Inbox with a comment until the person removes it themselves. A Project is an exception: its first Task is made by converting the item | returns together with a system intent to create objects of higher Levels |
| **GAP-33** | Consent to a chat connection rests on one factor | The owner proves identity with the owner passphrase from the environment: length, lockout after failures, an allowlist of return addresses, PKCE, a single-use short-lived code and a message about every consent close off guessing but not theft of the passphrase itself. Confirming the consent in Telegram is rejected ([ADR 0021](decisions/0021-chat-path-oauth-and-chat-toolset.md)): the chat connection would become dependent on a channel that may be unconfigured or unavailable | M11 — together with public HTTPS (G10) |
| **GAP-35** | Skill behavior outside the gate scenarios has not been checked on a live stack | The scenarios of gates M4–M9 run the real Skill on a live workspace: capture, Clarify and a reply in the channel; a dependency, a paused and a closed Project, a structural contradiction, an Identity without a score, and thread closure; proactive labels and the silence of review-level and shadow ones; use of GBrain memory; reviews, the sweep and the reconciliation of resolved threads; proposals and the person's decisions on them. The rest (a reminder that came due at a time the person set, addressing the assistant by name, detectors and situations outside the gate scenarios) is described in the run entry and the knowledge layer and is pinned down only by contract tests that check form: that the Skill names the same numbers, lists and capabilities as the contract. Whether the model behaves as this description says on live data is unknown, and assessing the quality of the descriptions and thresholds is left to the evals | returns with the evals and calibration (M10); a milestone with a behavior adds a live run of its scenario to its gate |
| **GAP-37** | Facts with no entity live only in `gbrain_db` | A `remember` with no `entity`, or with an `entity` that is not among the pages, is stored by GBrain only in the database: such a fact does not reach a page file, and `gbrain sync` from Markdown does not restore it. An unknown `entity` is accepted silently. This is how a fact that concerns no Notion object is written (closing an Inbox item as `reference`, a personal preference), since anchors exist only for Notion objects ([ADR 0035](decisions/0035-gbrain-writes-by-voice.md)). The `gbrain_db` backup is therefore unconditional. The remedy, when this is revisited, is a page for entities with no Notion object (a person, an organization, the owner) or the recording of such facts with an idempotent GBrain `capture`; neither is measured | returns with a decision on pages beyond the canonical anchors |
| **GAP-38** | GBrain writes are not committed, and restoring from Markdown sees only what is committed | GBrain's write-through writes pages, events and facts to the `gbrain-repo` files but does not commit. `gbrain sync` warns about uncommitted files and does not import them until the current tree is specified, and it deletes nothing. Apart from this, restoring `gbrain_db` from Markdown (RUNBOOK §15) loses everything written after the last commit. A snapshot with a commit is a manual procedure in RUNBOOK §12 | M11 — the frequency of snapshots and an encrypted copy of the file system (`GAP-19`) |
| **GAP-39** | Upgrading GBrain from the `0.48.5.0` pin is not assessed | Upstream has what the pin lacks: partial page editing (`edit_page`) and the idempotency key `request_id` for `remember`. What an upgrade would change in search by id, frontmatter indexing and the pack schema has not been established; the preflight of gate M7 measures these properties live, so an upgrade would show the discrepancy there. Until an upgrade, replacing a page in conversation remains a protocol, not a mechanism | M10 — whether a GBrain upgrade goes through the comparison of eval results (`GAP-15`) |
| **GAP-40** | GBrain search does not find a page by id after an event or a fact is written to it | On the pinned GBrain `0.48.5.0` with Voyage, immediately after `add_timeline_entry` or `remember` with an `entity`, the typed search by id stops returning the page for at least seven and a half minutes, although `get_page` by slug reads it at once. The probable cause is that the page is chunked again and the embeddings are computed with the provider's delays and retries. Topic search (free or semantic) does not see this page, and a duplicate without a conventional slug that was just appended to is not shown by search | M10 — whether a GBrain upgrade or another embedding provider removes the delay (`GAP-39`) |
| **GAP-41** | Lost integration access to a page or a database has no signal | The refusal classifier reads the Notion refusals 401 (`unauthorized`) and 403 (`restricted_resource`) as “no access”, and the readers skip the object: the sweep and the reconciliation of resolved threads until the next tick, the page-body edit ingress drops the event with a reason, the mapping for the model is left without names, and the binding check leaves the database among the unreachable ones. A revoked token or a page closed to the integration does not clear on its own, and neither the person nor the operator learns of it — the same root cause as `GAP-25` | M11 — together with the stalled-work signal (`GAP-25`) |
| **GAP-42** | A wake that the runner is not ready to start waits silently | A dead Notion MCP grant is a `runner_not_ready` denial and a disabled runner is `runner_absent`, both before the budget, and the origin row does not change (`INV-309`, `INV-084`): the wake does not become `failed`, so the wake-failure notice ([ADR 0045](decisions/0045-notion-unavailability-and-person-timed-wake.md)) is not sent. The person's reminder arrives as soon as the runner is back, and until then nobody says the reminder is running late; the warning about the grant ceiling is written only to the log | M11 — together with the stalled-work signal (`GAP-25`) |
| **GAP-44** | Whether to bring back a reminder the person did not answer | A reminder is sent once, and the system schedules no repeat after it: only a review brings a person who missed it back to the matter. The norm does not define whether an unanswered reminder must come back, and when | nothing — an open decision about behavior |
| **GAP-45** | An App write that Notion did not accept when it was applied is a failure, not unavailability | A run that read Notion, but whose writes the App could not apply because Notion had just stopped responding, fails: the attempt counts, the failure has no backoff pause, so the attempt limit runs out within minutes. The App does not read such a write as evidence of unavailability, because the run reached Notion and some of its writes may already have landed. The person's reply window in the channel can thus be retired unanswered | nothing — a narrow window between reading and applying |
| **GAP-46** | A channel reply that Notion will never accept is lost silently | Writing the person's reply to a thread fails with a refusal that will not clear on its own (the thread or the page has been deleted, the integration has lost access). This fails the receipt, and the provider repeats the delivery until it gives up: every retry fails the same way, and nobody tells the person anything. For a refusal that will clear on its own, the person is told at once “Send it again a bit later” ([ADR 0045](decisions/0045-notion-unavailability-and-person-timed-wake.md)); what to tell them here is not defined | M11 — together with the lost-access signal (`GAP-41`) |
