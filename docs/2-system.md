# Personal Management System — the system

> **Status:** the authoritative document for system mechanisms and boundaries  
> **External contracts baseline:** Notion API `2025-09-03`; Claude Agent SDK and CLI at the versions in `app/package.json` (`INV-305`); GBrain below  
> **GBrain baseline:** `v0.48.5.0`, commit: `GBRAIN_REF` in `infra/.env.example`  
> **Canonical lists:** [`contracts/canonical.yaml`](../contracts/canonical.yaml)

## Document contract

This document is authoritative for:

```text
system components and boundaries
topology and ingress paths
Plugin and Skill delivery model
MCP ownership and interfaces
state ownership
execution and approval mechanisms
authentication and credentials
persistence
networking
technical failure handling
external interface contracts and runtime baseline
```

This document does **not** define:

- canonical types, statuses, workflow modes, detector labels, budgets and permission class names: they have one source, [`contracts/canonical.yaml`](../contracts/canonical.yaml). This document describes their mechanics and ownership, but not the lists themselves;
- the domain ontology, canonical terminology, object and status semantics and the operating loop: they are defined by the methodology document. This document records their technical representation but does not create a parallel methodology;
- behavioral and product rules (detector evidence standards, attention lifecycle, intervention policy, memory-consolidation policy, user-facing permission semantics and scenarios): they are defined by the policy document;
- the Definition of Done, invariants, evaluation and acceptance criteria: they are defined by the acceptance document;
- deployment, configuration values, backups, recovery and operational runbooks: they are defined by the runbook documents.

The rule:

> When this document needs a domain rule or a behavioral policy, it refers to the relevant contract and does not redefine it. When another contract needs a mechanism, it refers here and does not duplicate the persistence and execution implementation.

### System purpose

Personal Management System is an always-available personal management system with proactive AI support. It applies the [methodology](1-methodology.md) and supplements human thinking where it systematically loses reliability: sustaining attention, prospective memory, recovering relevant context, keeping commitments under control, aligning direction with execution, supporting recurring behavior, detecting contradictions and returning in time to situations that need a decision.

The MVP must prove a specific operational capability, not the assistant's general “intelligence”:

> The system independently finds a situation that needs attention, recovers only the relevant context, applies the canonical classification and lifecycle rules, keeps the situation active until it is resolved and creates no parallel management, operational or semantic model alongside Notion and GBrain.

---

## Responsibility model

### General system model

Personal Management System consists of three layers: the central AI layer, authoritative systems and the control plane, and persistent infrastructure.

The central AI layer:

```text
Claude
+
Personal Management System Plugin
```

Authoritative systems and the control plane:

```text
Notion
= current operational truth

GBrain
= long-term semantic memory

App
= durable execution and control plane
```

Persistent infrastructure:

```text
PostgreSQL
├── app_db
└── gbrain_db

GBrain
└── gbrain-repo
```

The person has two first-class ingress paths.

Direct conversation:

```text
User
  │
  ▼
Claude Chat
  │
  │ Personal Management System Plugin
  │
  ├── App MCP ───────────▶ App
  ├── Notion MCP ────────▶ Notion
  └── GBrain MCP ────────▶ GBrain
```

Operational ingress:

```text
User
  │
  ▼
Notion
  │
  │ webhook
  ▼
Caddy
  │
  ▼
App
  │
  │ Claude Agent SDK
  ▼
Claude
  │
  │ Personal Management System Plugin
  │
  ├── App MCP ───────────▶ App
  ├── Notion MCP ────────▶ Notion
  └── GBrain MCP ────────▶ GBrain
```

These two paths are described from the person's side in [Entry points and trigger semantics](#entry-points-and-trigger-semantics).

The external channel (Telegram) is not a way for the person to enter the system but a continuation of a dialogue that the system started: the person answers with a button or with a reply to a system message. Such a reply is operational ingress too, but the App itself writes the person's words into Notion as a quoting comment in the thread the message belongs to, before the model's first step. Then the run opens an evaluation window, as it does for a Notion change. The person brings a new thought, command or topic to Notion (the Inbox, a discussion thread) or to Claude Chat; the channel does not accept them ([Telegram — channel adapter](#telegram--channel-adapter)).

GBrain also remains an independent MCP service:

```text
External authorized MCP client
  -> public HTTPS
  -> Caddy
  -> GBrain
```

Notion and Claude are externally managed systems. They are part of the system topology, but the Personal Management System infrastructure does not deploy them.

Production edge:

```text
Internet
   │
 HTTPS
   │
   ▼
 Caddy
   ├── api.example.com   -> app:3000
   │   ├── /webhooks/notion, /webhooks/telegram
   │   │                 -> provider event intake
   │   ├── /mcp          -> App MCP
   │   └── /oauth/*, /.well-known/oauth-*
   │                     -> chat authorization server
   │
   └── brain.example.com -> gbrain:3131
       ├── /mcp          -> GBrain MCP
       ├── /authorize, /token, /register, /revoke, /.well-known/oauth-*
       │                 -> OAuth GBrain
       ├── /health
       └── /admin        -> operator UI
```

The full list of public paths is in [Public surface](#public-surface); the remaining routes of both domains get `404`.

Local and production have the same logical topology: the same services and routes, and only the edge differs. On the local machine the App and GBrain listen on loopback, and the hosted Claude reaches the App MCP and the GBrain MCP through public HTTPS endpoints used in development — tunnels to each of them ([ADR 0003](decisions/0003-ngrok-single-public-base-url.md)).

The Notion MCP is hosted by Notion itself and does not pass through the Personal Management System's Caddy.

### Claude — central cognitive runtime

Claude is the central cognitive runtime and the system's only AI subject.

Claude is responsible for:

- understanding the current trigger or conversation;
- investigating through the available MCP tools;
- applying the cognitive and permission policy of Personal Management System;
- identifying relevant risks, commitments, contradictions and context;
- choosing the smallest useful intervention or effect;
- communicating with the person;
- deciding what must become durable operational state, a runtime continuation or semantic memory.

Claude itself is not a durable source of truth. Chat history is not Personal Management System state; see [Claude Chat history is not durable state](#claude-chat-history-is-not-durable-state).

In the MVP: **Claude + Personal Management System behavior contract.** Claude is the only AI subject. The Skill layer determines how it investigates a situation, reasons, chooses tools and applies policy.

The system's conversational interface is one assistant, the Personal AI Assistant, whose cognitive runtime is Claude. The person talks to it in Claude Chat, receives its messages in Telegram and reads its comments in Notion, whether the model or the App composed the text ([Language of texts for the person](#language-of-texts-for-the-person)). When Claude writes to Notion through the Notion MCP during a chat, at the person's request, Notion attributes the write to the person, under the person's name ([ADR 0017](decisions/0017-two-authors-of-notion-changes.md)). The assistant has its own name only when the installation owner has set one (`APP_ASSISTANT_NAME`): the owner gives that name to the Telegram bot and to the Notion integration, and the model gets it from `runtime_read` so that it understands when it is addressed by name. The name belongs to the user-facing level: it appears nowhere in code names, contracts, data or logs, and the places where the system is identified technically (the image, the plugins, the consent pages and the default name of the Notion MCP OAuth client) include the product name. The rationale is in [ADR 0049](decisions/0049-assistant-name.md).

### Personal Management System Plugin — canonical AI solution package

The Personal Management System Plugin is the canonical AI solution package of Personal Management System. It has two forms, both from one repository: the chat plugin, which Claude Chat installs from the `plugin/` directory through the installation's marketplace entry, and the runner plugin, which an App-triggered run loads as a local plugin in an Agent SDK invocation. Both rest on the same domain knowledge ([ADR 0047](decisions/0047-chat-and-runner-plugins.md)).

It implements, for the model, what the [methodology](1-methodology.md), the [policy](3-policy.md) and this document define:

- the system model of Personal Management System;
- the cognitive workflow;
- the rules for routing tools;
- the permission and approval rules;
- context and retrieval discipline;
- the detector ontology;
- memory policy;
- routing to the three MCP domains: App, Notion and GBrain.

The Plugin is stateless: it owns no operational, runtime or semantic state. It does not hold the credentials of the MCP connections either: on the App-triggered path the App supplies them ([Runner MCP connections](#runner-mcp-connections)).

### App — durable execution/control plane

The App is the system's durable execution and control plane.

The App is responsible for:

- webhook validation and idempotency;
- debounce and self-loop suppression;
- scheduling and continuation;
- technical retries and locks;
- notification delivery state;
- durable contracts for pending approvals and actions, when they are needed;
- the runtime/control tools of the App MCP;
- the authorization server for connecting Claude Chat to the App MCP: the App itself issues the tokens to the installation owner ([Authentication boundary](#authentication-boundary));
- launching Claude through the Agent SDK for non-conversational triggers;
- accepting the person's reply from the channel to a system message: the App itself writes the words of the reply into Notion, before the model's first step; the channel accepts text only as a reply ([Telegram — channel adapter](#telegram--channel-adapter));
- system writes to Notion, only through REST, as the integration bot: the App's own deterministic steps, a closed list of intents and the execution of an approved immutable contract ([System writes to Notion](#system-writes-to-notion));
- system writes to GBrain memory, by a memory intent: the object's anchor, created by convention, and an entry on it, in a run after a valid result ([Writes to GBrain](#writes-to-gbrain)).

The App contains no parallel Task/Project/Knowledge model.

In the MVP, the **App** is the durable execution and control plane: event processing, scheduling, retries, notification delivery and the lifecycle of pending approvals and actions.

### Notion — authoritative operational state

Notion is the authoritative system for current operational state.

It contains:

- Tasks, Projects and other operational objects;
- properties and relations;
- current statuses, deadlines and blockers;
- native discussions and workspace interaction.

Changes to Notion have two authors: the person, either directly in Notion or through Claude and the Notion MCP, and the system, which writes in its own name only through the App, as the integration bot ([System writes to Notion](#system-writes-to-notion)). Both change the same authoritative workspace.

In the MVP, **Notion** holds the current management and operational reality: all canonical objects of Levels 4–0, their properties, statuses and lifecycle, time constraints, relations, the Inbox, execution views and native discussions.

Notion represents the canonical five-level model (Levels L4–L0), from Identities & Principles to Tasks. The canonical list is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `levels`.

These Levels are types of managed objects, not a rigid tree. Relations can be many-to-many: a Task is not required to have a Project, a Project is not required to have a Key Result, and a Behavior System can support an Identity, an Area of Focus, a Key Result or a Project.

### GBrain — long-term semantic memory

GBrain is the long-term semantic memory system of Personal Management System.

It owns the semantic knowledge lifecycle and exposes a native MCP/HTTP interface.

Persistence inside GBrain:

```text
GBrain
├── gbrain-repo
│   └── canonical Markdown/frontmatter user knowledge
│
└── gbrain_db
    ├── derived knowledge/index state
    └── GBrain runtime/infrastructure state
```

`gbrain-repo` is a separate Git repository only in its role as GBrain's canonical file-backed knowledge store; it is not a peer subsystem of Personal Management System.

GBrain remains independently reachable by other authorized MCP clients.

In the MVP, **GBrain** is the long-term semantic memory: compiled understanding, evidence timeline, decisions, facts, lessons, people, organizations, concepts and graph context. GBrain stores long-term semantic knowledge: facts, decisions, explanations, experience, links and lessons.

### PostgreSQL — persistence boundaries

One PostgreSQL cluster contains two isolated databases:

```text
PostgreSQL
├── app_db
│   └── owner: app_user
│
└── gbrain_db
    └── owner: gbrain_user
```

`app_db` and `gbrain_db` are separate persistence boundaries, despite the shared cluster.

The roles and databases are created by `infra/postgres/init.sql`, together with GBrain's search configuration: the Postgres image runs it automatically at the first start on an empty volume. On every start the App itself brings the `app_db` schema up to date with its own image ([Startup and service dependencies](#startup-and-service-dependencies)); GBrain manages `gbrain_db` ([Runtime baseline GBrain](#runtime-baseline-gbrain)).

### MVP scope

The MVP covers four functional responsibilities: the Claude + Personal Management System behavior contract, Notion, GBrain and the App. They are stated in the sections above; the component topology is in [General system model](#general-system-model), and the three MCP interfaces are in [Three MCP interfaces](#three-mcp-interfaces).

The MVP does not include full integration with Gmail, an external Calendar provider, browser history, location or messengers in general. Calendar, as a methodological supporting structure, is part of the MVP through a configured Notion hard-landscape representation or another explicitly defined read surface. Adding provider sync in the future must not change the state-ownership model.

The MVP also does not:

- autonomously change Identities, Principles, the `Standard` and `Mode` of an Area of Focus, Objectives/Key Results or their review decisions;
- treat a Routine or a Habit as a separate lifecycle status or as a replacement for a Behavior System;
- create an Objective for ordinary maintenance or a Project for an unconfirmed future idea, or require manual confirmation of a Task instance where it changes no decisions;
- send messages to other people without the relevant authorization;
- draw generalized psychological conclusions from a single piece of evidence;
- forecast timing from invented effort or velocity estimates that are not in the authoritative operational data.

A separate proactive delivery provider is not defined by the behavioral contract. MVP acceptance requires at least one configured delivery channel through the App; the native Notion discussion remains the durable attention history regardless of a separate push channel.

### Claude Plugin architecture

#### Canonical package

Baseline logical package:

```text
<plugin-package>/
├── skills/
│
└── .mcp.json
```

This is the logical layout of the chat plugin. Its manifest is the installation's marketplace entry: only an installation's marketplace entry can carry the connector addresses that belong to the installation. The runner plugin has its own `.claude-plugin/plugin.json` and has no `.mcp.json`: the App owns the run's MCP connections.

#### Core component selection

The core Plugin baseline uses:

```text
skills/
.mcp.json
```

The core MVP deliberately does not depend on:

```text
commands/
agents/
hooks/
```

Reasons:

- new reusable behavior is packaged as Skills, not as separate flat commands;
- direct Claude Chat supports Plugin Skills and connectors, but core behavior cannot depend on Cowork-only sub-agent or hook execution;
- Personal Management System must remain one coherent Claude subject, not a collection of personas;
- detector categories are one reasoning ontology, not permanent detector agents.

The root `CLAUDE.md` is not the Plugin behavior contract. The canonical AI instructions live in `skills/`.

#### Delivery surfaces

Claude Chat:

```text
Claude Chat
  -> installed Personal Management System Plugin
     -> Personal Management System Skill layer
     -> 3 MCP connections, authorized by the person
        (App MCP — OAuth to the App's own authorization server)
```

App-triggered Claude:

```text
App
  -> Claude Agent SDK, the `query()` invocation
     -> the runner plugin as a local plugin
     -> Personal Management System Skill layer
     -> 3 remote MCP servers, declared by the App
```

Each surface loads its own plugin, and the domain knowledge is shared between them:

```text
plugin/                                        -> Claude Chat
   │
   └── knowledge ─┐ image build
                  ▼
app/plugin/  -> plugins: [{ type: 'local', path }]  -> Claude Agent SDK
```

The paths differ not in the knowledge but in who configures the environment. In Chat the person does it, through their own Claude setup. In an App-triggered run the App does it: the MCP servers, tool surface, permission mode, model and budgets are set by the invocation options, and plugin MCP discovery is off ([Run invocation](#run-invocation)). The Skill also reaches the model differently, and each plugin has its own entry for it. In Chat the `Skill` tool loads the `personal-management-system` entry by its `description`; in an App-triggered run the plugin command `/personal-management-system-runner:run` loads the run entry deterministically ([Run invocation](#run-invocation), [ADR 0020](decisions/0020-skill-delivery-in-runs.md), [ADR 0026](decisions/0026-separate-plugin-entries.md), [ADR 0047](decisions/0047-chat-and-runner-plugins.md)). The domain knowledge is shared by both entries and lives apart from them; the behavior is the same, and the text of neither entry mentions how it is launched.

The Skill makes no external API calls itself; Notion, GBrain and the App are accessible through MCP.

The App takes the path to the plugin directory from `RUNNER_PLUGIN_DIR` ([Configuration contract App](#configuration-contract-app)).

### Final system model

```text
                                  USER
                         ┌─────────┴─────────┐
                         │                   │
                         ▼                   ▼
                    Claude Chat            Notion
                         │                   │
                      Plugin                 │ webhook
                         │                   ▼
             ┌───────────┼───────────┐      App
             │           │           │       │
             ▼           ▼           ▼       │
          App MCP    Notion MCP  GBrain MCP  │
             ▲           ▲           ▲       │
             │           │           │       │
             └───────────┼───────────┼───────┘
                         │           │
                         │   Claude Agent SDK
                         │   + Personal Management System Plugin
                         │
                         ▼
                       Claude
```

Approval-required domain mutation and direct explicit domain mutation are covered in [Domain writes, approvals and execution](#domain-writes-approvals-and-execution).

---

## State ownership

The map of persistent state:

```text
App
└── app_db
    └── technical runtime / continuation / approvals / delivery

Notion
└── current operational truth + native discussions

GBrain
├── gbrain-repo
│   └── canonical Markdown/frontmatter knowledge
└── gbrain_db
    └── derived/index + GBrain runtime state
```

The system has four distinct classes of state. They are not mixed with one another, with one declared exception: the acceptable state of an Area of Focus is canonical semantics that the person puts into words during a review, and its only carrier is semantic memory (`kind: gbrain`).

### Management and operational state — Notion

Management and operational state answers the questions:

- what needs to be done;
- which object type and Level the record represents;
- which direction, responsibility, evidence or change mechanism it represents;
- which canonical status or lifecycle applies to this type;
- which dependencies and supporting relations exist;
- when time constraints apply;
- which review decisions or adaptations are needed.

This state lives in Notion properties, relations, records and canonical views.

Notion is authoritative for current operational state.

`app_db` and GBrain do not mirror current Notion objects to create a parallel domain model. The current properties and statuses of all canonical objects are read from Notion, not copied into GBrain or `app_db` merely for convenience.

The canonical semantic model of the MVP consists of the object types of Levels L4–L0 and the mandatory semantics of each type. The canonical list is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `levels`.

In brief, these are the semantics that determine ownership:

- `Identity` and `Principle` are a chosen orientation and decision rules, with no score;
- an `Area of Focus` is an ongoing responsibility; `Standard` and `Mode` are properties of this entity (the canonical `Mode` values are under key `levels.L3.area_of_focus_properties.mode`);
- `Objective` and `Key Result` are a meaningful desired change and observable evidence; Project completion is not evidence of a Key Result;
- a `Project` is a bounded multi-action commitment with one `Project Status`; the boundary of the work is described when it does not follow from the name and the makeup of its Tasks;
- a `Behavior System` is a recurring behavior design with a lifecycle separate from automaticity;
- a `Task` is the smallest trackable unit of work, with one `Task Status`.

The canonical `Project Status` is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `project_model`.

`Planning` is used only for an already accepted commitment and can have executable planning and clarification Tasks. `Paused` suppresses the linked Tasks in flexible execution views without changing their statuses in bulk. `Done` and `Canceled` are terminal; on the transition each unfinished Task is settled in one of the ways `project_model` names: `Done`, `Canceled`, `Failed` (set only by the person) or a re-link.

A Project uses progressive elaboration: it is not required to have a complete list of future Tasks. The known structure needed for a reliable next move is enough. Neither the absence of a complete plan nor the absence of a described boundary of the work is an integrity error; the absence of a clarification path in `Planning` or of a current Task path in `Active` is.

The canonical `Task Status` is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `task_model`.

These are mutually exclusive workflow statuses of one entity, `Task`. `In Progress` is not a status, and `Blocked` is a computed signal, not a status. If a Task depends on an external person, system, event or another Task, its status is `Waiting For`, and the dependency is additionally represented by a relation or a property. `Done` means that the work has been done, not that the desired outcome is guaranteed.

The time properties of a Task are not statuses; the canonical list is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `task_model.optional_time_fields`. There are two of them: `Date` and `Deadline`. `Deadline` does not make a Task `Scheduled`; `Date` on `Waiting For` does not change the status, because it marks the time to check the dependency, not the time the work becomes executable. Calendar contains the hard landscape, and `Scheduled` is a broader workflow status.

The canonical `Behavior System Lifecycle` is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `behavior_system_model.lifecycle`.

`Routine` and `Habit` describe the form and automaticity of execution, not the lifecycle. They are not stored in the same field as the lifecycle.

An Objective does not use a Task- or Project-style state machine. During a Strategic Review the canonical review decisions apply ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `objective_review.decisions`); `Pause` and `Adapt` are not terminal outcomes.

A Project has no date of its own: the timing of the work is expressed by the dates of its Tasks. `Decision Needed`, `Critical`, a quality criterion, a dependency or another implementation-specific signal can be separate properties only when they do not replace the canonical type and status semantics and actually change decisions.

Supporting structures are not Levels and are not separate stores: they are built on top of the same canonical databases. The canonical list and rules are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), keys `supporting_structures` and `supporting_structure_rules`.

### Active attention — native Notion discussions

Active attention answers the questions:

- which situation currently needs consideration;
- what the system has noticed;
- what the person has explained or clarified;
- whether the situation remains unresolved.

Durable attention lives in native Notion discussions. They are the durable operational attention surface when a situation must outlive the current chat.

One canonical Notion object can have several independent discussions, each with its own `discussion_id`. This lets one object have several independent attention episodes at the same time.

A discussion does not duplicate properties or relations. Its text contains a human explanation of the situation, questions, the reasoning, the person's answer and the result. System fields, lists of linked IDs, hidden headers and serialized machine state are not written into the comment text.

Notion attributes a system comment to the integration bot and a person's comment to the person: who is speaking in a thread is visible both to the person and to the event intake ([System writes to Notion](#system-writes-to-notion)).

### Long-term knowledge — GBrain

Long-term knowledge answers the questions:

- what must remain useful after the current operational episode ends;
- which fact, decision, lesson or historical event must influence future reasoning.

This state lives in GBrain.

A GBrain page combines compiled truth, the current generalized understanding, with a timeline of evidence and events. Operational details are not copied into GBrain merely because they exist.

```text
gbrain-repo
= canonical Markdown/frontmatter user knowledge

gbrain_db
= derived knowledge indexes + DB-only GBrain runtime and infrastructure state
```

Derived and rebuildable knowledge state can include:

- indexed pages;
- content chunks;
- embeddings;
- search structures;
- materialized graph state;
- derived indexes of facts, links and timeline.

DB-only runtime and infrastructure state can include OAuth clients and tokens, request and audit state, jobs and locks, sync checkpoints, migration state and site-local runtime config.

User knowledge can be re-derived in `gbrain_db` from `gbrain-repo` through GBrain sync or extraction.

### Runtime continuity — App and `app_db`

Runtime continuity answers the questions:

- what the system has committed to check later;
- which retry or delivery has not finished yet;
- which approval is awaited;
- which attention episode has a scheduled continuation.

This state belongs to the App.

It is technical continuity, not a hidden semantic or domain model.

`app_db` is durable technical and runtime persistence.

It contains, among other things:

```text
webhook receipts
scheduled checks
notification outbox
pending and approved action contracts
evaluation windows
system discussions
run traces
technical retries and locks
connector credential state — encrypted (`connector_credentials`)
chat authentication state: OAuth clients, codes and tokens — hashes only
```

It does not contain Tasks, Projects, domain entities, knowledge pages, embeddings or a parallel discussion model.

### Claude Chat history is not durable state

Claude's conversation context is transient.

Claude Chat history can be useful local conversation context, but Personal Management System never relies on it as the only place where information that must influence future behavior is stored.

Any future-relevant result is externalized to the appropriate authoritative state:

```text
management and operational state -> Notion
future continuation              -> App / app_db
long-term fact or decision       -> GBrain
```

If Claude answered “OK, I'll come back to this on Monday” but the App has not confirmed a durable continuation, the system must not treat the follow-up as created.

---

## Three MCP interfaces

Claude works with three different MCP domains:

```text
App MCP
Notion MCP
GBrain MCP
```

They are not interchangeable and are not three wrappers over the same operations. The routing rules between them are set by the Skill layer and are the same on both execution surfaces ([Routing tools](#routing-tools)).

### Notion MCP — operational domain interface

The Notion MCP is the native model-controlled interface to Notion.

It can expose native Notion read and write operations, including:

```text
search and fetch operational objects
workspace context and relation traversal
discussions and comments
page and data-source operations
native Notion writes
```

The Notion MCP is the person's voice: Notion attributes what Claude writes through it to the person, under the person's name, because the OAuth connection is the person's. So in a chat, what is written through it is what the person asks for, while an App run only reads through it: the system writes in its own name through the App ([System writes to Notion](#system-writes-to-notion)). `INV-053` The Notion MCP is the person's voice: native writes through it are made in the steps where the person speaks. An App run reads Notion through the Notion MCP and writes to it only through the App.

Personal Management System does not reproduce these operations in the App MCP.

### GBrain MCP — semantic-memory domain interface

The GBrain MCP is the native model-controlled interface to GBrain.

It can expose:

```text
search
pages
facts
timeline
graph
hybrid retrieval
native knowledge writes
```

Personal Management System does not reproduce these operations in the App MCP. The system writes to memory in its own name through an App intent, in canonical terms ([Writes to GBrain](#writes-to-gbrain)); a conversation writes to GBrain with a native write, at the person's request.

### App MCP — runtime/control interface

The App MCP exposes only capabilities that are unique to Personal Management System runtime continuity.

Capability classes:

```text
attention
  comment in the system's voice: the page's discussion or a reply in a named one

capture
  convert an Inbox item into a Task: the task, an origin comment, the trash
  close an Inbox item without a Task: an origin comment, the trash
  park what a conversation left unresolved as an Inbox item (chat only)

continuation
  schedule / reschedule / snooze
  inspect follow-up state

delivery
  persist and queue runtime notification intent
  inspect delivery and runtime state

approval lifecycle
  persist immutable pending domain action contract
  inspect approval state; list the proposals that await a decision
  resolve approval state (chat only)

memory
  record an entry about a Notion object: its anchor by exact identity, created by convention
  with the first entry, and the entry in the form its kind needs

runtime introspection
  read narrow technical state required by current lifecycle
```

There is no cancellation in any of the classes. The resolve capability of the approval class belongs to the person: the App accepts it only from a channel button and from the chat. No run resolves, not even a run that carries the person's words, whatever class its mode gives it ([the mode → toolset matrix](#mode--toolset)). The `user_snooze` reason also belongs to the person: the App accepts it only from a step in which the person speaks for themselves. The tool that decides on a proposal (`decide_pending_action`) and the tool that parks an item in the Inbox (`park_inbox_item`) are withheld from runs: only a chat session sees them ([mode → toolset](#mode--toolset)). The rules and the rationale are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), keys `scheduled_check` and `pending_action`.

The tool names by class are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mcp_toolsets.app`; their schemas and behavior are in [App MCP](#app-mcp).

The App MCP must not expose domain facades such as:

```text
create_task
update_project
notion_raw_request
write_gbrain_fact
append_gbrain_timeline
gbrain_raw_request
sql_query
```

The normative rule:

> The interface chooses the voice. A write in the person's name is a native operation of the domain MCP; a write to Notion and GBrain in the system's name is made by the App, through a closed list of intents in canonical terms. The person's operations stay with the domain MCP, and the model gets only these intents from the App.

The system has four intents in Notion: a comment (class `attention`), the conversion of an Inbox item into a Task and the closing of an item without a Task (class `capture`), and the execution of an approved change, which an executor performs, not a tool. The list of capabilities is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mcp_toolsets.app.system_voice`. [ADR 0017](decisions/0017-two-authors-of-notion-changes.md) explains why the boundary is drawn by voice and not by operation, and [ADR 0023](decisions/0023-close-inbox-item-intent.md) explains why closing is a separate intent. Parking an item in the Inbox (`park_inbox_item`) is not a decision about an existing state but a write of the person's words in the bot's name; only a chat step does it.

In GBrain the system has one intent: a memory write (`record_memory`, class `memory`). The model names the Notion object, the kind of entry, the text, the day and the source, and the App finds the anchor, creates it by convention when there is none, and writes the entry in the form its kind needs. [ADR 0035](decisions/0035-gbrain-writes-by-voice.md) explains why the boundary of GBrain writes is drawn by voice.

`INV-055` The App MCP exposes runtime/control capabilities and a closed list of the system's intents in Notion and GBrain; the native Notion MCP and GBrain MCP perform the person's operations on Notion and GBrain.

### Endpoint App MCP

Production endpoint:

```text
https://api.example.com/mcp
```

The endpoint is served by the same App service behind the same Caddy host; it has no separate container or public port.

The App MCP requires authentication.

The auth implementation supports a user-connected Claude Plugin and scoped App-triggered Claude runs. An App-triggered run authenticates with its run's bearer token. The chat connects through the App's own authorization server: OAuth 2.1 for the installation owner, whose access token goes to the same `/mcp` ([Authentication boundary](#authentication-boundary)).

An App MCP call is part of an already active Claude cycle. The App MCP never recursively starts a new Claude reasoning run.

### Public production MCP endpoints

```text
App MCP:    https://api.example.com/mcp
GBrain MCP: https://brain.example.com/mcp
Notion MCP: https://mcp.notion.com/mcp
```

All three are remote HTTPS endpoints. The system has no stdio servers: every connection is an HTTP transport with a bearer token in the request header.

The chat's authorization server is on the same host, next to the App MCP: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` ([Authentication boundary](#authentication-boundary)).

### Connection mechanics

Who declares the connection and where the token comes from depends on the execution surface.

| | Claude Chat | App-triggered run |
|---|---|---|
| Who declares the servers | the person: the Claude account connectors and the installation's marketplace entry | the App, by the `mcpServers` option of the invocation |
| Where the token comes from | a user-authorized connection; for the App MCP, OAuth to the App's authorization server | the App: the run's bearer token for the App MCP, Authorization Code + PKCE for Notion, client_credentials for GBrain |
| What limits the perimeter | the person's choice | `strictMcpConfig: true` |

The mechanics of the App-triggered connection are in [Runner MCP connections](#runner-mcp-connections). An App-triggered run has no interactive OAuth: the App obtains the token and injects it into the header of the relevant server. The mechanics of connecting the chat to the App MCP are in [Authentication boundary](#authentication-boundary); in the chat the person obtains the Notion MCP and GBrain MCP tokens themselves, and the App does not see them.

---

## Entry points and trigger semantics

The person has two first-class ways to interact with the same system. Their topology is in [General system model](#general-system-model).

The system's work does not depend on the person's morning, evening or weekly rituals. Relevant Notion events, App scheduling and the person's direct conversation with Claude can independently start work. The MVP also supports `Daily Control`, `Weekly Control Review`, `Strategic Review` and `Deep Review` as distinct review surfaces of the methodology.

### Claude Chat

Claude Chat is the primary conversational interface.

The Plugin gives Claude access to three conceptual domains: operational (Notion MCP), semantic-memory (GBrain MCP) and runtime/control (App MCP); their boundaries are defined in [Three MCP interfaces](#three-mcp-interfaces).

A conversation can Capture unprocessed input, Clarify its type, refine a decision, request a future follow-up, change management and operational state or create durable knowledge. Captured input does not become a Task, Project or Objective before classification and clarification.

A chat session sees the App tools according to `chat_toolset` ([mode → toolset](#mode--toolset)), and the App's writes in that session are applied immediately: the tool's response says `applied`. The chat parks an item left unresolved in the conversation in the Inbox (`park_inbox_item`) and closes an item resolved without a Task (`close_inbox_item`). It asks about an open proposal and decides on it according to the person's words (`list_pending_actions`, `get_pending_action`, `decide_pending_action`). It writes to memory, with the same intent a run uses, a decision, a fact or an acceptable state that the person has stated (`record_memory`).

Durable effects must be written to the right system of record; they do not remain only in chat history.

### Direct interaction with Notion

The person can create or edit any canonical objects, Inbox items, comments and supporting structures directly in Notion.

A direct user edit is not a “manual” or second-class state. It changes the same authoritative operational model that Claude uses.

Relevant changes, through the webhook, can start an automated cognitive cycle in the App.

An item the person has put in the Inbox is a separate origin (`inbox_capture`): the run processes each item separately, in `dialogue` mode, and does not count against the daily limit. A resolved item becomes a Task through a system intent, the conversion through the App ([Capture policy](3-policy.md#capture-policy)), or is closed without a Task through the closing intent. An item gets into the Inbox in two ways: the person puts it there in Notion themselves, or the chat parks what stays unresolved in the conversation (`park_inbox_item`). The external channel creates no Inbox items ([Telegram — channel adapter](#telegram--channel-adapter)).

### One behavior model for both ingress paths

Claude Chat and App-triggered Claude apply the same:

- state ownership;
- canonical ontology and status semantics;
- operating loop `Capture → Clarify → Organize & Align → Engage → Reflect → Adapt`;
- detector and evidence standards;
- permission semantics;
- memory policy;
- attention lifecycle.

The delivery mechanism differs, but product behavior must not fork.

The voice of a write differs too: in a chat, Claude writes in the person's name through the Notion MCP; in a run, the App writes in the system's name ([System writes to Notion](#system-writes-to-notion)).

The canonical operating loop is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `operating_loop`.

### Claude's behavior model and workflow frames

Claude is the only AI subject of Personal Management System.

It is not modeled as a collection of permanent personas or detector agents.

For each situation Claude applies a workflow frame rather than becoming a different agent. Frames cover conversational work, the reaction to a relevant Notion change or new discussion input, the re-evaluation of an unresolved attention episode, closure processing and four review surfaces of different depth.

The canonical list of frames, together with the purpose of each, is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `workflow_modes`.

Approved deterministic execution is not a separate reasoning persona or LLM mode. The execution mechanism is defined in [Domain writes, approvals and execution](#domain-writes-approvals-and-execution).

All workflows use one world model: the same roles of Notion, GBrain, native discussions and the App, as recorded in [State ownership](#state-ownership). The canonical list is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `world_model`.

---

## External contracts and baseline

### Verified external interface contracts

The architecture relies on external contracts that need to be checked again before a major integration upgrade:

- Claude Plugins in Claude Chat can package Skills and MCP configuration; core Personal Management System behavior does not depend on Cowork-only hooks and sub-agents.
- The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, TypeScript) loads a local plugin directory, accepts several HTTP MCP servers with per-server headers, isolates a run from local settings, validates structured output against a JSON Schema and provides a headless permission mode.
- Authentication with a Claude subscription through `CLAUDE_CODE_OAUTH_TOKEN` is documented for Claude Code in CI; the Agent SDK hosting page does not describe it.
- The SDK's bundled CLI binary is shipped through npm optional dependencies and is pinned to the SDK package version.
- The options that enforce the run's perimeter (`tools: ['Read']`, `strictMcpConfig`, `skipMcpDiscovery` and the per-mode deny patterns in `disallowedTools`) are documented for the CLI and the SDK separately. Their effective semantics in the SDK's TypeScript surface belong to the same class of contracts, the ones that need to be checked again. The same applies to the permission rule `Read(//<absolute plugin directory>/**)`: the documentation does not describe its syntax (a double `/` at the start); it is a property of the pinned CLI ([ADR 0020](decisions/0020-skill-delivery-in-runs.md)).
- The Notion hosted MCP is available at `https://mcp.notion.com/mcp`; a custom headless MCP client uses OAuth Authorization Code + PKCE, refresh handling and secure credential storage.
- GBrain is pinned separately to an explicit version and commit, given below.

### Official external references for the baseline

External integration contracts are recorded from the official documentation for the baseline versions above. Before a major upgrade of the integration between Claude and Notion, these contracts need to be checked again.

- Claude Plugins in Claude Chat: https://support.claude.com/en/articles/13837440-use-plugins-in-claude
- Claude Agent SDK — overview: https://code.claude.com/docs/en/agent-sdk/overview
- Claude Agent SDK — TypeScript reference: https://code.claude.com/docs/en/agent-sdk/typescript
- Claude Agent SDK — hosting: https://code.claude.com/docs/en/agent-sdk/hosting
- Claude Code — authentication and long-lived token: https://code.claude.com/docs/en/authentication
- Claude Code — plugins reference: https://code.claude.com/docs/en/plugins-reference
- Notion MCP — custom client and OAuth: https://developers.notion.com/guides/mcp/build-mcp-client
- Notion MCP — getting started and hosted endpoint: https://developers.notion.com/guides/mcp/get-started-with-mcp

The GBrain build is pinned by `GBRAIN_REF` (commit) and `GBRAIN_IMAGE_TAG` (version) of the environment template (`infra/.env.example`), and both match the baseline below; an upgrade is performed only by following [RUNBOOK §17](../infra/RUNBOOK.md#17-upgrading-gbrain).

### Runtime baseline GBrain

```text
version: v0.48.5.0
commit: GBRAIN_REF (infra/.env.example)
Bun: >=1.3.10
engine: PostgreSQL
source: default
MCP surface: full
```

Baseline knowledge model:

```text
embedding model: voyage:voyage-4
embedding dimensions: 1024
reranker: voyage:rerank-2.5
provider key: VOYAGE_API_KEY
```

The embedding model and the embedding dimensions are set by the variables `GBRAIN_EMBEDDING_MODEL` and `GBRAIN_EMBEDDING_DIMENSIONS` for every GBrain process, with the values above as the defaults (`infra/compose.yaml`). Every GBrain start first runs `gbrain init --non-interactive --schema-pack gbrain-base-v2` and then starts the server (`gbrain serve --http --surface full`): `init` creates only what is missing and does not change choices already made. The reranker `voyage:rerank-2.5` is the default for this GBrain version on the same key, so it has no separate config line.

`VOYAGE_API_KEY` serves embedding and rerank, which is all GBrain needs in this system. GBrain's own LLM functions (extract facts/atoms, synthesize, drift, chat) are out of scope: reasoning about what becomes long-term knowledge belongs to Claude under the memory policy, with its thresholds for evidence, approval and trace. There is no second layer of reasoning over the same store, so GBrain has no Anthropic credential. GBrain maintenance (the `gbrain-maintenance` service) runs only the `purge` phase, once every six hours: it permanently deletes what is soft-deleted and past its recovery window, calls no models and synthesizes nothing.

Baseline FTS:

```text
GBRAIN_FTS_LANGUAGE=english
```

The full-text search language is a configuration Postgres ships or one that `infra/postgres/init.sql` builds from a hunspell dictionary of the installation, before GBrain's migrations need it ([ADR 0050](decisions/0050-search-language.md)). The language and its dictionary are the configuration of the stored data: a change of either is a reindex ([RUNBOOK §19](../infra/RUNBOOK.md#19-changing-the-fts-language)).

MCP server surface:

```text
--surface full
```

The `full` surface supports the current Personal Management System semantic-memory contract: retrieval, page access, graph traversal, facts, timeline and native GBrain writes.

The surface ceiling (`verbs`, `starter` or `full`) is server-wide: it is set by `serve --http --surface full` in `infra/compose.yaml` and is shared by all clients of the server. A per-client ceiling is set only by `gbrain auth rescope-client --surface`; `register-client` has no such flag. A narrower ceiling suits no client: direct Claude Chat has “full” in the matrix and links an anchor to its artifacts through `add_link`, which `starter` does not contain. The App needs `get_timeline` and `get_links`, which `starter` does not contain either. `init` must also show every tool of the matrix row. So the ceiling is `full`, and the run's allow-set does the narrowing within it ([mode → toolset](#mode--toolset)).

### Repository and filesystem layout

`personal-management-system` is **one application monorepo** for the system's code, the Plugin, the documentation and the deployment infrastructure.

`gbrain-repo` stays a separate Git repository because it is the canonical file-backed knowledge storage inside GBrain, not a source tree of the Personal Management System application.

#### Local repository layout

The `~/projects/` directory in the layout is an example: the clone and `gbrain-repo` sit side by side in any directory. This is the local machine: `.env.local` is its environment file, and `.env.gate` and `gate/` are the gate environment, which runs only here ([`infra/GATE.md`](../infra/GATE.md)). The environment files and the contents of `notion/` and `gate/` belong to the installation and stay out of git.

```text
~/projects/
├── personal-management-system/
│   ├── app/
│   │   ├── src/
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── plugin/
│   │   └── ...
│   │
│   ├── plugin/
│   │   ├── skills/
│   │   └── .mcp.json
│   │
│   ├── contracts/
│   │   ├── canonical.yaml
│   │   ├── invariants.yaml
│   │   ├── notion-workspace.yaml
│   │   └── ...
│   │
│   ├── docs/
│   │   └── ...
│   │
│   ├── infra/
│   │   ├── compose.yaml
│   │   ├── compose.local.yaml
│   │   ├── compose.prod.yaml
│   │   ├── .env.example
│   │   ├── .env.local
│   │   ├── .env.gate
│   │   ├── notion/
│   │   │   ├── mapping.yaml
│   │   │   ├── workspace.yaml
│   │   │   └── formulas.md
│   │   ├── gate/
│   │   ├── marketplace.example.json
│   │   ├── RUNBOOK.md
│   │   ├── GATE.md
│   │   ├── postgres/
│   │   │   ├── init.sql
│   │   │   ├── install-dictionaries.sh
│   │   │   └── dictionaries/
│   │   ├── docker/
│   │   │   └── gbrain/
│   │   │       └── Dockerfile
│   │   ├── caddy/
│   │   │   └── Caddyfile
│   │   ├── ops/
│   │   │   └── test-db.sh
│   │   └── bin/
│   │       ├── dc
│   │       ├── dcp
│   │       └── gate
│   │
│   ├── .dockerignore
│   ├── .gitignore
│   ├── LICENSE
│   └── README.md
│
└── gbrain-repo/
    ├── .git/
    └── ...
```

Repository ownership:

```text
personal-management-system/
  app/        -> NestJS + Prisma App source and the runner plugin
  plugin/     -> the chat plugin: Skill, knowledge and connectors
  contracts/  -> canonical lists, the physical schema of Notion and machine-readable invariants
  docs/       -> canonical system documentation
  infra/      -> Docker Compose, Caddy, database initialization, runbook and gate

gbrain-repo/
  -> canonical GBrain Markdown/frontmatter knowledge
```

Local Compose is started from `personal-management-system/infra/` with the `./bin/dc` wrapper — `docker compose` with `.env.local` and `compose.local.yaml` — so the build context is set to a fixed relative path from there. The context is **the repository root**, not `app/`: the image takes the runner plugin from `app/` and the knowledge from `plugin/`, because the behavior contract ships in the same release as the runner that loads it — [Skill layer contract](#skill-layer-contract). A narrower context would put the knowledge out of the build's reach. The Dockerfile is `app/Dockerfile`, relative to the context root.

The context includes two files from `contracts/`: `contracts/notion-workspace.yaml` and `contracts/canonical.yaml`. The `notion` command of the App image and the gate build the Notion databases from the first, and `notion template` takes the slots of the binding template from the second ([ADR 0048](decisions/0048-notion-workspace-contract.md)). The running App reads no contract: it keeps the contract in its own constants and schemas, and contract tests check that they agree with the files.

Locally, the separate `gbrain-repo` is a sibling of `personal-management-system`, so its relative path from `infra/` is:

```text
../../gbrain-repo
```

#### VPS repository layout

On the VPS, the same `personal-management-system` monorepo is cloned:

```text
/srv/
├── personal-management-system/
│   ├── app/
│   ├── plugin/
│   ├── contracts/
│   ├── docs/
│   ├── infra/
│   │   ├── compose.yaml
│   │   ├── compose.prod.yaml
│   │   ├── .env.example
│   │   ├── .env.prod
│   │   ├── notion/
│   │   │   ├── mapping.yaml
│   │   │   ├── workspace.yaml
│   │   │   └── formulas.md
│   │   ├── RUNBOOK.md
│   │   ├── postgres/
│   │   ├── docker/
│   │   ├── caddy/
│   │   ├── bin/
│   │   └── ...
│   ├── .gitignore
│   ├── README.md
│   └── ...
│
└── gbrain-repo/
    ├── .git/
    └── ...
```

Production infrastructure commands run from the directory below with the `./bin/dcp` wrapper — `docker compose` with `.env.prod` and `compose.prod.yaml`:

```text
/srv/personal-management-system/infra
```

The App starts from the image `APP_IMAGE` points to: one built from this clone (`personal-management-system-app:local` when the variable is empty) or one taken, with a commit tag, from a registry the installation owner has chosen. The image contains the Claude Code CLI, a proprietary Anthropic program, so it is not published to a public registry. The image brings the `app_db` schema up to its own version automatically: its start command first applies the migrations (`prisma migrate deploy`), and a failed migration stops the container.

This yields one versioned system release for:

```text
App source
Plugin / Skill source
canonical contracts
documentation
infrastructure
```

At the same time, the GBrain knowledge lifecycle stays independent of the application source lifecycle.

## Domain writes, approvals and execution

The permission class determines whether a domain write is executed immediately or goes through the approval gate. The canonical list of classes is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `permission_classes`; the semantics of each class are owned by [`docs/3-policy.md`](3-policy.md).

The `INV-xxx` marks in this and the following sections point to the registry of invariants, [`contracts/invariants.yaml`](../contracts/invariants.yaml). The registry also holds each invariant's canonical wording (`statement`), section of origin (`origin`) and link to tests. A marked paragraph here states the same norm in the section's own words.

### Native writes stay native

A direct explicit user request can be executed by the original domain MCP:

```text
Claude -> Notion MCP -> native Notion write
Claude -> GBrain MCP -> native GBrain write
```

No App wrapper is created merely to rename the same operation. Which of the two authors writes which change is described in [System writes to Notion](#system-writes-to-notion).

### Autonomous low-risk writes

When the behavioral policy allows an autonomous low-risk write, Claude writes through the App using a system intent: in Notion, a comment in a new or existing discussion; in GBrain, a memory write. In an App run the Notion MCP and GBrain MCP only read.

Tool availability is specific to the mode and the run.

### Approval-required writes

When a write needs durable approval or has to outlive the current turn, the App stores an immutable proposal contract. The contract consists of the changes themselves, in canonical terms, and the conditions under which they still make sense:

```text
effects          what will change: a page, a property, a canonical value
preconditions    the conditions under which the change is still the one shown to the person
proposing run
status
```

The person approves exactly what will be executed: the effect carries the canonical value, and the executor writes that value, so what is shown and what is written are the same.

A proposal is checked in full before it reaches the person, with the same check that execution applies to it. The App reads the page the write will go to, checks the preconditions on it and encodes the values according to the page's canonical type and the types of its properties. A precondition that already fails to hold, or a value the property will not accept, is refused with a reason: otherwise a proposal that cannot be executed would reach the person, who would spend a decision on something guaranteed not to happen. Before execution all of this is repeated on a freshly read page: both the state and the schema may have changed between the proposal and the approval.

The contract does not duplicate the evidence for a proposal: it is carried by the result of the run that made the proposal — the evidence of the validated result in that run's trace ([Implementation inventory](#implementation-inventory)).

After approval the executor:

1. reads the page again and checks the preconditions;
2. refuses if the state has changed;
3. encodes the canonical values on the page it has just checked, according to the page's canonical type and the types of its properties;
4. writes the change in a single write through `NotionWriter`, on behalf of the system ([System writes to Notion](#system-writes-to-notion));
5. verifies by reading back: the Notion response, decoded by the adapter, equals what was intended;
6. records the execution.

```text
Claude (autonomous run)
  -> App MCP: create_pending_action (effects with values, preconditions)

User approval (channel button or chat)
  -> App records approval
  -> executor revalidates preconditions
  -> executor writes through NotionWriter (REST, integration bot)
  -> verify + audit
```

The App creates no domain API of its own: an effect is a change of a property, not an App operation.

### Preconditions and executor

`pending_actions` stores the immutable proposal contract — its effects and preconditions. The logical fields of the record are in [Persistence](#persistence).

```typescript
type Precondition =
  | { kind: 'page_exists';        pageId: string }
  | { kind: 'property_equals';    pageId: string; propertyId: string; optionId: string }
  | { kind: 'property_empty';     pageId: string; propertyId: string }
  | { kind: 'property_reads_as';  pageId: string; propertyId: string; value: CanonicalWrite }
  | { kind: 'unchanged_since';    pageId: string; lastEditedTime: string };
```

Three of the five kinds refer to a property by `propertyId`, so revalidation is possible only for semantics that have a physical property. For a one-way relation the check is possible only from the owning side: there is no reverse side.

**A proposal declares what it will change**, and every declared effect must have a condition that will see that particular effect:

```typescript
type ActionEffect = {
  kind: 'property_write';
  pageId: string;
  propertyId: string;
  value: CanonicalWrite; // text, option, date, relations or clearing
};
```

This is not a matter of style but the mechanism that makes execution once-only: an executor that wrote and then crashed before it could mark the row will, on the second attempt, read the state again, see that the condition no longer holds and return `conflict` instead of writing a second time. Having a tie at all does not guarantee this; **correspondence** does: the condition looks at the same page and the same property and can see this particular write. `property_equals` compares the option id, so it sees an option write and an option clearing. `property_empty` sees a value written into an empty property. `property_reads_as` sees a write of any kind — text, an instant, a set of relations, clearing — but only a write that changes what the condition names: the condition's value must differ from the value being written. An effect that writes the same value would leave the condition true, and the retry would pass, so a proposal with that effect is refused up front. Therefore a change to a filled date, text or relations is covered precisely by `property_reads_as` ([ADR 0024](decisions/0024-property-reads-as-precondition.md)). A condition that looks elsewhere will see everything in place and let the second write through, so it does not count as a tie. The effect is declared separately from the conditions: a condition checks the declared effect, not itself.

`property_reads_as` reads the property not by its physical payload but through the adapter's reading (`SemanticAdapter.readBack`), and compares by meaning: an instant is compared as an instant, relations as a set. The time zone of a date is an annotation of the instant if `start` itself carries an offset; an instant without an offset (the local time of a date with a time zone) is not placed on the timeline and is equal to nothing — there is no host clock for it. The system's own write is confirmed more strictly: the response has no time zone, because the system writes no time zones. The value in the condition is the model's claim about what the model itself has read, not an App snapshot: a wrongly stated value yields `conflict` on the very first check, before the person is involved. A property that carries no canonical field, or a binding that has diverged from the workspace, is `undecidable`: it is an authoring or configuration defect, and a retry would change nothing.

Creating a page is **not** a declarable effect — see `GAP-24`.

Revalidation has **four** answers, not two, and each leads to a different fate for the approval. `holds` means the action is executed. `broken` means the state has changed and the action is no longer the one that was shown (`INV-027`: the model makes a new proposal). `undecidable` means the question has no answer in this form, and a new proposal of the same form would hit the same wall; this is an authoring defect, not a defect of state. `degraded` means the state could not be inspected (a rate limit, a server error, a timeout, missing access): it says nothing about the domain, and the person's decision stays in force, up to the attempt limit (below). A single branch for all of them would treat both an unread property and lost access as a change of state: the approval would be spent on a diagnosis that has nothing to do with the domain. When the proposal is made, each of the three failures ends in a refusal of the proposal with the same reason: the person has not decided yet, so there is nothing to spend.

In every case the reason is written to the row (`last_error`), because `failed` needs attention ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `pending_action`), and attention without a diagnosis has nothing to look at.

`unchanged_since` is not a tie. **Notion truncates `last_edited_time` to the minute** (the seconds in it are always zero), so the system's own write made in the same minute is invisible to `unchanged_since` — in the very gap where a retry after a failure lands. It stays useful as a safeguard against someone else's later edit, but not as a tie. The consequence is spelled out: an action whose effect lies in the page body rather than in a property cannot be proposed, because there is no way to enforce once-only execution for it.

The page the write will go to comes from the declared effect, not from whichever condition happens to have a `pageId`. An action that touches two different objects cannot be done as a single write, so it is not accepted. An action that writes one property twice is not accepted either: there is one write, and of the two values only one would remain in it — not necessarily the one the person regarded as the main one.

**There is one executor, and a retry is safe.** Approved actions are executed by a single loop, the row status is monotonic, the preconditions observe the effect, and the write is one `pages.update` that sets the same values. A retry after a failure reads the preconditions again and returns `conflict` instead of a second write.

**Approval and execution are two steps.** The button-press handler records the decision and returns; the worker executes. The reason is mechanical: the channel redelivers an update on a non-2xx response, so a long execution in the handler would produce a second update and a second attempt. A restart between the steps loses nothing — the decision is already in the row.

**Notion being unreachable and a write failing are different things.** A write that Notion rejected as invalid, or a value the property does not accept, yields `failed`: this is not the expected course of events and needs attention. A page that no longer exists yields `conflict`: the state has changed, and the model will make a new proposal. A rate limit, a server error or missing access has changed nothing, so the approval stays in force and the action is retried later (`next_attempt_at`) — an immediate `failed` would mean that the person has to decide again what was already decided. But the wait has a limit ([ADR 0044](decisions/0044-bounded-approved-actions.md)). Temporary unavailability — a rate limit, a server error, a timeout, a bot not yet known — waits no longer than the limit counted from the approval. A refusal of access (401, 403, a page without content) does not clear on its own and waits no longer than the attempt limit ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `pending_action`). After that the action is `failed`, with a non-execution kind, and the person sees it in the proposal's thread. A write that Notion accepted but did not confirm in its response — what is read back does not equal what was written, the author shown is not the integration bot, or what was written cannot be read from the response — is also `failed`, with the discrepancy named. The write has already taken place, and a retry would see its own effect as a changed state.

`INV-025` The App MCP provides the system with a closed list of intents in canonical terms: a comment, conversion of an Inbox item, closing an Inbox item, execution of an approved change and a memory write; through these and only these the system writes to Notion and GBrain on its own behalf.

`INV-027` A conflict returns `conflict`; the model makes a new proposal and does not repeat the old one.

### Approval differs by who performs the write

How approval works is determined by **who performs the write**.

**Chat.** Claude has a full, user-authorized Notion MCP. An action it inferred on its own is settled by conversation: it asks, the person answers, it writes. `pending_actions` takes no part in this; the record of it stays in the conversation and in the page history. If no answer comes and the session ends, the proposal stays an Inbox item (`INV-015`): the chat toolset has no `approval_propose` (`chat_toolset`), and `park_inbox_item` parks an Inbox item. The chat reads the waiting proposals of autonomous runs — `list_pending_actions`, `get_pending_action` — and decides on them according to the person's words (`decide_pending_action`): the decision is recorded immediately, and the executor executes it.

**Autonomous run.** No row of the [mode → toolset](#mode--toolset) matrix gives it the right to change a property: in an autonomous run the Notion MCP only reads, and the system comments through the App. So a proposal becomes a `pending_actions` row, and the App executor executes it after approval. A property change that the person specifies in a reply in a thread or in the channel is likewise proposed by the run for approval.

The row exists **from the time of the proposal**. The reason is mechanical, not one of convenience: the run ends together with the model, and between its end and the person's reply the row is the only carrier of the executable change. A channel button carries only an id — the effects with their values cannot fit into it, and reconstructing them would mean executing something other than what was shown.

The table is not an attention surface: the person sees a pending proposal in Notion and never reads the table.

`INV-026` `pending_actions` holds the proposal of an autonomous run from the time it is made. The canonical lifecycle is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `pending_action`.

**Expiry is measured in reviews, not hours** — a lifecycle rule in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `pending_action`. So there is no timestamp field: at the time of creation it is unknown when the next review will take place, or whether it will. The Daily Control reads the open proposals (the `approval_view` bundle) and carries them in the packet's `proposals` field, up to the limit `notification_packet.max_proposals`, with the line and the buttons of each; the rest it gives as a count. When the App places the next Daily Control occurrence, it expires the rows of every proposal that is still `proposed` and was shown by the delivered packet of the preceding Daily Control. What was not shown, or was not delivered, does not expire; a skipped day does not keep a shown proposal alive forever, because any earlier packet counts. The Weekly Control Review and the Strategic Review carry proposals but do not expire them ([ADR 0039](decisions/0039-daily-review-proposals.md)).

A decision about one proposal in a packet removes only that proposal's buttons and adds next to its line what it became; the buttons of the rest stay. Which proposals a message carries, and what each became, are recorded in the `notification_proposals` rows, and the rewritten message is rendered from the packet and the fates. Pressing a button on an expired proposal gets the answer that it has expired.

`INV-104` Only a proposal shown by a delivered Daily Control packet expires when the next Daily Control occurrence is scheduled.

**A proposal's fate lands in its thread** ([ADR 0043](decisions/0043-proposal-fate-in-thread.md)). The thread is the canonical interaction history, so the system writes the person's decision and the non-execution of what was approved to the proposal's thread. The text comes from the catalog of the installation's language, and the system writes it under a kind label, addressing the owner ([ADR 0046](decisions/0046-system-voice.md)): “You approved: <field> → <value>” (in the Ukrainian catalog the form follows the gender setting; with no setting it is “Твоє рішення — схвалити: …”, ‘Your decision is to approve: …’), “You rejected: …”, “The approved change was not written (…): <reason>”. The wording of the change comes from the proposal contract, not from the model's line: the field is named by the language's own word when the catalog has one (“status”, “deadline”, “date”) and otherwise by its name from the workspace; an option appears as the workspace shows it; a date is given in words (“November 10”). Execution and expiry are not written to the thread: an executed change is visible directly, and a skipped proposal is not an event. A run reads the fate of its proposal from the thread it reads anyway. A separate App loop publishes the fate: the row remembers the published fate, so each transition is published once, and a failed write is retried on the next tick. The same step rewrites the message in the channel; the button-press handler only records the decision and answers at once (`INV-023`).

**The system closes a proposal the person has preempted** ([ADR 0044](decisions/0044-bounded-approved-actions.md)). When intake sees a change by the person on the page where a proposal is waiting — to its properties or to the page itself — it asks for the proposal's preconditions to be checked. The executor checks them with the same evaluator it uses before a write: a broken precondition closes the proposal with `conflict` without waiting for a button press, and its buttons disappear. This is not a withdrawal on the system's judgment but the same mechanical check that the executor would make anyway after a button press. A `conflict` that closes a preempted proposal is not written to the thread: the person changed the page themselves. A proposal that circumstances have made unnecessary without breaking a precondition waits for the person's decision.

`INV-107` A proposal's fate is recorded in its thread as a system write exactly once per transition: the person's decision — approval or rejection — and the non-execution of what was approved; execution and expiry are not written to the thread. The message about the proposal is rewritten by the same step, not by the button-press handler.

**The executor writes as the system** — through `NotionWriter`, on behalf of the integration bot. The system's own event comes back as a webhook, and intake recognizes it by its author ([Webhook intake](#webhook-intake)): it starts no run about itself.

### System writes to Notion

Changes to Notion have two authors ([ADR 0017](decisions/0017-two-authors-of-notion-changes.md)). **The person** is the author of their own edits in Notion and of everything they ask for in the chat: Claude writes through the Notion MCP, and Notion attributes it to the person. **The system** is the author of everything the system writes on its own behalf. The App does this through REST on behalf of the integration bot, using a closed list of intents: a comment, conversion of an Inbox item into a Task, closing an Inbox item without a Task, execution of an approved change ([ADR 0023](decisions/0023-close-inbox-item-intent.md)). The interface determines the voice, not the operation: an App run reads Notion through the Notion MCP and writes to it only through the App.

Two writes made on behalf of the bot fall outside the list of intents, because they decide nothing about existing state and only carry the person's words into Notion: a write to the Inbox (`park_inbox_item`, in the chat only) and a quoting comment in a system thread (the person's reply in the channel to a message in that thread). They are made only in a step in which the person speaks for themselves: the chat or the intake of the person's reply from the channel ([Telegram — channel adapter](#telegram--channel-adapter)). One more write on behalf of the bot is made by the App itself, without the model: the trail of a proposal's fate in its thread — the person's decision and the non-execution of what was approved ([Approval differs by who performs the write](#approval-differs-by-who-performs-the-write)).

An App comment can carry a **kind label** — the name under which Notion shows it ([ADR 0043](decisions/0043-proposal-fate-in-thread.md)): “Reply from <channel>” for the person's words carried over, “Your decision” and “Outcome of the change” for a proposal's trail; the rest of the system's comments carry the integration's name. The label tells the person what the comment is and never names the person: Notion does not let an internal integration show the person as the author, and the author remains the bot, so the rule “an event is the system's own when its author is the bot” stays unchanged. The model does not see the label — the Notion MCP does not return it — so the protocol for the label stays in the text. The label texts come from the catalog.

All system writes pass through one boundary — `NotionWriter` (`notion/client/`). It supports four operations: a comment on a page or in a discussion, creating a page in a data source, changing the properties of a page and moving a page to the trash (`in_trash`), which is reversible: a page can be restored from the trash. The system does not write the page body.

The values of a write are canonical: an option by its canonical name from the binding, a date, relations, text or clearing ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `canonical_writes`). The adapter takes the physical type of a property from the live schema at the time of the write, not from the binding: the binding carries no types, and a type that has changed in the workspace does not turn the write into a different one. Signals, formulas and non-canonical values are not written — a write that mentions them is refused before the request.

Every Notion response to a write is checked: it must be complete, and its author must be the integration bot. A write that Notion attributes to a different author is a token configuration error, not a success: the system's own writes are recognized by their author. A response without content means that the integration lacks the permission to read, and what was written cannot be verified from it. In both cases the write has already taken place, so the boundary reports it as a separate error — an unconfirmed write — and not as a request failure. Until the bot's identity is known, the system does not write at all.

The App reads through REST what the deterministic steps need: a page for the executor's preconditions, and the data source schema for the binding check and for encoding a write. REST and the Notion MCP are two interfaces to one authoritative Notion workspace; they do not create two data authorities.

`INV-086` Only `NotionWriter` calls the Notion write endpoints (comment, page creation and update, trash); it is one boundary that writes values already encoded by the adapter according to the live schema and checks the author of the response. Only `notion/workspace/` writes the schema — databases and data sources — and the running App does not load it (`INV-081`).

---

## Semantic adapter

### Physical schema and semantic interpretation

The physical schema — data sources, properties, value types, relations, options and formulas — is described in [`contracts/notion-workspace.yaml`](../contracts/notion-workspace.yaml) together with the binding of the canonical model to it by names. The file is canonical for the physical schema: `notion build` builds the databases in an empty workspace from it, the gate builds its own workspace from it too, and `notion check` shows how the schema of the installation's workspace differs from it. The file contains no property IDs: the workspace issues them, and they reach the binding through the generator. A structural change is a change to this file made by a separate agreed decision, not a consequence of implementation convenience. A repeated `notion build` brings the databases of its ledger into line with the file, and only formula expressions are entered by hand ([Onboarding mapping](#onboarding-mapping); [ADR 0048](decisions/0048-notion-workspace-contract.md)).

[Methodology](1-methodology.md) and [`contracts/canonical.yaml`](../contracts/canonical.yaml) are authoritative for the semantic interpretation of objects, statuses and lifecycle. The schema adapter maps the physical Notion schema onto this behavioral contract; display names or Notion status groups alone do not redefine the canonical meaning.

The App and the MVP do not support an arbitrary Notion workspace without onboarding mapping.

The schema adapter records the IDs of data sources and properties and the operational semantics; it takes the value type of a property from the live schema at the time of the write ([System writes to Notion](#system-writes-to-notion)). Property IDs are the preferred technical contract, so that renaming a display name does not break the integration.

`INV-003` The adapter is access configuration. Current property values are always read from Notion and are not cached as domain state.

The adapter declares the representation kind of each canonical semantic — `native`, `relation`, `traversed`, `page_body`, `gbrain` or `absent`. The canonical list of representations and their payload is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `representation_kinds`. A technical status that exists in the physical schema but does not belong to the domain is registered separately: key `known_non_canonical`.

### Onboarding mapping

The MVP works with the person's actual workspace and allows the physical Notion schema to vary. The semantic model remains canonical and does not depend on the names of databases, views or the display names of properties.

`notion build`, a command of the App image (`./bin/dc run --rm notion build`), writes the binding for a workspace according to the schema in [`contracts/notion-workspace.yaml`](../contracts/notion-workspace.yaml). When the workspace is empty, it builds the databases themselves as well. The command works only with the `infra/notion/` directory: `mapping.yaml` is the binding, `workspace.yaml` is the ledger of built databases and `formulas.md` holds the formula expressions. A repeated `build` brings the databases of its ledger into line with the contract: it adds what is missing, corrects what differs and removes what is extra — and touches nothing else. REST does not accept formulas that read a related database, so `build` creates the formula columns empty and the expressions are entered by hand; a repeated `build` adds the signals of the entered formulas to the binding. `notion check` only reads and checks the workspace schema against the contract. For a workspace of a different shape, `notion template` produces a template with slots, and the person fills in the values. The running App reads only the binding ([RUNBOOK §3](../infra/RUNBOOK.md#3-notion-workspace-and-binding)).

During onboarding the system must establish a stable semantic mapping for:

- data sources for `Identity`, `Area of Focus`, `Objective`, `Key Result`, `Project`, `Behavior System`, `Task` and `Inbox`; `Principle` has no store of its own — it is prose in the body of an Identity;
- property IDs;
- the semantics of relations and the direction in which they are traversed;
- the exact allowed values of `Task Status`, `Project Status`, `Behavior System Lifecycle` and `Area of Focus.Mode`;
- the representation kind of each canonical semantic — one of the six kinds in `representation_kinds`;
- `Key Result` as evidence or a target condition, not a Task or a Project;
- two independent time properties: `Date` is the time at which the work returns to attention, `Deadline` is the time by which it must be completed;
- the dependency representation between Tasks and other supporting relations;
- a separate representation of Behavior System automaticity and form, if it is used;
- derived properties, which are read-only evidence.

Changing the display name of a property must not silently change the semantic meaning of the integration.

This is an access and semantic mapping, not a copy of current data. The mapping can normalize localized or workspace-specific display values to the canonical enum, but Claude and the App operate only on the canonical semantics. An unknown or ambiguous value yields a schema or configuration error, not a silent assumption.

The MVP must support at least the following semantic invariants:

- `Area of Focus` is the only entity of Level 3; the acceptable state and `Mode` belong to it, not to separate entity types;
- `Project` has one canonical status and a relation to Tasks;
- `Behavior System` has a lifecycle; automaticity and form are a different dimension;
- `Task` has one canonical status; `Next Action`, `Scheduled`, `Waiting For` and `Someday/Maybe` are not separate databases;
- Objective review decisions are not stored as Project and Task statuses;
- a relation to a higher Level is not mandatory for every lower object;
- a terminal Project has no linked Tasks that are active out of sight.

The normalized semantic shape is a conceptual contract; physical databases and property names may differ. The canonical form of the fields is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `field_contract`.

`required` means a semantic requirement for a valid managed object, not a requirement to fill in a field during an instant Capture. An Inbox item can remain unprocessed until Clarify. Optional fields are added only when they change a decision or control.

The binding names the carriers but not their physical types: the adapter takes the type for a write from the live schema at the time of the write ([System writes to Notion](#system-writes-to-notion)).

The binding is checked twice. Startup catches an unfilled slot. Startup does not see a dead id (a deleted property, a vanished option of a closed set, a recreated formula): the file stays syntactically complete, and the App starts. Only a check against the live workspace catches a dead id; it needs Notion, so it cannot be an offline check, and `BindingDriftWorker` runs it once a day. The binding check is derived from the binding, without a second registry: it covers exactly what the binding declares as a carrier. Unavailability of Notion (a rate limit, a server error, a timeout, missing access) is not declared drift, whereas a data source for which Notion says “not found” (`object_not_found`) is declared drift: its id is dead. Any other response is a defect, and the check fails on it rather than staying silent.

### Entities in scope

The adapter covers these physical data sources of the workspace, described in [`contracts/notion-workspace.yaml`](../contracts/notion-workspace.yaml):

```text
Tasks            Level 0: units of execution
Projects         Level 1: bounded change mechanisms
Habits           Level 1: register of recurring behavior
Key Results      Level 2: evidence — the node mechanisms attach to
Objectives       Level 2: direction
Areas of Focus   Level 3: ongoing responsibilities
Identities       Level 4: identity and orientation records
Inbox            trusted capture location
Context          GTD execution context
Tags             cross-cutting classification
Trigger          cue of recurring behavior
```

`Objectives` and `Key Results` are separate data sources linked by a two-way relation: the type of an object is determined by the database the page is in.

`Context`, `Tags` and `Trigger` are not canonical types. They are reference values that are read directly as a tag, a context and a cue; they have no slots of their own in the binding, and their names are resolved by page id from the relation.

Mechanisms attach to `Key Results`, not to `Objectives`: there is no direct relation Objective → Project or Objective → Habit, and the path from direction to execution runs through evidence.

### Logical interface of the adapter

The adapter carries no list of identifiers of its own. The set of canonical slots is defined by [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `field_contract`; the values for a particular workspace come from the binding `infra/notion/mapping.yaml`. There is no second list — otherwise it would diverge from the first.

Each slot is resolved through one of the representation kinds (`representation_kinds`), and three of them have consequences for writing:

- **`relation`** holds the target, the direction and the reverse property id. A write to a one-way link does not create a reverse side — an adapter that treats it as two-way will not see the relation just written from the other end.
- **`page_body`** is read as a whole: there are no named sections, and the capability is determined by whether a body is present, separately for each record.
- **`traversed`** has no property of its own: the value is reachable only by traversing the named relation.

The adapter reads properties **by the id the binding names**. Reading by id settles what happens to physical properties that have no canonical home: they are not ignored by a list but unreachable by construction, since there is no list from which they would have to be excluded.

The adapter also writes, in the reverse direction, by the same representation kind. A canonical value is encoded according to the physical type of the property, as the live schema supplies it: text into `title` or `rich_text`, an option into `status` or `select` by the option id from the binding, a date into `date`, relations into `relation`. Only a carrier that is a property (`native`, `relation`) can be written; nothing is written into `page_body`, `traversed`, `gbrain` and `absent`, into signals or into computed properties. What is encoded is checked by reading back: the Notion response, decoded by the same adapter, equals what was intended ([System writes to Notion](#system-writes-to-notion)).

The adapter also enforces a write rule that concerns several fields: a `Next Action` has no `Date` (`INV-005`). The adapter checks the result: the status and the date are the ones the request writes, and whatever the request does not mention is taken from the page. That is how the adapter catches every path to a `Next Action` with a date (writing a date to a `Next Action` Task, moving a Task that keeps its date to `Next Action`, and a request that has both), equally for the new Task of a conversion and for a change to an existing one. A move together with clearing the date passes. A write that touches neither the status nor the date is left alone by the rule: the name or the deadline of a page on which the person themselves left a date on a `Next Action` does not become unwritable.

A refusal gives its reason, and what happens to the execution depends on that reason. A request that is invalid in itself (both halves are in it, or a new Task with a date and no status) is `UnwritableValueError`, which at execution means `failed`. A request that is invalid only for this page (the other half is on the page: a date that stays, or a `Next Action` status that a date is being written to) is `UnwritableOnPageError`: at the time of the proposal it is a refusal with a reason, and at execution it is `conflict`, because the page was changed after the proposal. The page is queried only when the answer depends on it; a slot that must be read but is not read is a configuration refusal, not “there is no date”. Refusals arising from the identity of the page (a page outside a canonical type) and from the schema (the physical type of a property) remain `UnwritableValueError`.

A write to an existing page addresses its property, and the canonical type of the page — the data source it lives in — determines the field. A property id alone does not determine the field: `title` exists in every data source, and ids in different data sources may coincide. Therefore a data source belongs to at most one type, and a binding with a shared data source is not accepted.

The shape of the physical payload is set by the official Notion SDK: the adapter narrows the SDK's tagged union of properties instead of describing the shape again, so if a variant disappears from the SDK's list, the build breaks at the branch of code that reads it. The page envelope stays narrow — id, data source, edit time, trash mark and properties; nothing reads the other fields of a page. One exception is called out in the code: the live payload returns `has_more` on a relation, but the SDK type does not declare it, so the field is added separately. Without it a truncated list would look complete: a page carries the first 25 links, and the reader reads the rest with a separate request before handing the record over for decoding.

A field as read has one of six states, and two of them are distinct:

| State | Means |
|---|---|
| value | the carrier has been read, the value is canonical |
| `absent` | there is no carrier anywhere — the binding declares this |
| `empty` | the carrier exists and holds nothing |
| unread | the carrier was not part of this read: a traversal, the page body, a GBrain anchor |
| `schema_gap` | the carrier holds a value that the model does not describe |
| non-canonical | a value from the `known_non_canonical` registry |

`absent` and `empty` are kept separate because they call for different things. `absent` is a property of the **type**: the field will not have a value in any record until a carrier appears, and a request to the person to fill it in has nowhere to go. `empty` is a property of the **record**: for a required field this is a legitimate finding, and there is a place to fill it in.

An unread field is not merged with `empty`: traversing a relation is a separate step under a budget, the body arrives with a separate request, and a GBrain anchor comes from another system. Calling an unread field empty would assert an emptiness nobody checked (`INV-002`).

The adapter does not keep degradations as a separate list: the representation kind of each semantic is already recorded in the binding, and a list beside it would silently diverge from it. Semantics without a carrier are derived from the binding and named explicitly at startup. The register in [`docs/3-policy.md`](3-policy.md#degradation-register) remains the human side of the same facts — it adds the consequence and the lift path, which a machine does not need.

A resolution that fails yields one of three errors (`contracts/canonical.yaml`, key `adapter_errors`). What tells them apart is **who made the mistake**, and that determines the caller's behavior:

| Kind | Who erred | Caller |
|---|---|---|
| `configuration_error` | the binding: the named id does not exist | stop at this type; a retry will not help, the file needs an edit |
| `schema_gap` | the model: the workspace carries a value that the model does not describe | assert nothing about this field, do not substitute a default, keep reading the rest of the record |
| `ambiguous_input` | no one: the input allows several readings | ask, do not guess |

A missing capability is not an error: `absent` in the binding yields the capability `absent`, and an empty body and an unfilled optional field yield `empty` (`INV-009`). Transport failures do not belong to this vocabulary either — they are described as degradation.

Statuses are mapped **per option ID**. Neither a display name nor a Notion group is the contract: the groups `to_do`, `in_progress` and `complete` are a UI abstraction, carry no semantics, and the workspace contract does not record them. In whichever group `Paused` sits, it means committed but not advancing; `Failed` does not become a synonym of `Done`, even when it sits next to `Done` in `complete`.

### Separate status semantics

Tasks and Projects are different entities with separate status models ([`contracts/canonical.yaml`](../contracts/canonical.yaml), keys `task_model.status_semantics` and `project_model.core_statuses`). The shared terminal labels `Done` and `Canceled` do not make these status models interchangeable.

`Failed` belongs only to a Task: it records an attempt that did not get done, at the execution level. A Project has no such status: a mechanism's unsuccessful influence is assessed through a Key Result, not through the state of the mechanism itself.

A Task has no core status `In Progress`: a Task that has been started stays `Next Action` until its state changes. A Project is a bounded multi-step change mechanism and uses its own lifecycle status, including `Active`.

### Derived properties

The formulas and rollups that carry signals ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `signals`) — `Blocked`, `Streak`, the counters of a habit's completions and failed instances, the computed Tags and Area of Focus — form a read-only signal surface. Personal Management System reads them as detector evidence and never writes to them.

They do not become canonical fields: one canonical semantic has one carrier, and `Blocked` repeats what the `Blocked by` relation already carries. In the binding they live in a separate `signals` block, and in the record as read they sit apart from the canonical readings, because the detector must see that these are computations of the workspace, not claims of the model. The contract closes the list of names; the binding does not accept a signal that is not on the list.

Every signal is optional. Its absence is not a degradation: a canonical path to the same fact exists and stays valid, only more expensive.

List formulas return **names, not identifiers**: the computed Areas of Focus arrive as a string, “Personal Care”, from which no link can be built. They work as hints, not as relations.

Some of them would be expensive to compute from scratch: the computed Areas of Focus assemble the effective Area of Focus through six traversals across Projects, habits and Key Results. Reading the finished result is cheaper than walking the same path and paying for it with the reads budget.

The time since the last recorded attention is not a signal: it comes from the page's own `last_edited_time` ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `signal_rules`), and the binding does not read the workspace formula `Days in column`. This time resets on any write, including a write by the system itself. That is the point: an edit means that the person or the system paid attention and recorded something, so there is no stagnation. It measures the time since the last recorded attention, not since the last status change, which Notion does not store.

### Dependencies

A dependency is first-class at both levels and is expressed the same way: a symmetric pair of relations, `Blocked by` and `Blocking`, plus the derived formula `Blocked`. The source of dependency evidence is the relation and the statuses of the blockers. The App builds no parallel model of blocking and only reads it from Notion. `Blocked` is a derived signal, not a separate Task or Project status: it shortens the path to the same fact, and the rule does not rely on it alone. The `methodology/` module derives the state of a dependency from the `Blocked by` relation and the statuses of the blockers: a blocker is resolved when it is `Done` or `Canceled`; `Failed` does not resolve a dependency, because what was promised did not come about. The `Blocked` formula computes the same thing at both levels, in Projects and in Tasks — `every(Done ∨ Canceled)`: the signal is empty only when all blockers are resolved. Gate M5 checks the formula in the gate workspace against this rule; `notion check` reports a formula in an installation's workspace that has diverged from the contract. When a dependency determines a Task's current workflow, the canonical status is read as `Waiting For`; the Project status is not rewritten automatically in that case.

### Habits as the physical register of recurring behavior

`Habits` is the canonical name of the physical Notion data source. It stores the definition and configuration of a recurring behavior: the relation to an Identity and an Area of Focus, stacking, offset and the reminder policy. The name of the data source alone does not override the behavioral distinctions between a Behavior System, a Routine and a Habit, which are defined in [the methodology](1-methodology.md) and in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `definitions`.

Execution lives in Tasks: a specific instance points to its habit through the canonical slot `task.behavior_system`; the App enforces the “no more than one” constraint, because Notion does not expose a cardinality limit through the API. The derived `Streak` and the counters aggregate instances.

Personal Management System reasons about instances the way it does about ordinary Tasks; the habit record provides definition context.

### `Date` and `Deadline`

The two properties are independent and different in nature.

`Deadline` is a constraint: the time by which the work needs to be finished. It does not depend on the status and is carried by any non-terminal Task.

`Date` is activation: the time when the work returns to attention. What happens at that time is read from the status:

| Task Status | What `Date` means |
|---|---|
| `Scheduled` | when the work becomes relevant and it is time to do it |
| `Waiting For` | when to check the dependency |
| `Someday/Maybe` | when to return to the decision |
| `Next Action` | not interpreted: a planned date makes the Task `Scheduled` |
| `Done`, `Canceled` and `Failed` | not interpreted |

The adapter reads both properties regardless of status: “not interpreted” is a statement about the behavior layer, not about reading. A `schema_gap` in the status does not stop the date from being read.

The three interpreted rows are not three fields. There is one status, so the activation values do not coexist, by construction. A second carrier would repeat a distinction the status already makes. A constraint does need a carrier: it is orthogonal to the status and coexists freely with an activation — a `Scheduled` Task carries its own `Deadline`, and so does a `Waiting For` Task ([ADR 0010](decisions/0010-date-and-deadline.md)).

`INV-004` `Date` and `Deadline` are independent: each is read from its own property, and a Task can carry both. The status determines what `Date` means, not which field is filled in.

`INV-005` A `Next Action` has no `Date`. A date marks a point in time (when the work becomes relevant, when to check a dependency, when to return to a decision), while a `Next Action` is work that can be started right away: a date on it would mean nothing and would be ambiguous (a leftover from waiting or a plan for the day). So the system does not perform a write after which a Task would have `Next Action` and `Date` together; a transition that clears the date in the same write is allowed, and `Deadline` is outside the rule. [Logical interface of the adapter](#logical-interface-of-the-adapter) describes how the adapter catches every path to a state with both `Next Action` and `Date`. In Chat the write is made with Notion's own tools, without a check by our system, so there the Skill enforces the rule.

`INV-006` The presence of a `Deadline` does not change the status. A `Next Action` with a `Deadline` remains `Next Action`.

`INV-007` When the input is ambiguous (is “Friday” the `Date` or the `Deadline`?), the model clarifies instead of guessing.

A Project has no date of its own: the timing of the work is expressed by the dates of its Tasks.

### Reminder time

Notion's native reminder is not used. The physical `Remind` in Tasks and `Remind before` in Habits have no canonical slot: the binding does not carry them, and the App does not read them.

A reminder is a continuation in `scheduled_checks`: the time the person named wakes a run with the reason `user_snooze`, and a deadline wakes it with `deadline_followup` ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `reason_codes`; the mechanism is in [Scheduler and outbox](#scheduler-and-outbox)). What to say at that time is decided by the run, which rereads the current state; the mechanism is the same for an ordinary Task and for an instance from `Habits`. A cue is a canonical field of a Behavior System and points to a reference value; `Trigger` is not a separate type.

### Traversal direction

`Context`, `Tags` and `Trigger` have no reverse properties: traversal is possible only toward the vocabulary, not the other way around.

```text
Tasks    -> Context, Tags
Habits   -> Context, Tags, Trigger
Projects -> Tags
```

The remaining relations are two-way, and both sides are resolved from the binding.

### Page body

The body has two consumers: Claude, through the Notion MCP, and the App's deterministic reader, which returns the blocks as context.

The body is read **in full**. There are no named sections: the prose that the canonical model names as separate fields — a Project's boundary of the work, the description of a behavior, an Identity's values and Principles, the signals of an Area of Focus, the note on a Task — shares a single carrier, and it is the model, not a parser, that tells them apart.

“In full” includes nested blocks: the content of a toggle or a list item is returned right after its parent, so the tree is unfolded and the reading order is preserved. The cost is spelled out: every block with children costs a separate request, and each body has a ceiling — not a volume policy but a safeguard against a page that would use up the quota before it yielded any content.

The body is fetched on demand, not on every read of a record: there is no reason for a detector that needs only the status to pay for prose. An unread body yields the state “unread” for the prose semantics, not `absent`.

The consequence for capability is that an empty body yields `empty` for all prose semantics of this record (`INV-009`). The state `empty` is determined on each read separately, not in the binding, and no backfill of existing pages is needed: a page without a body is an honest absence, not an error.

The App does not write to the page body — neither the parser nor [system writes](#system-writes-to-notion) do. The person changes the body, on their own or through Claude in the chat (`INV-008`). The Task created by converting an Inbox item has no body either: what did not fit in the title stays in the Inbox item, which sits in the trash and can be restored. The origin comment points to the Task.

### Physical schema properties that determine the adapter

1. `Project Status` is canonical, so no normalization is needed. The canonical list is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `project_model`.
2. `Task Status` carries the value `Hidden`, which lies outside the canonical model. Handle it according to [ADR 0005](decisions/0005-hidden-task-status-non-canonical.md); the handling contract is [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `known_non_canonical`.
3. Statuses are mapped per option ID; Notion status groups carry no semantics (see [Logical interface of the adapter](#logical-interface-of-the-adapter)).
4. `Date` and `Deadline` are two independent properties; what `Date` means is read from the status (see [`Date` and `Deadline`](#date-and-deadline)).
5. Read `Effort points` as evidence; do not use them to forecast timing. For the evidence-only reading of derived properties, see [Derived properties](#derived-properties); for the detector ontology, see [`docs/3-policy.md`](3-policy.md).
6. The volume of data in a personal system is small: it does not provide statistics for thresholds. Calibrate detector thresholds on synthetic scenarios, not on an installation's data. The calibration risk is `S8` in [`docs/5-plan.md`](5-plan.md).
7. `Context`, `Tags` and `Trigger` are one-way (see [Traversal direction](#traversal-direction)).
8. Relation properties in MCP output return the paired property of the opposite side. Extract IDs through REST.
9. The Notion API does not expose a relation's cardinality limit. “No more than one” is an invariant of the App's behavior, not a property of the schema, and it is checked on write, not on read.

Item 8 is the boundary between two surfaces of the same workspace: MCP output and REST differ in which side of a relation you look from, so the property IDs for the adapter are taken through REST.

---

## App — structure and mechanisms

### Module map

```text
app/src/
├── config/                  — environment validation and the config namespaces of the whole application: time zone, language and port, throttler limits
├── platform/                — a neutral foundation; it does not depend on any App module
│   ├── config/              — the value of an environment variable: an empty value is absent, and a required value is either present or refused
│   ├── db/                  — PrismaService, health, the check of the schema against the image, recognition of Prisma errors, the value for a jsonb column, SQL fragments for status and age
│   ├── di/                  — a port that takes the adapter if the adapter has registered itself, otherwise a fallback
│   ├── error/               — the base class of App errors, the message and stack of any exception
│   ├── queue/               — the lease mechanism: candidates, claim, lease-owner fence, release, postponement, recording an attempt, retirement, pruning
│   ├── worker/              — the background-work loop: non-overlapping ticks, stop, the background-work switch (`workers.config.ts`)
│   ├── request/             — a capability request: schema validation with all problems reported together; a refusal is a single flag for the transport
│   ├── time/                — the boundaries of the local day and the local time in a given time zone, validation of an IANA time zone name, the occurrence of a schedule, the instant of a calendar value
│   ├── text/                — traversal of a nested record: every text value at every level is replaced with the result of a function (redaction of secrets, truncation of long texts)
│   └── types/               — type-level assertions: if the shapes diverge, the build fails
│
├── generated/               — the Prisma client from `schema.prisma`: generated, not tracked in git
│
├── notion/                  — the Notion boundary: REST, binding, semantics; intake/notion/ knows the shape of the webhook
│   ├── client/              — deterministic REST client, pages and bodies in canonical form, PropertyId, physical questions about a property, the live schema, a data source query, the comment reader, NotionWriter, the only boundary for system writes
│   ├── binding/             — the binding of the canonical model to the workspace: the file format, the model with canonical IDs, the check against the live workspace
│   ├── semantics/           — the semantic adapter: the only reader of the binding outside it, decoding a record and encoding a system write, a query for records under canonical conditions, the binding with live names for the model, the Notion failure class
│   ├── workspace/           — the physical Notion schema per `contracts/notion-workspace.yaml`: reading and checking the live workspace, building the databases and their ledger, formulas to enter by hand, the binding from names to ids, the binding template, the operator command `notion` (`build`, `check`, `template`); the running App does not load this directory
│
├── methodology/             — the rules of the methodology over records that were read: the status lifecycle of a Task and a Project, the candidate for Available Now, what is left to settle in a closed Project, candidates for questions in a paused one, a dependency and its contradictions; pure functions with no state and no I/O, not model tools
│
├── knowledge/               — the GBrain knowledge rules over pages that were read: building and parsing an anchor by convention, exact identity in three states and where a write will land, the shape of a memory entry by kind, schemas for parsing GBrain responses, write authority; pure functions with no state and no I/O, which App code calls
├── memory/                  — system writes to GBrain memory: the App's GBrain client, exact identity over the live GBrain, an anchor by convention together with the first write, writing an event, a decision, a fact and the acceptable state of an Area of Focus — one per object; the operator command `anchors:check`, a read-only check of the main GBrain's anchors
│
├── telegram/                — the Bot API adapter, shared by both directions of the channel
├── texts/                   — the texts the App itself uses to speak to the person: the catalog of each language (`uk`, `en`), the shape of the catalog and the list of languages
│
├── intake/
│   ├── receipts/            — webhook_receipts: dedup and the receipt lifecycle, shared by all sources
│   ├── notion/              — the webhook: signature, event author, a reply in the system's thread, relevance gate, debounce, evaluation_windows and their description as a run queue
│   └── channel/             — a person's reply in a dialogue that the system started: the channel webhook, ChannelInbound, the intent router to the owners, ChannelReply, a person's reply to a system message, written into the Notion thread before the model's first step; text outside a dialogue is rejected
│
├── runs/                    — the run: the trigger envelope and origin, who acts (Actor), the toolset of each mode, the plan quota, the daily limit and the circuit breaker, the run gates, run priority, admission, the run trace (the run_traces ledger, the snapshot and its lists), the dispatcher, the scheduler over the RunSource port, the run-row rules (RunRowSource) for lease queues, the ports RunLauncher, RunEffects, BreakerNotice and NotionWaitNotice (a message to the person whose reply in the channel is waiting for Notion)
├── scheduling/              — wiring the scheduler over the run sources; the list of sources, which pruning also reads
│
├── continuations/           — continuations: the capability service, scheduled_checks and their description as a run queue, the WakeFailureNotice port (a message about a wake that did not take place)
│
├── attention/               — the system's attention: a comment in the system's voice, the registry of discussions that it manages
│
├── maintenance/             — pruning over the owners: receipts, concluded rows of the run queues (through their sources), old discussions of the system
│
├── delivery/                — system → person; the delivery service is the only entry to the queue; adapters for the ports ProposalNotice, BreakerNotice, WakeFailureNotice, NotionWaitNotice and ClientNotice (`delivery-notices.module.ts`)
│   ├── outbox/              — notification_outbox, retry, one delivery in the queue, quiet hours
│   ├── port/                — NotificationChannel, OutboundMessage, the channel registry
│   └── channels/telegram/   — the D7 adapter: rendering and the button format
│
├── approvals/               — the approval service: run proposals and the person's decisions, the proposal schema, its effects and validity rule, the ProposalNotice port (a message about a proposal's fate)
│   ├── contracts/           — pending_actions: the store, statuses, the change fingerprint
│   ├── preconditions/       — DSL and evaluator
│   ├── executor/            — executing an approved change as a system write, statuses, the attempt limit
│   └── publication/         — publishing a proposal's fate: the trail in its thread and the message in the channel
│
├── effects/                 — the App's writes: two write policies over one table of kind owners — staging with a recheck and applying in the order of kinds (run), and applying immediately (chat)
├── mcp/
│   ├── server/              — the App MCP: endpoint, run sessions with a bearer and chat sessions, the tool table over the capability services, the assistant's name and grammatical gender for `runtime_read` (`assistant.config.ts`)
│   └── oauth/               — the authorization server for the chat: client registration, the owner's consent, tokens with rotation, information for the client, the ClientNotice port (a message to the owner about a connected client)
│
├── claude/                  — the RunLauncher port adapter, the run profile, the tool perimeter in the SDK's form
│   ├── runner/              — the Agent SDK `query()`: the call (the options and the init expectation derived from the same values), the environment, the stream observer (facts), the init check, the classifier (the outcome from the facts)
│   └── result/              — the result schema in zod and draft-07, evidence validation
│
├── capture/                 — the system's intents over the Inbox: converting an item into a Task, closing without a Task, parking an item that did not get resolved
├── credentials/             — connector_credentials and encryption
│   ├── notion-mcp/          — Notion MCP grant: authorization with PKCE, refresh under a lock, keepalive
│   └── gbrain/              — the GBrain token
├── sweeps/                  — the App's work as time passes: the periodic safety sweep (candidates by the rules of the methodology, the memory of wakes, tick and day bounds) and resolved-thread reconciliation (scope, thread anchor, the memory of conclusions); both wake a run with a continuation and draw no conclusions about the domain
├── reviews/                 — scheduled reviews: the daily / weekly / strategic / deep schedules in the config namespace, an occurrence as a row per period (`review_occurrences`) and their description as a run queue, the occurrence producer with a delivery channel as a precondition
└── observability/           — health
```

A gate is an acceptance test of the App, not its code, so it lives with the tests: `app/test/gate/` holds the commands of gate M3, gate M4, gate M5, gate M6, gate M7, gate M8 and gate M9, a shared entry point (`gate-boot.ts`), a second App instance on loopback with cleanup on a signal (`gate-session.ts`), runs through the dispatcher, a verdict with a list of residue, scenario worlds in the workspace and GBrain, verdict comparison (`gate:compare`, `app/tools/gate-compare.ts`) by the rule from [gate M6](../infra/GATE.md#gate-m6). `app/test/gate/` also holds the preparation of the gate environment (`workspace/`: building the gate workspace per the contract `contracts/notion-workspace.yaml` together with the gate overlay, its check and binding, a check that the gate integration is not from the main workspace, a check of the connectors' credentials; the build engine lives in `src/notion/workspace/`). The gate code imports the App from `src/`, while the App imports nothing from the tests. A gate is not part of the main App image: a separate build target, `gate`, compiles it. The project maintainer runs a gate on a local machine, in the gate's own environment (see [`infra/GATE.md`](../infra/GATE.md)).

The `notion/client/` module implements the deterministic host-controlled operations described in [Domain writes, approvals and execution](#domain-writes-approvals-and-execution); `notion/client/body/` implements the body reading described in [Semantic adapter](#semantic-adapter); `delivery/channels/telegram/` and `intake/channel/telegram/` are the two directions of [ADR 0007](decisions/0007-telegram-first-delivery-adapter.md), and `telegram/` is the Bot API adapter shared by both.

`INV-078` `platform/` imports no App module except the generated Prisma client: modules depend on it, not the other way around. The rationale is in [ADR 0011](decisions/0011-capability-modules-over-platform.md).

### Integration contract Notion

Notion has three integration paths:

```text
App -> HTTPS -> Notion REST API
Notion -> HTTPS webhook -> Caddy -> App
Claude -> Notion MCP
```

The official hosted endpoint:

```text
https://mcp.notion.com/mcp
```

Direct Claude Chat uses a user-authorized Notion connector.

For App-triggered Claude, the App supports a separate authorized Notion MCP session with OAuth Authorization Code + PKCE, token refresh and secure credential storage.

The grant follows the provider's rules. The access token lasts eight hours. The refresh token is rotated on every refresh, and the one it replaces is revoked. Thirty days without a refresh, or one hundred eighty days from authorization, kill the grant, and `invalid_grant` after that is terminal: the person is needed. Hence three rules for the App:

- only the App refreshes the grant, and only under a lock on its row ([`connector_credentials`](#connector_credentials));
- the App refreshes it rarely: when a run is short of token lifetime and when the grant has not been refreshed for a week. The keepalive worker handles the second case, independently of the runner switch ([ADR 0013](decisions/0013-runner-explicit-switch.md));
- two weeks before the ceiling, the App warns that re-authorization is needed.

Authorization is a one-time command in the App image (RUNBOOK §6.3). The command performs discovery, dynamic client registration and PKCE `S256`, and the person only opens the link and pastes the address they were redirected to. A public address is not needed for this.

Notion MCP OAuth state differs from the App's deterministic Notion REST integration credential.

Claude uses the native Notion MCP when it needs to explore the workspace, traverse relations, read discussions, find related objects or perform a native Notion operation that policy allows. The App uses deterministic REST when the operation is technically determined in advance. Both access paths work with the same authoritative workspace and are not two sources of data.

### Integration contract GBrain

The production GBrain MCP endpoint:

```text
https://brain.example.com/mcp
```

App-triggered Claude uses an App-owned GBrain OAuth client:

```text
grant: client_credentials
scopes: read write
source: default
federated read: default
admin scope: absent
```

The App obtains an access token through a Docker-internal endpoint:

```text
http://gbrain:3131/token
```

`GBRAIN_CLIENT_SECRET` stays in the App. Claude receives only the access token, which it uses to read. The App uses the same client to write the memory entries that the system makes on its own behalf: a run and the chat only state the entry as the intent `record_memory`. The App keeps the token in memory until it expires and does not store it in `connector_credentials`: `client_credentials` issues a new one at any time, and a stored bearer would be one more secret in the database with no benefit.

GBrain itself enforces the client's scopes, not the run's options: the scopes limit what the server is willing to serve at all, regardless of the allow-set.

The second server-side lever, the surface ceiling, stays `full` and is not a way to narrow ([Runtime baseline GBrain](#runtime-baseline-gbrain)): narrowing within `full` is done by the run's allow-set (see [mode → toolset](#mode--toolset)).

Direct Claude Chat and other external MCP clients use separate GBrain credentials and do not share the App credential.

Gate M5 also calls GBrain directly with the App client. In the gate environment this is the gate's GBrain client, which writes only to the `gate` source and reads only from it ([`infra/GATE.md`](../infra/GATE.md#gate-environment)). Gate M5 calls GBrain only to write, find and delete the anchor of the Project in its own world: the gate itself prepares and cleans up the world in which a run looks up an anchor by exact id. Gate M6 and gate M7 do the same with the memory pages of their scenarios — anchors by the convention in [Canonical anchors](#canonical-anchors), a lesson and the page of a similar Project; their names do not mention the gate, because the model's search sees them. Gate M7 also reads pages, the timeline and facts back, to compare the state before the run and after it. The command `anchors:check` calls GBrain through the same App client and only reads. Runs see GBrain through their own matrix rows, separately from this client.

### Webhook intake

```text
Notion webhook
  → signature verification
  → webhook_receipts INSERT ON CONFLICT (source, external_id) DO NOTHING
  → authorship — an event whose authors are all our bot is the system's own write
  → a person's change on a page with a proposal — a request to check its preconditions
  → relevance gate — by event type, not one rule for all
  → debounce and coalescing on page_id — an `evaluation_windows` row
```

The queue ends in a window, not in a run: the next edit of the same page is absorbed into the same window, so querying the run budget at intake would mean querying it about a run that may never exist. The limit is checked when the window comes due ([Observability and cost](#observability-and-cost)).

Changes have two authors ([System writes to Notion](#system-writes-to-notion)). The system writes only through the App and REST, and Notion attributes its writes to the integration bot; Notion attributes Claude's writes through the Notion MCP to the person, and they are indeed the person's writes. So the system's own write is recognized by the author of the event.

**An event is the system's own only if all of its authors are our bot.** `authors` can list several authors and mix a person with the bot: Notion aggregates a person's write and the system's next write into one event. An event with mixed authors contains an action by the person and is processed. An event with at least one other author — a person, a foreign bot, a bot without an id — or with no authors at all is processed as a person's change: erring on the side of a run is cheaper than missing the person's words.

The App asks Notion for the bot's identifier (`users.me`) instead of taking it from the environment: it is a property of the issued token, and a second copy would diverge from it when the credential is replaced. This does not make the identifier a hard startup dependency, but an event cannot be classified without it: while the identity is unknown, the receipt stays `failed` and the provider redelivers. The event is not lost and is not processed as a person's change by guesswork.

`INV-018` A person's change is not suppressed: only an event whose authors are all the integration bot is the system's own write.

`INV-087` Intake classifies an event by its authors: when all authors are the integration bot with its id, the event is the system's own write; anything else is a person's change. While the bot's identity is unknown, classification refuses and the provider redelivers.

**A person's change can overtake a proposal.** A property-change or page-deletion event whose author is a person calls for a check of the preconditions of the proposals awaiting a decision on that page. The check comes before the relevance gate and does not depend on it: a precondition may look at a property whose change is not worth an evaluation ([Approval differs by who performs the write](#approval-differs-by-who-performs-the-write)). The executor performs the check, not intake: intake does not evaluate preconditions.

**A person's reply in a discussion the system manages is a separate origin.** A person's comment in such a thread ([System-managed attention episodes](#system-managed-attention-episodes)) is absorbed into the page's window with the fact `person_replied`, and the window's run becomes a reply by the person (`managed_discussion_reply`): the class “the person speaks”, exempt from the daily limit ([Run priority](#run-priority)). A comment outside such a thread remains an ordinary page change. A `comment.created` event carries both `discussion_id` and `page_id` in `data`: intake takes the thread from `discussion_id` and puts it in the envelope, and takes the page from `page_id`, because the `entity.id` of a `comment.created` event refers to the comment itself.

**An item the person put in the Inbox is also a separate origin.** A page that the person created in the Inbox database in Notion is absorbed into the window with the fact `inbox_item_created`, and the window's run is the processing of an Inbox item (`inbox_capture`) in `dialogue` mode: the class “the person put an item in the Inbox”, exempt from the daily limit. Intake takes the database from `data.parent.data_source_id` of the `page.created` event, and the database type from the binding. An item that the system itself put in does not get this far: the author filters it out. An external channel creates no Inbox items, so the `inbox_item_created` fact concerns only pages that the person put in Notion themselves.

**The relevance gate is derived from the binding.** The list of slots is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `relevance_gate`; property IDs are taken from the binding, and there is no second list of them. A slot declared `absent` has no identifier; the gate does not see it, and this is visible at startup.

The list is one-sided: relations in Notion are two-way, so attaching a Task to a Project produces an event on both the Task and the Project, and the debounce merges the events of a **page**, not of a logical change. Both sides in the list would give two runs for one action, so the list takes the side where the decision lives: `task.project`, not `project.tasks`. `Tags`, `Effort points` and the computed properties are not included: the first two are not canonical, and the computed ones are read as `signals` and change after the fields they are derived from, so a run on them would be a second run for the same change. `Priority` is not included either: it has no canonical slot (`DEF-33`), so a run woken by it cannot see it.

The binding and REST hold property IDs in percent-encoded form (`K%7BhG`). The form of IDs in an event is not measured: a captured event carries only IDs without special characters (`TZZi`), while Notion's official example shows the encoded form. So the comparison runs over the canonical, decoded form, and every source is converted into it once, at the point of entry and by its own rule: the binding strictly, REST and the event once and without exceptions; the database and the envelope already hold the canonical form. Decoding is not idempotent, so the form is guessed from the content only at these entry points, and an ID that looks encoded and comes from the model is not accepted at all. Without the conversion the intersection would be empty on statuses and relations in particular, because their IDs contain special characters. The risk of this choice is that, if the webhook in fact sends the raw form, an ID with a sequence like `%41` would be decoded wrongly. The receipt stores IDs as they arrived, so the form on the wire is visible in the data.

The IDs of pages and threads that come from the model (comments, proposals, continuations, deliveries, memory entries) are reduced to one form, hyphenated and lowercase: the model may take an id from a URL, where there are no hyphens. The Notion MCP shows the model a thread as the address `discussion://<page>/<block>/<thread>`, so the App also takes the thread from the address (its last segment): REST and the thread registry know only the id. IDs from the webhook and from REST are already in this form.

**The intersection rule applies only where a list exists at all.** In the payload the field is called `updated_properties`, and `page.created` **never** carries it — under any name. So relevance is decided by the event type. The creation of a page is relevant by construction, and so is a new reply in a thread. An edit of the body (`page.content_updated`) is decided by the page's database. `page.deleted` does not open an evaluation window and is recorded as discarded with a reason. Only the rest goes through the intersection. The name `updated_property_ids` stays with the field of the **envelope** that goes into the prompt: the renaming happens at the boundary, once.

**A person's reply in the channel to a system message is the third origin** (`channel_inbound`). The Notion webhook filters out a bot's write by its author, and the App writes the person's reply from the channel into Notion in the bot's name, as a quoting comment in the thread the message belongs to. So the window is opened not by the webhook but by the channel consumer ([Telegram — channel adapter](#telegram--channel-adapter)). The consumer folds the facts `channel_inbound` and `person_replied` into the same window of the thread's page, and the thread (`discussion_id`) goes along with them. There is one window per page, whatever opened it. The origin `channel_inbound` ranks above a reply in a thread, and a reply in a thread ranks above a new Inbox item: they share one run-priority class and one exemption from the daily limit, because the person is speaking for themselves. The envelope carries `type: channel.message`, `event_id: telegram:<update_id>` and the page and thread identifiers, but no content (`INV-030`). The run's mode is the thread's mode ([`system_discussions`](#system_discussions); [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `evaluation_window`). Text that is not a reply to a system message opens no window: the channel does not accept it.

Channel inbound is a separate path with its own authentication. What it shares with Notion is the public base URL ([ADR 0003](decisions/0003-ngrok-single-public-base-url.md)) and the receipt lifecycle: deduplication, refusal with a reason, and a failure that is recorded on the row. The work on a receipt sees it as a `ReceiptHandle`: a redelivery gets from it the page of the thread in which an earlier attempt has already commented, and writes no second comment.

#### Subscription verification token

The Notion webhook subscription is confirmed with a one-time `verification_token` that is sent to the endpoint. This token **is** `NOTION_WEBHOOK_SECRET`: the same key verifies the signature of every later delivery. The endpoint accepts a request with the token without a signature only in the provisioning window, when `NOTION_WEBHOOK_AWAITING_VERIFICATION` is explicitly enabled: otherwise an untrusted body would decide the question “does this request need a signature”. Outside the window the file with the token does not appear at all, so there is no way to slip the operator a foreign value.

The value goes not into the log but into a file on tmpfs (`/run/app/verification_token`, directory `0700`, file `0600`): the log lives in a rotated file next to Postgres, and there is no way to erase a single line from it, whereas tmpfs is erased by the same restart that closes the provisioning window. A failed write returns a 5xx: the provider redelivers, and the operator sees that the mount is missing — answering 200 without storing the token would lose it silently. The shape of the value is limited by length and character set: the operator copies the file into a secret, and nothing but the token needs to get into it. The procedure is in `RUNBOOK §6.2`.

### Scheduler and outbox

The queues are Postgres-backed, with a single App instance. A row is claimed by one atomic `UPDATE` whose condition requires the row to be open, due, not under a live lease and, in a run queue, not waiting for Notion (below):

```sql
UPDATE scheduled_checks
   SET locked_until = now() + :ticket
 WHERE id = :id
   AND status IN ('pending', 'running') AND run_at <= now()
   AND (locked_until IS NULL OR locked_until < now())
   AND (notion_hold_until IS NULL OR notion_hold_until <= now()
        OR reason_code = 'user_snooze')
RETURNING id, locked_until;
```

The run queues claim exactly one row this way — by id, right before its run ([Run priority](#run-priority)). The delivery queue claims a batch: the same condition sits in a subquery with `FOR UPDATE SKIP LOCKED`. In both cases the claim is a single statement, not a two-step transaction: a statement runs in an implicit transaction, so a process killed midway does not leave a row half-claimed.

Lease-based locking gives crash-safety: an expired lease releases its row automatically. For this to work, the selection filters **by lease expiry, not by status**, which is why the status list includes `running`. The status says where the row is in its cycle; `locked_until` says who is currently working on it. A run that crashes after the claim leaves the row `running` with an expired lease, and the next tick makes the row claimable again. That is what the criterion “a continuation survives a restart” means. The statuses and the selection rule are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), keys `scheduled_check` and `runtime_record_rules`.

The lease mechanism (`platform/queue/`) is shared by four queues — the three run queues (`evaluation_windows`, `scheduled_checks`, `review_occurrences`) and the delivery queue. It consists of the atomic `UPDATE`, the lease stamp, the lease-owner fence, releasing, postponing, recording the attempt, retiring exhausted rows and pruning concluded ones. The lease-owner fence, the lease release and the `updated_at` transition timestamp are each written exactly once. A copy in every queue or in every disposition is a chance to get wrong the one thing crash-safety depends on, or to forget one of the three. The protocol sets the timestamp because the Prisma client sets it only on **its own** writes, and the pruning of concluded rows depends on it: pruning measures a row's age from its last transition. Whatever differs between the queues stays a visible SQL fragment in each of them: the due-time column, the statuses, the order, the retirement rules, what “the row has not changed” means and which due row is currently left unclaimed. The protocol itself wraps each of these fragments in parentheses: otherwise an `OR` in a queue's condition would break out of the whole condition, and with it out of the lease-owner fence.

The **run-row rules** (`runs/run-row-source.ts`, ADR 0018) build on the lease mechanism and are written once for all run queues. The attempt is recorded before the run, together with the status `running`. A completed run concludes the row if the row did not change while the run was going; if the row did change, it goes back to the queue and its attempt is refunded. If there was no run, the row is released unchanged. If the run failed, the row is released with a reason. If the run hit the plan quota, the row is released with the attempt refunded. If the run did not reach Notion, the row is released with the attempt refunded and placed on a Notion hold (below). The run request is built from the row that was just claimed. If it cannot be built, the row is released at once and unchanged, and the error propagates: otherwise the row would stay under its lease until the ticket expires. A row's lease lasts as long as the run's ticket, and the attempt limit is a number set in the budget. Maintenance prunes concluded rows through the same rules: a `done` row is a copy of the run trace, a `failed` row stays as evidence.

A run queue adds to the rules only a **description**: the table and statuses, the due-time column, the run-class columns, what “the row has not changed” means and what to write to a superseded row, its own retirement rules (after the attempt limit), the origin and the trigger envelope. Copies of the rules in every queue would diverge from one another, so a new run queue is a table, a description and a source class, not one more implementation. The queue repository keeps the producer's work: folding events into windows, scheduling continuations and moving rows.

The **run scheduler** (`runs/run.scheduler.ts`), one per process, sits on top of the rules. For the scheduler the run queues are sources behind a single port (`RunSource`): a source retires rows that will do no more of their work, lists the due candidates, disposes of the claimed row after the run and prunes its own concluded rows. Each candidate includes its row's claim, so the scheduler does not look a source up by name. The scheduler chooses the disposition from the run's outcome, once for all sources. There is one list of sources (`scheduling/`): the scheduler and pruning both read it, so a new source is a line in that list and needs no separate call in pruning.

The self-releasing lease has a flip side: a row whose leaseholder has merely **hung** will be reclaimed, and the hung work will eventually finish and want to record its outcome. The row id is not enough for this, since it stays the same after the reclaim. A disposition of a claimed row (conclude, release, postpone, record the attempt) therefore takes **the claimed row itself**. The condition of the write includes the `locked_until` stamp that the owner's own claim set. A stale owner appears only when its lease has expired, and the reclaim sets a stamp later than the stale owner's. So this stamp is the owner's token, and no separate counter field is needed. The stamp comes back from the same `UPDATE` that claimed the row, not from a later read, which could find someone else's lease already in place. By its type the stamp is never empty: without it the fence would have nothing to compare, a disposition would silently fail to apply, and the row would be processed a second time. A write that was not applied returns `false`. The queue itself logs this, not whoever disposes of rows through it: the log entry is the only trace that the work was most likely done twice, and no disposition made by any lease owner has to remember to log it separately. For `evaluation_windows` and `scheduled_checks`, `version` is added to the stamp: it catches a different loss (the row changed under the run), and neither of the two conditions replaces the other.

A run denial does not change the origin row: not its time, its attempt counter or its status. A continuation the person named “for Monday” stays for Monday, no matter which denial catches it: what waits is the scheduler, not the row. Only the delivery queue moves a row's time: quiet hours and backoff move the `next_attempt_at` of a row that is not yet due. A run row whose run did not reach Notion waits through a separate mark, not through its time (below).

`INV-084` A run denial does not change the origin row — neither its time, nor its attempt counter, nor its status. A row that the denial finds claimed is released in the state in which it was taken.

What `attempt_count` counts, and why it counts that way, is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `scheduled_check`; evaluation windows count the same way. The mechanism: the dispatcher records the attempt before launch, under the lease-owner fence, together with the status `running` — so `running` means that the row's run actually started. The attempt is refunded when a run ends with the row changed, when it hits the plan quota and when it does not reach Notion. In these three cases the same statement that releases the row refunds the attempt. A row that has exhausted the limit moves to `failed` with `last_error` and is not made claimable again; the source makes the transition at the start of each scheduler tick. The limit is set alongside the budget: `run_budget.work_row_max_attempts`.

The attempt limit does not stop a row that deterministically throws an exception **before** it calls a run. That row is not charged an attempt, because it spends nothing: it launches no runs and only writes to the log on every tick. This is a deliberate choice of loud repetition over the silent loss of a real event. The window of a row that throws before calling a run is eventually retired by the aging rule ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `evaluation_window`); a continuation is retried until the exception is fixed.

When a wake whose time the person named (`user_snooze`, `deadline_followup`) exhausts its limit, the App tells the person, because there was no run that would have done so, and silence is the worst kind of failure here. Every minute the continuations worker (`continuations/wake-failure.worker.ts`) takes the `failed` rows of such wakes that have no `failure_noticed_at` and calls the `WakeFailureNotice` port. The port's adapter lives in delivery and queues a system message. The message says which reminder or deadline check did not take place and for what time in `APP_TIMEZONE`, and it carries the wake's thread and a link to the page. The delivery key is the one the run of that wake would have set: `event:` with the row and its version. So a reminder that the run managed to queue before it failed stays the only one, and a failure between queuing and marking repeats the same key. The message breaks through quiet hours using the same classifier that a run's reminder uses. There is no message for a wake whose time the system chose, because its failure is visible in the run trace. The rationale is in [ADR 0045](decisions/0045-notion-unavailability-and-person-timed-wake.md).

`INV-108` The person is told exactly once about a wake whose time the person named (`user_snooze`, `deadline_followup`) and that did not take place: a `failed` wake yields one message with the delivery key that the run of that wake would have set, with its thread and page, sent regardless of quiet hours. A reminder the run managed to queue stays the only one, while a wake whose time the system chose, and wakes that are not retired, yield no message.

**A run that did not reach Notion** does not fail its row: the App retries the same run ([ADR 0045](decisions/0045-notion-unavailability-and-person-timed-wake.md)). The App sees for itself that Notion is unreachable and does not take the model's word for it. There are three pieces of evidence. The first is that the refresh of the Notion MCP access failed with a refusal that clears on its own (`ConnectorUnavailableError`: network, timeout, HTTP 5xx or 429). The second is that init stopped the run solely because the Notion server does not respond ([Runner MCP connections](#runner-mcp-connections)). The third is that the run returned the reserved label `source_unreadable`, and at least one of its Notion calls failed while none succeeded. The writes of a run that did not reach Notion are discarded, and the row gets the “wait for Notion” disposition. The attempt is refunded, and `notion_hold_until` sets a pause twice as long as the row's consecutive wait so far (measured from `notion_held_since`), clamped to the range from `notion_hold.min_minutes` to `notion_hold.max_minutes`. Like concluding, the disposition is subject to the lease-owner fence and the condition “the row has not changed”: a row changed under the run already has something else in it — a snooze or a person's reply — and gets only the refunded attempt. The condition “not waiting” applies in choosing the heads and in the claim, but not in retirement. A waiting row does not occupy the head of its group, while the attempt limit, the review's occurrence window and the aging of an evaluation window apply to it as well.

The wait is lifted by a change to the row — a moved continuation, a person's event that is folded into the window — and by a run that reached Notion (at least one of its `notion` calls succeeded). A run that reached Notion lifts the pauses of the rows of all sources. Each row's pause is lifted at most once per consecutive wait. A row that was already waiting at an earlier lift and again fails to reach Notion while Notion is answering other rows most likely has a fault of its own, and an immediate retry on every success of another row would bypass its pause. The time of each row's first deferral is kept until the row's own run reaches Notion. A row that has waited `notion_hold.limit_hours` no longer waits: an ordinary failure follows, which the breaker sees, and the failure signals a long outage. A person's snooze never waits — a reminder on time or not at all. The run of a snooze that did not reach Notion fails with a flag the breaker does not count, and past the attempt limit the App tells the person (`INV-108`). The pause and the limit are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `scheduled_check.notion_hold`.

`NotionMcpGrant` protects access to Notion for the duration of a failure: after a refusal that clears on its own, subsequent runs get the same refusal for two minutes without calling the provider. Without this pause each row would refresh the token itself, and a refresh whose response was lost rotates the refresh token and kills the grant. A snooze bypasses this pause: its three attempts fit into half a minute, and the pause would disrupt a reminder during a one-minute failure.

A person who replies in the channel while Notion is unavailable is not met with silence. The evaluation window of the person's reply (`channel_inbound`) waits, and the dispatcher, through the `NotionWaitNotice` port, queues one message in the same thread, saying that Notion is unavailable and that the answer will come as soon as it is back (key `notion-wait:<window>`). A window that has waited `notion_hold.limit_hours` yields a second message, saying that the answer could not be given and asking the person to write again (`notion-gave-up:<window>`). Both break through quiet hours, because the person has just spoken and is waiting. The keys are a namespace of their own, not the run's key, because the real answer after recovery must not be dropped as a repeat (ADR 0025). A reply that could not even be written to Notion does not open a window ([Telegram — channel adapter](#telegram--channel-adapter)).

`INV-109` A run that did not reach Notion writes nothing and sets no continuations, and the App retries the same run: the attempt is refunded, and the same row waits out a pause that grows with the time it has spent waiting consecutively; other rows, including those of the same group, carry on as usual. A change to the row and a run that reached Notion lift the wait; a row that has waited longer than the limit no longer waits — an ordinary failure follows, which the breaker sees; a person's snooze never waits. The pause and the limit are set by policy (`docs/3-policy.md` § “Notion unavailability”).

`INV-019` `reason_code` uses the `reason_codes` vocabulary and does not classify a semantic issue. The canonical list is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `reason_codes`.

`INV-020` Under `mode: scheduled_recheck` — and, for a thread the App has found resolved, under `mode: closure_processing` — a continuation passes only `type`, `event_id` (the continuation row and its version), `discussion_id?`, `page_id` and `reason_code`. Semantic state does not reach the prompt; the model reads the state again.

#### Run priority

On every tick the scheduler takes four steps:

1. The sources retire rows that will do no more of their work.
2. The scheduler checks the run gates: the readiness of the runner together with the Notion MCP grant, the plan quota, the breaker and the daily limit, and a free slot ([Observability and cost](#observability-and-cost)). The gates are the scheduler's state, not the rows' state: when closed, they write nothing to the rows.
3. From the candidates the gates let through, the scheduler chooses by class. Within a class a fresh row goes before a retried one, and among equals the earlier time goes first. A candidate is a due row that is not waiting for Notion: a waiting row does not become a candidate, and the next row is taken in its place ([Scheduler and outbox](#scheduler-and-outbox)).
4. The chosen row is claimed by id and goes into a run. A tick takes no more rows than there are free slots. If a claim fails, the rows this tick has already claimed are released unchanged and the error propagates: their runs have not started, and there is no reason for them to stay under a lease until the ticket expires.

The classes, highest first, are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_priority`:

- the person speaks: a reply in a thread that Personal Management System manages, a button press or a reply in the channel to a system message;
- a time the person named: `user_snooze`, `deadline_followup`;
- an item the person put in the Inbox;
- a review on the person's schedule;
- autonomous work: change-evaluation windows and continuations whose time the system chose.

A person who is speaking does not wait behind anything: they have just made contact and are waiting for an answer. The time the person named comes next: it is their instruction. An Inbox item is also the person's action, but they are not waiting for an answer at the moment: processing it comes after the time they named and ahead of the reviews, so that a review already sees what has been processed. Autonomous work comes last, and only it is stopped by the breaker and the daily limit — the `autonomous` class is made up of exactly the budgeted origins of `run_budget`. A fresh row goes before a retried one because a retried row has already had its run and failed, while a fresh one has had none: otherwise a row that reliably fails would hold back the rows that have done nothing wrong.

A row is claimed just before its run, so only a row whose run is already under way holds a lease. The dispatcher checks the gates and the slot again, at admission. If the gates have closed or the slot has been taken between the choice and admission, the denial finds the row still claimed and releases it unchanged.

`INV-085` The scheduler takes due origins in the order of `run_priority`: the class, then fresh before retried, then the earlier time. The `autonomous` class is exactly the budgeted origins of `run_budget`.

### Schedule and recurrence

The time the person sets is wall-clock time in the installation's time zone (`APP_TIMEZONE`), not the container's UTC. `platform/time/local-day.ts` computes the instant that a wall-clock time denotes: an hour that the daylight saving transition skips is shifted forward by the length of the transition (in Kyiv, 03:30 becomes 04:30), and an hour that occurs twice in autumn is taken at its first occurrence. The same rule governs the day of the daily run limit, quiet hours and the schedule.

The **schedule** (`platform/time/schedule.ts`) has a closed grammar: `daily HH:MM`, `weekly <mon…sun> HH:MM`, `monthly <1–28> HH:MM`, `quarterly <1–28> HH:MM` (January, April, July, October) and `off`. The day of the month is limited to 28: otherwise a shorter month would lose occurrences.

An **occurrence** is identified by the local key of its period, not by an instant: a date (`2026-10-14`), an ISO week (`2026-W42`; the year of a week is the year of its Thursday), a month (`2026-10`), a quarter (`2026-Q4`). An instant shifts with a clock change and with an edit of the schedule; the key does not: there is one occurrence per period, a transition gives neither two nor none, and a change of time within the period creates no new occurrence.

**Occurrence window:** the window of a daily review lasts until the end of its local day, and the window of any other review lasts until the time of the next occurrence. An occurrence that has not taken place by the end of its window is retired with a reason; a missed one is not caught up, and the next one comes on schedule. Otherwise an App outage would deliver yesterday's review today, and the missed ones in a batch.

**Domain dates** are placed in time by the same rule (`platform/time/calendar-moment.ts`): a day without a time is midnight of that day in the installation's time zone, and the deadline of such a day expires at midnight of the next day; a value with an offset is the instant itself; a local time without an offset is read in the time zone of the date itself or, if the date has none, in the installation's time zone. For a value that cannot be placed (an unknown time zone, a string that is not a date), the rule that queries it asserts nothing about time.

**Scheduled reviews** (`reviews/` in the [module map](#module-map)). The schedule of each review is set in an environment variable, in the grammar above: `REVIEW_DAILY_CONTROL`, `REVIEW_WEEKLY_CONTROL`, `REVIEW_STRATEGIC`, `REVIEW_DEEP`; without the variable a review follows the default schedule ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `review_schedules`). Every minute the producer schedules the current occurrence of each enabled review as a `review_occurrences` row, if the occurrence window is still open; the row is unique per review and period key. Without a configured delivery channel or without the runner (`RUNNER_ENABLED`) a review is not scheduled: the main result of a review is a packet for the person, and without them the packet can be neither delivered nor produced. An occurrence that would only wait for the end of its window would be a failure although nothing has broken. The row belongs to a run queue built on `RunRowSource`, with the origin `review_schedule`. That origin is exempt from the daily limit. A review's envelope carries the occurrence and `since`, the time of the last carried-out occurrence of that review, going back no more than two periods and, on the first occasion, one period: this way a missed occurrence does not lose the changes of its period. Pruning keeps the last carried-out occurrence of each review. The statuses and rules are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `review_occurrence`; the rationale is in [ADR 0036](decisions/0036-scheduled-reviews.md).

`INV-103` A scheduled review has one occurrence per period: a producer retry, a restart, a clock change and an edit of the time in the schedule give no second occurrence and lose none.

The producer reports an occurrence that did not take place to the person in one system message, both after exhausted attempts and when the occurrence is retired past the window. The message says which review did not take place for which period, what went unreviewed, and that you can start the review in a Claude chat. There is no catching up on reviews, and a packet with no findings is silent too, so without the message the person could not tell “nothing was found” from “the review did not take place”. This holds for every review, the daily one too. The message respects quiet hours. The occurrence's `failure_noticed_at` records that the person has been told. An occurrence that the producer did not schedule (the App or its workers did not run for the whole window) is not in the database and yields no message.

`INV-105` The person is told exactly once about a review occurrence that did not take place: the delivery key is the review and the period, so a retry after a failure between the delivery queue and the mark queues no second message.

### Language of texts for the person

Two authors write to the person. The model writes review packets, comments and replies in the person's language, following the Skill's rules. The App itself writes what has to work without the model: system messages (the breaker, a client's connection to the App MCP, a review or a wake that did not take place, a channel reply that is waiting for Notion), proposal fates next to their lines, buttons, captions and channel replies, OAuth consent pages. The App takes these texts from the catalog of the installation's language (`APP_LANGUAGE`, `en` by default): `app/src/texts/<language>.ts`, one file per language in `LANGUAGES`. The rationale is in [ADR 0042](decisions/0042-app-texts-language.md).

Two authors write, but one assistant speaks to the person ([ADR 0049](decisions/0049-assistant-name.md)). The App's texts about the interaction are in the assistant's first person, and in them Claude is where the conversation takes place (“ask me in a Claude chat”), not a second interlocutor. Messages about failures and security say what happened to the system and do not present it as the assistant's conclusion. The App does not insert the assistant's name into the texts: the bot and the integration show who the sender is.

The catalog holds whole sentences: gender, case, plural forms and word order are the grammar of the language, not of the code. The code keeps the delivery keys, the links and the truncation of reasons. The language's format writes dates for the person in words (`texts/spoken-dates.ts`: “27 жовтня о 14:30” in Ukrainian, “October 27 at 2:30 PM” in English). The Ukrainian catalog speaks in the informal second person (“ти”) and takes the grammatical gender it uses to address the owner from `APP_OWNER_GENDER`. In the assistant's first person the catalog speaks without gender forms ([ADR 0046](decisions/0046-system-voice.md)). Measuring a channel packet and rendering it use the same texts, so a packet that fits on entering the queue fits at delivery too. A message already queued stays in the language in which it was queued. The renderer takes the message's captions from the current language, and longer captions can shorten the message body but will not break the message's limits.

Whatever the App does not say to the person is outside the catalog. The marker `Person's reply via <channel>:` is a protocol between the App and the Skill, and the Skill recognizes it verbatim. The output of operator commands and the logs are written in English. A technical reason (`last_error`, the protocol's `error_description`) is evidence and appears as is, under a label in the installation's language. A client's name is data that the client registered.

`INV-106` When the App itself writes to the person, it uses only texts from the catalog of the installation's language, and every catalog is complete and fits within the channel limits: the worst-case message passes the queue and fits into one Telegram message, proposal fates fit into the reserve for a proposal, captions and replies fit their own limits. The App code has no Ukrainian string literal outside the catalogs, and a catalog imports only types.

### Notification channel port

```typescript
interface NotificationChannel {
  readonly id: ChannelId;                    // the adapters the App can have: CHANNEL_IDS
  readonly capabilities: {
    interactiveActions: boolean;             // decision buttons in the message
  };
  excess(message: OutboundMessage): number;  // by how many characters the packet is too long; 0 means it fits
  send(message: OutboundMessage, idempotencyKey: string): Promise<DeliveryReceipt>;
                                             // a success receipt carries `externalId`, the message id, if the channel returned one
  edit?(externalId: string, message: OutboundMessage, settled: ReadonlyMap<string, string>): Promise<DeliveryReceipt>;
                                             // next to decided proposals, append their fates and remove their buttons; not every channel can
}

interface ChannelInbound {
  readonly id: ChannelId;
  parse(raw: unknown): ChannelIntent | null; // approve | reject | snooze | dismiss | reply | unsolicited
}
```

`OutboundMessage` is built as a decision packet: what was noticed, why it matters, what context changes the assessment, what has been prepared, what minimal decision is needed. The proposals the packet asks for a decision on go in a separate field, `proposals`: the id and the line of each, no more than the limit in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `notification_packet.max_proposals`. For the other proposals awaiting the person's decision, a packet with proposals gives a count (`moreProposals`). The App computes the count when it queues the packet, and the renderer reserves room for that line in advance. Buttons derive from proposals: the sender adds “approve” and “reject” for each one, and only for a channel that supports buttons. The channel is responsible only for rendering and delivery. The port is recorded as [ADR 0002](decisions/0002-pluggable-notification-channel.md), the proposals field as [ADR 0039](decisions/0039-daily-review-proposals.md).

The channel serves only a dialogue that the system starts: the person answers its message and starts nothing through the channel on their own ([Telegram — channel adapter](#telegram--channel-adapter)).

The port has two directions with different owners. `NotificationChannel` (system → person) belongs to delivery, `ChannelInbound` (person → system) to intake (`intake/channel/`). They share only the button vocabulary and the channel's own adapter: intake reads back the buttons that delivery renders. No consumer processes an intent taken from the channel: the intent router hands it to the owner of what it changes. Approve and reject go to the approvals made on the person's behalf at the button; reply goes to `ChannelReply`, which puts the person's words into the Notion thread and opens the evaluation window; and `unsolicited`, a text that is not a reply to a system message, is consumed by rejection. The answer to a button press says what happened, not the kind of button. An accepted text gets no reply in the channel: the person sees the result where their work lives. A text that was not accepted or could not be written does get a reply ([Telegram — channel adapter](#telegram--channel-adapter)). The sender adds no buttons besides “approve” and “reject”: the person names the snooze time in words, in a reply to the message, and the words reach the system as a reply, because `user_snooze` is accepted only from the person's words. A snooze press that still gets through carries no time, and the answer to it asks the person to name the time in words.

`INV-021` Buttons derive from proposals: for a channel that supports them (`interactiveActions: true`), the sender adds “approve” and “reject” to each proposal, and for a channel without them, none; in both cases the packet carries the proposal lines, the question and the link.

#### Telegram — channel adapter

| Parameter | Value |
|---|---|
| `id` | `telegram` |
| `interactiveActions` | `true` — inline keyboard → `callback_query` |
| text limit | `4096` UTF-16 code units — the renderer's ceiling, not a capability of the port |

**The channel is only for a dialogue that the system starts.** The external channel is not an ingress into the system but a dialogue the system starts itself: it sends a message (a decision packet), and the person answers that message — with a button or with a reply to it. The person starts nothing through the channel: no new thought, no command, no new topic. What the person raises on their own goes to Notion (the Inbox, a discussion thread) or to Claude Chat. It follows that:

- buttons (`approve`, `reject` — a pair for each proposal) appear on system messages, and the person names the snooze time in words, in a reply to that message;
- a reply to a system message is accepted only when the message belongs to a Notion thread — its delivery row has a `discussion_id`;
- a text that is not a reply to a system message, and a reply to a message that has no thread, are not accepted: the receipt is settled `rejected` with a stated reason, and the text is stored nowhere;
- the channel creates no Inbox items and has no commands: `park_inbox_item` is a chat step only.

Inbound is a webhook at `/webhooks/telegram`. The URL is derived from the public base URL; the `setWebhook` registration is in RUNBOOK §6.1, and it is repeated with every change of this address.

Inbound authentication is two independent checks, because Telegram does not sign the webhook:

1. the header `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET`, passed to `setWebhook`;
2. `chat.id` = `TELEGRAM_ALLOWED_CHAT_ID`.

`INV-022` An update that fails either of the two checks is discarded with no durable effect and no reply to the source chat.

Dedup is the pair `(source, external_id)` in `webhook_receipts`: `telegram` and `update_id`, so the keys do not collide with Notion events. Telegram redelivers on a non-2xx response, so the handler answers 200 after the receipt commit, before the run starts.

`callback_data` is limited to 64 bytes and does not fit an action payload. The button carries only the `pending_action_id`, which is a uuid, so `kind:id` fits the limit by construction (44 bytes), not by a check in the channel: a delivery request that refers to a different id is rejected before it reaches the queue. The executor rereads the record and revalidates the preconditions. This is consistent with the existing model, not an exception: a button is the transport of an intent, not its content.

`INV-023` `answerCallbackQuery` is called immediately after intake — **after the decision is recorded and before it is executed**: the executor does the executing, and recording is a single write. The reverse order would lose the person's decision: the ack is an external call, its failure would give a 500, the provider would resend the update, and deduplication would say “duplicate”. The ack itself is cosmetic here: its failure does not fail the handling, because the decision is already recorded. Executing the approval does not block the ack. The result is delivered by editing the same message (later in this section).

The rate limit is ~1 message/s per chat: a `429` is a failed attempt like any other and counts against the attempt limit, and `retry_after` sets a floor for the pause before the next attempt. The provider's hint is a **floor** under the App's own backoff, not a replacement for it: `retry_after` says the earliest a retry is possible, not when one is worthwhile. A replacement would squeeze the whole profile down to the step the provider specified: a burst of flood-waits of 30 s each would burn through all eight attempts in four minutes, and the message would be lost just when the provider had only asked to wait.

A single delivery gets up to **eight** attempts with exponential backoff. That is more than the attempt limit of a run-queue row, and deliberately so: retrying a delivery costs neither model quota nor a run, while a lost nudge is a silent abandonment of what the system exists for. The number of attempts equals the number of Notion webhook redeliveries; **the window does not**: eight attempts with a starting pause of 30 s and a ceiling of one hour cover roughly 63 minutes, not a day. That is the difference between “surviving a provider failure” and “surviving its unavailability”, and this profile does not cover the second.

A button press is handled in two steps: the handler records the decision and returns, and the executor executes it ([Preconditions and executor](#preconditions-and-executor)).

**The message about a proposal's fate.** The delivery receipt carries `externalId`, the message id that the channel returned (for Telegram, the `message_id` from the `sendMessage` response). A `notification_outbox` row in status `sent` stores it as `external_id`: it is how a person's reply finds the message and how the system finds the same message to rewrite it. A message without an id is still delivered: it just cannot be replied to or edited.

Fate publication ([ADR 0043](decisions/0043-proposal-fate-in-thread.md)) reports the proposal's fate — `approved`, `rejected`, `executed`, `conflict`, `failed`, `expired` — to the `ProposalNotice` port (`approvals/proposal-notice.ts`). It is a separate loop that sees every transition of the row: the person's decision, the expiry of a shown proposal, the end of execution. In the same step it leaves a trail in the proposal's thread. The port's adapter lives in delivery (`delivery/delivery-notices.module.ts`): it finds the sent messages that carry this proposal, records its fate in the [`notification_proposals`](#notification_proposals) row and rewrites each message with all the fates (`editMessageText`). The fate of a decided proposal appears next to it, and the proposal no longer has buttons, while the buttons of the rest stay. This is cosmetic: an edit failure is not thrown and changes neither the decision nor the execution (`INV-023`), and a channel that cannot edit, or a message without an id, is left as it is. The renderer reserves room in advance for the fate of each proposal, so an edited message does not exceed the limit, and the packet body does not change from edit to edit.

Quiet hours are implemented with the “not before” field that the delivery queue already has: [quiet hours](3-policy.md#quiet-hours) postpone a delivery rather than cancel it, and spend no attempts. The worker checks quiet hours before sending, not at enqueue time: there is a single authority, and a row queued a minute before quiet hours start will not go out at 23:01 just because quiet hours had not started when it was queued.

`noticed`, `why_it_matters`, the proposals with room reserved for their fates, `ask` and the link must fit into the channel message in full: a packet that does not fit (`excess`) does not get into the queue, and the refusal says by how many characters it is too long. The renderer itself drops `context` and `prepared` when there is not enough room for them. A packet is never split into several messages — the buttons belong to a single message.

`INV-024` A channel message is not a source of state. The full content lives in Notion; a message about a Notion object contains a link to it.

A notice the App writes about the system itself (a client connected, a review did not take place) is about no Notion object and has no link; the render then ends with the ask. Everything the model queues is about Notion content, so `queue_notification` requires the link ([ADR 0051](decisions/0051-notice-about-the-system-has-no-link.md)).

The Telegram Bot API has no idempotency key, so the gap between `sendMessage` and recording `sent` in the queue cannot be closed atomically. Delivery is **at-least-once**: after a crash in this gap it is retried, and one extra message is acceptable — by `INV-024` both copies point to the same object and the same proposal, and pressing again does nothing. [ADR 0007](decisions/0007-telegram-first-delivery-adapter.md) explains why delivery is not at-most-once.

Exactly-once is left to the **domain effect**: an action is not executed twice. This is guaranteed not by the outbox but by the monotonic status of `pending_actions` and by the revalidation of preconditions that observe the effect. The outbox guarantees something else — that a logical delivery gets into the queue once.

**The person's reply from the channel.** The only text the channel accepts is a `reply`: a reply to a system message (Telegram identifies the message being replied to). All other text is `unsolicited`, and it is consumed by rejection: the receipt is settled `rejected` with a stated reason, and the content is stored nowhere. A reply is accepted only when the message belongs to a Notion thread: delivery finds the queue row by `external_id`, and the row holds the `discussion_id`. The person's words go into Notion before any step of the model: the channel is not a source of state (`INV-024`), the envelope carries no content (`INV-030`), and the person must see their words where their work lives. `ChannelReply` (`intake/channel/`) writes them — the App, over REST, on behalf of the bot — and only then opens the evaluation window with the facts `channel_inbound` and `person_replied` ([Webhook intake](#webhook-intake)).

- **Reply** is a quoting comment by the bot in the thread the message belongs to, under the label “Reply from <channel>”. The comment starts with the marker `Person's reply via <channel>:`, and the Skill reads the comment as the person's words by the run's **origin**, not by the text: the model does not see the label. The thread registry does not change: the thread's mode stays the one in which the system opened it. Text that is too long is split into several consecutive comments: what the person said must not be trimmed.
- **Text outside the dialogue** — a message that is not a reply to a system message, and a reply to a message that has no thread — is not accepted: the words become neither a comment nor an Inbox item and are stored nowhere. The bot answers at once that the words will go nowhere and need to be said in Notion or in Claude Chat; if this reply fails, the intake is not repeated.
- **Notion is unavailable when the reply has to be written:** the write fails with a refusal that clears on its own (a rate limit, a server failure, a timeout, the network). The window does not open: a run would have nothing to process. The bot answers at once that Notion is unavailable right now and the reply should be sent again a bit later. The receipt is settled with a reason: a provider redelivery would arrive at a random time and the person would be told the same thing a second time ([ADR 0045](decisions/0045-notion-unavailability-and-person-timed-wake.md)). This reply is the only trace of the person's words, so it is not cosmetic: if it fails too, the receipt fails, and the provider's redelivery will either write the words or tell the person again. Any other write refusal fails the same way.
- **A redelivery does not duplicate.** The thread's page is recorded in the receipt at once (`ReceiptHandle`), and a redelivery that finds the work half-done takes it from there and does not write a second comment. A narrow gap remains between creating the comment in Notion and recording it in the receipt: a failure in that gap produces a second comment. This is the same class as `GAP-31`, and the applied comment is visible in the thread.
- **The channel consumer does not depend on the model.** It imports neither the runner nor the App MCP: a disabled or unavailable runner does not lose the reply — the comment is already in the thread, and the window will wait for a run. The receipt and the window do not store the person's words: no column for the text, no diagnostic field.

`INV-312` A person's reply in the channel to a system message is written to Notion — as a quoting comment by the bot in the thread the message belongs to — before any step of the model, and only then is the evaluation window opened. Neither the run's trigger envelope nor `app_db` carries the content of the reply. Text that is not a reply to a system message is not accepted: the channel is meant only for a dialogue that the system starts.

The model's clarifying question is delivered through this same channel (`queue_notification`), and the person's answer to it is a reply: it goes into the thread the queue row belongs to. A reply to a message that has no thread is not accepted: the person moves a question that is not attached to a thread into Notion or Claude Chat.

App-owned env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`.

### Boundary notification delivery

The App contains the durable outbox and the delivery semantics. The provider is not part of them: it is an adapter behind the [Notification channel port](#notification-channel-port), like [Telegram](#telegram--channel-adapter).

MVP acceptance requires at least one configured delivery adapter that has passed the retry and idempotency test. Native Notion discussions remain the canonical durable attention history regardless of a separate push channel.

### Trigger semantics

A cognitive cycle can start from Claude Chat, a Notion change, a comment event, the person's reply in a channel, a scheduled recheck, a periodic safety sweep or a scheduled review. Each trigger has its own initial scope, but the behavioral cycle is shared.

#### Conversation trigger

A new message from the person in Claude Chat starts `dialogue`. Claude can read Notion and GBrain as needed, and uses the App MCP if the conversation creates continuation or delivery state that must outlive the current chat, or concerns a proposal awaiting the person's decision. The App does not store a proposal made in the chat: one that is not answered in the same turn stays an Inbox item (`INV-015`).

A captured statement or commitment does not turn into a Task automatically. Claude first determines the nature of the work:

```text
identity or decision rule      -> Identity / Principle
ongoing responsibility         -> Area of Focus
meaningful desired change      -> Objective + Key Results
bounded multi-action work      -> Project
recurring behavior             -> Behavior System
single tracked work item       -> Task
non-actionable information     -> Reference / Trash
potential future action        -> Task: Someday/Maybe
```

The canonical list of destinations a captured item can be resolved into is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `clarify_destinations`.

An Inbox item resolved in conversation is converted into a Task (`convert_inbox_item`) or is closed without a Task: junk, a duplicate of an existing open Task, or a reference already stored in GBrain (`close_inbox_item`). An item that is not resolved is not closed: in the chat it is parked in the Inbox with a comment giving the reasoning (`park_inbox_item`), and an item already sitting there stays with its comment. An item is closed by a conversation step (a `dialogue` run or the chat); the evaluation of changes to an Inbox item does not process it.

After classification the system checks whether an equivalent canonical object already exists. An intention or an idea is not a commitment. A potential multi-step undertaking does not create a `Planning` Project until there is an explicit decision to start work on it.

#### Notion property/state change

A relevant Notion property change starts `event_evaluation`. The App's relevance gate decides which changes are relevant, by property IDs, before Claude is called. The list of slots is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `relevance_gate`; the mechanism is in [Webhook intake](#webhook-intake). A cosmetic property or unimportant metadata does not start a reasoning cycle.

#### Notion content change

A content update is a signal, not a ready-made semantic diff.

An edit to the body of a Task or a Project (`page.content_updated`) opens an evaluation window like any other change: the person writes promises and dependencies in the body. Intake takes the page's database from the event's `data.parent` or, when the event has none, by reading the page. An edit to the body of a page of any other type is dropped with a reason, since reviews read its prose ([ADR 0040](decisions/0040-page-content-intake.md)). The trigger envelope carries `event_types`, the types of all events in the window, so a body edit stays visible even when a property edit closed the window. A window that has absorbed only body edits yields `type: page.content_updated` with an empty `updated_property_ids`. The run reads the body again when `page.content_updated` is among the types of the window.

For large pages, metadata and relevant content are read first; the full page is opened only when needed.

#### Discussion/comment change

A new or changed comment starts a cycle with the exact page and comment context.

A new reply from the person has high priority, because it may contain a clarification, a snooze or information about resolution. A reply in a thread carries no decision on a proposal: the person decides with a channel button or in the chat ([Approval differs by who performs the write](#approval-differs-by-who-performs-the-write)). A reply in a discussion the system manages is a `managed_discussion_reply` run: it comes first in run priority and does not count against the daily limit. The App carries the person's channel reply to a system message into the same thread as a quoting comment by the bot, and the run for a window of that kind has the origin `channel_inbound` ([Telegram — channel adapter](#telegram--channel-adapter)). A comment outside a discussion the system manages is an ordinary page change ([Webhook intake](#webhook-intake)).

#### Scheduled recheck

A continuation that has come due starts `scheduled_recheck` with the `discussion_id`, the page ID and a technical reason code.

Semantic state is not passed from `app_db`. Claude reads the current thread and the operational object again.

#### Periodic safety sweep

An event-driven architecture does not see situations where a risk arises only from the passage of time, or situations whose event has been lost.

The periodic sweep is a deterministic pass by the App (`sweeps/` in the [module map](#module-map)). It reads records with bounded REST queries over the canonical slots, and the methodology rules (`methodology/`) say which situation the states show. The Notion status filter accepts an option name, so the query takes the current name from the live schema by the binding's option id (`INV-081`). The rules have no clock and no time zones: they get the point in time a date stands for, and the current time, as numbers computed under the [installation's time rule](#schedule-and-recurrence).

Candidates:

- a `Waiting For` Task whose check date has come due (`check_date_reached`);
- an open Task with a past `Deadline`, and a `Waiting For` Task whose `Deadline` is closer than the threshold (`deadline_signal`): the work is stalled on a dependency. An approaching deadline on work that can be done is not a risk, and `Someday/Maybe` is not a commitment;
- a `Planning` or `Active` Project with no Task that moves the work (`project_path`);
- a `Paused` Project with a Task that carries a `Deadline` or a `Date` with a time of day (`paused_commitment`);
- a closed Project with unfinished Tasks (`project_closure`);
- a Task whose status contradicts a dependency: a `Next Action` with an unresolved blocker, or a `Waiting For` that has nothing left to wait for (`dependency_contradiction`).

A Task of a paused or closed Project is not woken separately; only the Project is. The recency threshold sits in the query itself, and the query returns the freshest first, so the limit on the number of rows cuts off the older rows, not the fresh ones; a selection truncated by the limit is visible in the log. The time rules query for dates from the recency threshold onward. A structural situation arises from an edit, and an edit is an event, so the sweep takes the Projects edited within the recency threshold: for them the sweep is a fallback path in case the event has been lost. The situation of a dependent Task also changes with an edit to its blocker, so the sweep takes all dependent Tasks, the most recently edited first, and recency is counted from the last edit to any of the participants. A Project's rules are judged over all of its Tasks: a Project with more Tasks than one query returns (100) is not judged, and the log names it. Each group of queries is a unit of work: the tick skips a group that was not read and does the rest. Once the daily limit of wakes is used up, the tick does not read Notion.

What the sweep does not take, and why:

- a `Scheduled` Task with a date that has come due: it is the content of the Daily Control, not a proactive label;
- a Project with an approaching deadline: a Project has no date, and the sweep takes the deadlines of its Tasks;
- stale Inbox items and review-level labels: reviews bring them up;
- a habit with friction or a missed review: it goes into a review packet, not into a wake;
- an Area of Focus that deviates from its acceptable state or is under `Advance` without motion: it goes into a review packet; the acceptable state lives in the GBrain anchor (`G9`).

A candidate is not woken if:

- the situation arose earlier than the recency threshold: a review will bring it up. The recency of a time rule is the point in time its date stands for, and the recency of a structural rule is the last edit to any of the participants;
- it has already been woken on the same ground. For time rules the ground is the value of the date with its phase (“near”, “passed”), and for structural rules it is the last edit to the participants. The memory (`sweep_marks`) holds the hash of the ground, not the value;
- the page is already being dealt with: a continuation, an evaluation window or a proposal is open on it;
- a run has already seen the situation: after the situation arose, a run reached a conclusion about one of its pages.

The sweep wakes the rest with a `safety_recheck` continuation that has no thread and is due immediately (`ContinuationsService.requestSafetyRecheck`), within the limits of the tick and of the local day: deadlines first, then the check date, then structural situations. The run is a `scheduled_recheck` run with the continuation's trigger envelope (`INV-020`). The tick does not proceed when the run gates of an autonomous run are closed: a wake that cannot start would only join the queue. A wake without a thread that has produced no run for a long time is retired. The frequency, limits and thresholds are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `sweep`; the rationale is in [ADR 0037](decisions/0037-safety-sweep.md).

`INV-101` The sweep writes only `safety_recheck` continuations with no thread, and memory about them: it writes nothing to Notion, to delivery or to proposals, and asserts nothing about the domain.

#### Review trigger

A review can be started by a direct request from the person or by a configured App schedule. The review type determines the scope:

```text
daily_control          -> Calendar + Scheduled + critical commitments + Available Now
                          + open proposals awaiting a decision
                          + the number of stale Inbox items
weekly_control_review  -> Inbox + Tasks + Projects + Behavior Systems + Areas of Focus + relevant Key Results
strategic_review       -> Objectives/Key Results + Project and Behavior System portfolio + resource conflicts + Area of Focus Modes
deep_review            -> Identities + Principles + Areas of Focus + methodology overhead
```

The review schedule is configurable ([Schedule and recurrence](#schedule-and-recurrence)): a scheduled review is set by the occurrence producer, and the default schedules are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `review_schedules`. The system does not invent a universal frequency and does not start a `Deep Review` as a reaction to a single failed Task.

### Discussions as the attention layer

When Claude determines that a canonical object needs durable attention, it first reads the unresolved discussions on the nearest relevant object.

For a situation local to a Task, the discussion is created on the Task. For example, a Task with status `Waiting For` needs follow-up, a `Next Action` is not worded concretely enough, or the status contradicts a dependency.

For a Project-level situation, the discussion is created on the Project. For example, several critical Tasks conflict, a `Planning` or `Active` Project has no reliable current Task path, a terminal transition has not settled its Tasks, or deadline risk arises through dependencies.

For a Behavior System, an Objective/Key Result or an Area of Focus, the discussion is created on the object concerned, when the problem is about its own semantics. The observable grounds are a habit's `Lifecycle`, an Area of Focus's `Mode` and the motion of the work linked to it. A deviation from the acceptable state is read from the GBrain anchor, not from the object; Key Result evidence and review decisions have no carrier (`G13`). Identity/Principle attention is used mainly in a user-led `deep_review`; a single operational problem is not a ground for autonomously rethinking an Identity.

Before creating a new thread, Claude determines whether an unresolved discussion about the same situation already exists. The result is one of:

```text
reply to existing discussion
create a new page-level discussion
no discussion action
```

Through the API, a page-level comment is appended to the page's discussion: Notion keeps one such discussion per page and opens it with the first comment. A separate discussion on the same page is possible only on a block. So the system opens a new discussion on a page that does not yet have a page discussion; on a page that has one, it writes into it or replies in the discussion it names.

The identifier of an attention episode is the native `discussion_id`, not an opaque application hash. Machine state is not serialized into comment text.

The capabilities of the comments and discussions API may change; the concrete read, write and resolve availability is checked again when the Notion integration is upgraded. MVP behavior does not depend on an invented API operation.

#### System-managed attention episodes

A discussion is system-managed if the system has a durable responsibility for follow-through, for example when:

- Personal Management System has created or continued the thread;
- the App has an active scheduled continuation for the `discussion_id`;
- the App has a pending approval or action linked to the `discussion_id`;
- the person has directly asked Personal Management System to take on an issue for follow-through.

The App checks the first three signs mechanically. The [`system_discussions`](#system_discussions) registry holds the first: a discussion enters it when the system has commented in it, and only in that case, because the system writes its comments only through the App. The second and the third are the open `scheduled_checks` and `pending_actions` rows with that discussion's `discussion_id`. The fourth has no mechanical sign: the person's request becomes a continuation or a system comment, and from then on the first three signs keep the thread managed.

A technical marker is not added to human-readable comment text. The registry is a separate `app_db` record, because Notion stores the sign “the system wrote here” nowhere except in a comment's author, and reading all the comments of a thread on every event would cost a Notion query on every intake.

`INV-089` The system manages a discussion if it has commented in it or if a continuation or proposal is open on it; a person's reply in a managed discussion is a `managed_discussion_reply` run, and a comment outside a managed discussion is an ordinary page change.

#### Resolution

An unresolved discussion may enter the active context.

A resolved discussion is not loaded into an ordinary evaluation merely because it exists.

Resolution starts closure processing when the discussion belongs to the system-managed lifecycle.

The person is free to use native resolve and reopen in the Notion UI: resolving a thread is the person's decision, so the Notion MCP tool `notion-set-discussion-resolved` (which is also available only on the Business or Enterprise plan) is withheld from App runs ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mcp_toolsets.notion`). Notion does not report resolving or reopening with an event, so a resolved managed thread is found by the [reconciliation](#resolved-thread-reconciliation).

Closure has its own slot in the same queue of continuations: a thread has at most one open wake (a recheck, a snooze, a deadline) and at most one open closure, and they do not displace each other. Whoever finds a managed thread resolved requests closure with `ContinuationsService.requestClosure`: a row with the reason `resolution_reconciliation` appears in the queue, due immediately. If a closure is already open, the request changes nothing, including the row that is going into a run; a new resolution after a completed closure is a new closure. A row with the reason `resolution_reconciliation` wakes `closure_processing`, not a recheck. No step that requests a continuation names that reason: that is the App's job (`INV-095`).

The `closure_processing` mode reads the thread with its resolved comments (`notion-get-comments` with `include_resolved`), the object it is attached to and the anchor in GBrain. It writes the facts, events and decisions of the person to memory, each with its source, through a memory intent (`memory_record`); a lesson and an edit to compiled truth wait for the person's confirmation in the conversation. Its App toolset is the memory intent and `introspection` (`INV-096`).

#### Resolved-thread reconciliation

Notion sends no event when a thread is resolved or reopened (measured). REST returns only unresolved comments; a listing by page id leaves out threads on blocks, and a listing by block id returns them. By id, Notion also returns a comment of a resolved thread (the comment has no status) and a deleted one, marked `original_content_deleted`. So a resolved thread is found by the App's periodic reconciliation (`sweeps/` in the [module map](#module-map)).

The scope is the threads in which the system has commented and where its work is still active: the system commented in them within the last few days, or a continuation or a proposal is open on them. A thread that waits only for the person's reply has no continuation, so without the criterion of a recent system comment nobody would find out that it had been resolved. The [`system_discussions`](#system_discussions) registry holds the thread's anchor (a block, when the system's comment landed on a block) and the system's last comment in it. The reconciliation queries each anchor for its unresolved threads, one query per anchor, and goes through the anchors in rotation, the least recently queried first.

For a thread under reconciliation:

- it is among the unresolved: the reconciliation remembers that it saw the thread open;
- it is not among them, and the system's comment is still there: the thread has been resolved, and the App requests closure (`requestClosure`) if the thread has been seen open since the last conclusion about it. The thread was also open when the system commented in it. This is how “opened again and resolved” is caught, and the reconciliation does not repeat a failed closure on every tick;
- it is not among them, and the system's comment has been deleted (Notion marks it deleted or does not find it): the thread is deleted, and there is no closure;
- the registry does not know the anchor and the comment (the row does not contain them, or the thread was named by a continuation or a proposal and the system has not commented in it): there is no conclusion, because absence from the page does not tell a resolved thread from a thread on a block;
- the anchor has not been read: the tick says nothing about this thread, but the query is counted, so the next tick goes on to other anchors instead of running into the same one again. A refusal that the person must see (a binding that is unsuitable or unknown) goes to the log as an error.

The reconciliation's memory is `discussion_reconciliations`; rows outside the scope are pruned. The closure run itself checks that a thread is resolved and not deleted, by reading the thread together with the resolved comments. The frequency, scope and anchor limit are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `sweep`; the rationale is in [ADR 0038](decisions/0038-resolution-reconciliation.md).

`INV-102` Closure is requested only for a thread in which the system has commented and whose thread anchor and last system comment are known: it is not among the unresolved threads listed for that anchor, and the system's comment has not been deleted. A repeat request is made only after the thread has been seen open again.

### Knowledge contract GBrain

GBrain is the only semantic-memory system.

Compiled truth reflects the current best durable understanding of an entity, and the timeline keeps provenance, evidence and historical sequence.

Personal Management System does not create a second vector index, RAG store or knowledge-page database.

Claude reads GBrain through its native interface: search, graph traversal, pages, facts, timeline. The system makes memory writes with an App intent ([Writes to GBrain](#writes-to-gbrain)), and the conversation makes native writes at the person's request.

#### Canonical anchors

A Notion entity with a long-lived knowledge lifecycle can have a canonical GBrain anchor. Typical examples:

```text
significant Project
Behavior System with durable learning context
Objective
Area of Focus
Identity
Person
Organization
```

An ordinary Task and an individual Key Result do not need their own memory page merely because they exist; their knowledge context is usually obtained through a Project, Behavior System, Objective, Area of Focus or another long-lived anchor. Which anchor to use is determined by the Notion object the statement is about: the one the person names, or the one on whose page or in whose thread it is said, even when the words themselves concern someone outside Notion (a client, a supplier). For a Task, the anchor comes from an object linked to it. When there are several, it comes from the one the statement is about. When what is said does not show which, it comes from the Task's Project, or from its Behavior System when it has no Project, then from its Objective, then from its Area of Focus. For a Key Result, it comes from its Objective. If that object has no anchor, the next one is not used. What is said where there is no Notion object (an Inbox item with a fact, words that name no object, a Task with none of these links) is stored without being attached to a page ([Writes to GBrain](#writes-to-gbrain)).

A canonical anchor holds the exact Notion page ID in structured metadata when such an operational bridge exists. It is an identity bridge, not a copy of the operational object.

An anchor has three functions: it identifies the knowledge entity exactly, holds the current summary and is an entry point into the graph.

The shape of an anchor, together with an example, is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `gbrain_anchor_shape`; the canonical values of `type` for methodology anchors are in key `gbrain_anchor_types`. Other labels do not substitute for these canonical entity types.

The convention has three parts:

- **slug**: `<type prefix>/<notion_id without hyphens, in lowercase>`. A slug derived from the id stays the same when the person renames the object in Notion, and belongs to one object;
- **frontmatter**: exactly `type`, `title`, `notion_id` in the hyphenated canonical form, and `aliases`. GBrain reserves the key `id` for deduplication, and a write carrying another page's `id` value overwrites that page;
- **identity line** in the body: `Notion: <notion_id>` with the same id. GBrain's text index covers compiled truth and the timeline, so a search by id finds the anchor by this line. The App creates the anchor with a memory intent, together with the first memory write about the object, when exact identity yields `absent` and the conventional address is free: one per object, with a read-back (`INV-098`). Every anchor carries at least one entry. An anchor derives from the Notion object: the person decides what to remember, and the object determines where the write goes. Content beyond the skeleton (compiled truth, aliases, links) is written by the conversation at the person's request ([Writes to GBrain](#writes-to-gbrain)). The pure functions of `knowledge/` build and parse a page by this convention (`INV-097`).

Other GBrain artifacts — decisions, lessons, people, organizations, meetings, sources or concepts — are linked to the anchor by explicit graph links. One artifact may concern several canonical objects, and one object may have many related artifacts. GBrain accepts a graph link with a verb declared in the vocabulary of the active schema pack (for example `relates_to`, `derived_from`, `supersedes`, `mentions`, `sourced_from`) or with no type. A link is read as the sentence “from — type — to”, and the direction is chosen so that the sentence is true: a lesson is `derived_from` the anchor it came out of. So the neighbors of an anchor are read in both directions. The page types `behavior_system`, `objective`, `area_of_focus` and `identity` lie outside the pack's schema, and GBrain accepts them for writing, for listing by type and for searching by type.

#### Exact identity

When a Notion-triggered situation needs a GBrain anchor, identity is established by an exact identifier check, not by semantic similarity.

The procedure:

1. search for the full `notion_id` in the hyphenated form among pages of the types in `gbrain_anchor_types`;
2. take as candidates the pages that the search marked as an exact match (`evidence: keyword_exact`), and the page at the object's conventional address, if there is one;
3. read each candidate and check `frontmatter.notion_id` for exact equality (ids are compared in the canonical form: an id with or without hyphens, in upper or lower case, is the same id);
4. accept the result only with a single exact match.

Each step enforces its own property. Search returns the page closest in meaning for any query, and the exact-match mark separates a page that contains the id from a similar one. A page that merely mentions the id (a lesson, a note) is also an exact match, so the type and the reading of `frontmatter` separate an anchor from a mention. Two pages with the same `notion_id` are both found, so a duplicate is detectable. The address finds a page that search has not yet caught up with: search lags behind a write, and a page to which an event or a fact has just been added is found by id with a delay (`GAP-40`). So `absent` is established by an empty search and an empty conventional address together.

The results ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `gbrain_exact_identity`):

```text
0 exact anchors -> absent: no canonical anchor
1 exact anchor  -> exact: authoritative match
>1 exact anchor -> integrity_error: all pages are named, the operator chooses
```

Identity is established by the equality of `notion_id`; semantic similarity yields only similarity. These three answers come from a pure function of `knowledge/` applied to GBrain's response (`INV-098`); in a run, the model takes the same steps with native GBrain calls, and the gate measures whether it did.

`absent` means that nothing has been stored about the object yet. The App puts the first entry about it into an anchor that it creates itself following the convention ([Canonical anchors](#canonical-anchors)); the person is told what has been remembered.

With `integrity_error` the run goes on: it relies on Notion and states the discrepancy in the `uncertainties` of the label it raises. A memory intent about an object with `integrity_error` answers with a refusal, and the person is told that what was said could not be remembered, while the person's words stay where they were said. The command `anchors:check` shows the operator all anchor discrepancies ([RUNBOOK §23](../infra/RUNBOOK.md#23-anchor-check)).

#### Structural context before semantic context

From a canonical anchor, Claude first gets high-confidence structural context:

- compiled truth;
- recent timeline;
- explicit outgoing links and backlinks;
- graph neighborhood depth 1.

Hybrid or semantic search is used only when the structural neighborhood is insufficient.

Within `max_gbrain_tool_calls` ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `retrieval_budgets`), a structural-first read is four calls in order: a search by id among pages of the anchor types, a read of the anchor (the page together with its facts and timeline carries compiled truth, facts and recent events), a graph neighborhood of depth 1 in both directions, and a read of one neighboring page that the edge context names. A memory write is an App intent, outside the reads budget. Reviews that need the context of several objects take entity cards (`entity`, `context_pack`): they answer without an LLM call and return compiled truth in condensed form.

A semantic result is candidate context. It does not become an authoritative relation merely through textual similarity.

When a semantic artifact is systematically found to be important for a particular anchor, Claude may propose an explicit graph link. The GBrain schema is extended only when a stable object or relation type emerges in the real corpus.

#### Progressive memory retrieval

In conversation or evaluation, bounded pointers or synopses are used first. Full page content is read only if it can materially change the answer or the decision.

`volunteer_context`, when used by the installed GBrain baseline, is treated as a mechanism for bounded candidate pointers, not as an authoritative decision. Alias and title resolution and a confidence threshold help to propose context but do not replace exact identity or explicit graph relations.

#### Writes to GBrain

Who writes what is set by [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `memory_writes`, which gives, for each kind of write, the capability that performs it and the authority of a run and of a conversation. The system writes an event, a decision, a fact and an Area of Focus's acceptable state with the App intent `record_memory` (capability `memory_record`) on both surfaces. The model supplies the Notion object, the kind, the text in one line, the day, and the page and thread the entry comes from; the App finds the anchor by exact identity, creates it when there is none, gives the entry the shape of its kind and writes it. In a run, the write is staged until there is a valid result and is applied first among the effects ([ADR 0014](decisions/0014-app-effects-after-valid-result.md)): memory contains only the writes of valid runs, closing an Inbox item as a reference rests on the recorded fact, and the comment “remembered” is posted after a successful write. A write to GBrain waits until GBrain computes the embedding, which sometimes takes minutes: the run waits for it up to its deadline ([Runner execution environment](#runner-execution-environment)). A write that does not finish in time fails the run; a retry of the run finds the anchor already created and skips an identical write. Pages (compiled truth, a lesson) and graph links are written by the conversation with a native write, at the person's request; the matrix rows give a run read-only access to GBrain (`INV-100`).

The shape of each entry follows from how GBrain stores it, and the App sets it:

- An **event** is a timeline entry on the anchor, with a day `YYYY-MM-DD`, content and source. GBrain would add an identical event on the same day as a second item, so the App checks the anchor's timeline and skips an identical one.
- A **decision** is a timeline event whose content begins with the marker `Decision:`. A decision with no Notion object is written as a fact without `entity`, with the same marker.
- A **fact** is a `remember` call with `provenance` and `entity` set to the anchor's slug. GBrain writes such a fact into the facts section of the page file, so it survives a restore from Markdown. A fact with no Notion object stays only in `gbrain_db` (`GAP-37`). The deduplication of `remember` relies on embeddings, so the App itself checks the anchor's facts and skips an identical one.
- The **acceptable state of an Area of Focus** is a fact of `kind: preference` on the `area_of_focus` anchor whose text begins with the marker `Standard:`. The person's clarifications are added as new facts, and GBrain replaces a fact of the same kind that is close in meaning with the newer one; each separate statement stays on the page that the review reads. The `Standard` of an Area of Focus is all such facts of its anchor. In a review, the conversation shows the stored acceptable state, asks what is “normal” for the Area of Focus, and says that it will remember the answer: the person's answer to such a question is their consent to the write.
- **Contradiction with what is stored** is the model's judgment. Before a write, the model reads what is stored about the object. It makes a write that contradicts what is stored (a different choice, a different value of the same thing) when the person says the new one replaces what is stored. The person is told what is stored and is asked which is in force.
- **Generalization** (a lesson, an observation about how the person works) that the system formulates is a page written by the conversation after the threshold from `memory_thresholds` is reached and the person confirms; the episodes for the threshold are the timeline events of anchors. The system brings a candidate up in the Strategic Review. A generalization that the person stated themselves is the person's own words, and is written as a fact.
- **Page replacement** replaces a page entirely: `put_page` without the facts and timeline sections erases them from the file, although the rows in the database remain. So the conversation changes a page in this order: it reads the full content, changes only the named area of compiled truth, writes the whole content back, then reads the page again and checks `notion_id`, the number of timeline items and the facts section. A discrepancy between the timeline rows in the database and the items in the page text is a sign of lost content; `anchors:check` finds it.

GBrain writes everything recorded into the `gbrain-repo` files without a commit; `gbrain sync` sees what is committed and, when given the current tree, that tree too ([RUNBOOK §15](../infra/RUNBOOK.md#15-full-gbrain-rebuild-from-markdown)). The difference between knowledge that lives in page files and facts held only in the database is `GAP-37`; commits of the knowledge repository and restore from what is uncommitted are `GAP-38`.

### Observability and cost

The run trace — the `run_traces` ledger row, with the run's snapshot and its lists ([Implementation inventory](#implementation-inventory)) — records the fields of the observability baseline: trigger, execution surface, Plugin version, model, MCP servers, tool calls and results, policy and approval events, runtime effects, domain writes, latency, tokens, technical errors, user feedback. The canonical list of fields is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_trace_fields`; the rules for using them are in key `run_trace_rules`.

For an App-triggered run, the source of the identity, latency and token fields is the SDK's result message ([Run result](#run-result)). The model and tokens are taken from `modelUsage`, not from `total_cost_usd`. The statuses of the MCP connections are recorded from the run's init message ([Runner MCP connections](#runner-mcp-connections)).

Traces are technical records of `app_db`, not domain memory (the rules are in key `run_trace_rules`): what must outlive a run as knowledge is written to GBrain ([Knowledge contract GBrain](#knowledge-contract-gbrain)).

Each run leaves tool calls, input and output tokens and latency — exactly enough to tell whether the detector, sweep or retrieval path spends more in resources than it creates in value. What is measured on these fields is in [Behavior metrics](3-policy.md#behavior-metrics). So tool calls and tokens are stored as rows, not as a document: a metric counts, groups and joins them with a query, not by parsing the JSON of every run.

The run budget consists of the daily limit of App-triggered runs, the circuit breaker and the concurrency limit. The numbers and their rationale are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_budget`.

**The limit covers only what the system itself started.** A run is one invocation of the Agent SDK: a separate process, one session, several turns of the model. Reads from Notion are not budgeted — their volume is already bounded by the relevance gate and the debounce. The chat is not budgeted at all: it does not pass through the App, and the App cannot count it.

Among App-triggered runs, a run is **exempt** if its origin is one of these: a time the person set (`user_snooze`, `deadline_followup`, a review on a configured schedule); the person addressing the system (a reply in a thread that Personal Management System manages, a button or a reply in a channel to a system message); an item the person put in the Inbox; a launch the operator performed manually (`operator`, a gate command, [ADR 0013](decisions/0013-runner-explicit-switch.md)). An operator's run carries none of the person's words: it neither decides a proposal nor names a snooze time. All other runs are **budgeted**: `await_external_event`, `safety_recheck`, `resolution_reconciliation` and any change-evaluation window. The criterion is mechanical: every run has exactly one origin row, and one enumerated field determines the class.

Exempt runs do not count against the daily limit and are not blocked by the breaker: consecutive failures up to the limit `run_budget.breaker_consecutive_failures` mean a breakdown, and the review must take place to show it. The concurrency limit applies to **all** runs: it exists so that two runs do not start writing the same object, not to protect the person from the system's chattiness. It is enforced not by a count but by a **ticket**: a ledger row carries a slot number, and a partial unique index on it among the unfinished rows makes admission atomic. A count would not do that: two admissions in flight at once would see the same free slot and both would start.

A ticket has an expiry. A run that has not reported by then falls back to `abandoned`, and the slot is released automatically. Without an expiry, one killed process would hold the concurrency limit forever: the row would stay `running`, and every later run would get a denial, with no visible error. `abandoned` is separate from `failed` on purpose: a process killed from outside is not a failure of the model, and the circuit breaker does not see it. A live run does not reach the expiry: the dispatcher aborts it with a signal before then ([Runner execution environment](#runner-execution-environment)), and an aborted run ends as `failed`. The breaker sees it, because a run that overran its ticket points to a broken run path, not to a process killed from outside.

A denial destroys nothing and does not touch the origin row: the row waits as it was (`INV-084`). What waits is the scheduler, not the row: the run gates are its state, and it checks them on every tick before claiming a row ([Run priority](#run-priority)). The daily limit reopens with the new day; the breaker, with the first successful run (exempt runs, which the breaker does not stop, supply one); the slot, as soon as the run that occupies it ends; the runner, with a restart; the grant, as soon as the person authorizes it again. An exhausted plan quota ([ADR 0012](decisions/0012-run-profile-and-plan-quota.md)) keeps the time of its reset in the ledger. A run that finds the quota exhausted ends as `deferred`, the origin row's attempt is given back, and neither the breaker nor the daily limit sees the run. Until the quota has reset, not even exempt runs start. A run that did not reach Notion does not close the gates: its row waits ([Scheduler and outbox](#scheduler-and-outbox)); the breaker does not see that run, and the daily limit counts it only when it reached the model, because a run that reached the model has already used the plan, and a Notion failure must not silently erase it from the count. The App writes a gate transition to the log once: when the gates close and when they open.

A missing dependency is a separate answer, not a failure. The run port declares both its presence and its readiness: there may be no runner at all, and a runner that is present but has no live Notion MCP grant will not perform a run (`INV-309`). In both cases the origin spends neither budget nor an attempt, is not concluded as handled and leaves no record in the ledger. Reporting success in this situation would be lying about something that did not happen. The App does not notify about the daily limit: that is a normal operating state; it notifies about the breaker once per opening. The run gates (`RunGates`) call the `BreakerNotice` port (`runs/breaker-notice.ts`), and its adapter in delivery enqueues a breaker notice in the outbox with the key `breaker:<last failed run id>`: a restart between the opening and the notice does not enqueue a second one, and a new failure after the breaker closes is a different opening. The notice respects quiet hours and has no buttons: a broken run path is fixed by the person, not by a decision in the notice. A notification failure does not change the state of the gates; the next tick tries again. The same classifier decides what breaks through [quiet hours](#telegram--channel-adapter): one rule, two mechanisms, because neither the budget nor quiet hours may stand between the person and their own instruction.

`INV-309` A dead Notion MCP grant is a `runner_not_ready` denial that comes before budget and admission: there is no ledger row, the origin row's attempt is not spent, and the breaker does not see a run denied for this reason.

The remaining limits of a single run are enforced by the [runner execution environment](#runner-execution-environment).

### Startup and service dependencies

At startup the App has a hard dependency on PostgreSQL: Compose starts the App when Postgres is healthy, and the image's start command first applies the `app_db` migrations (`prisma migrate deploy`) and only then launches the App. A failed migration stops the container, so the App does not run against a schema that lags behind the image. GBrain availability is handled as a runtime service dependency.

### Configuration contract App

Notion REST credentials, Notion MCP OAuth and refresh state, GBrain client credentials, App MCP auth configuration, the Claude subscription token `CLAUDE_CODE_OAUTH_TOKEN` (its name is set by the SDK) and the path to the plugin directory belong to the App integration and configuration contract.

Settings have owners ([ADR 0019](decisions/0019-config-in-owner-modules.md)). A config namespace lives in the module that reads it, and the module registers it itself. `AppModule` loads the namespaces of the whole application: the timezone, language and port, the throttler limits and the switch for background work. A value reaches its consumer as the namespace's type, not as a string key: a mistake in the name is caught by the compiler, not by the first call. An environment variable is read only by the namespace factory of its module, and the default value lives there too. The environment validation (`config/env.validation.ts`) is responsible for the shape. It is one schema that collects all the problems at startup into one list, each with the variable's name and what is wrong with it. The schema knows every variable that a namespace factory reads. A switch has exactly two values, `true` and `false`, and the quiet-hours bounds take the form `HH:MM`. An empty value is the same as an absent one: Compose passes an unset variable as an empty string, and the schema reads it the same way in every variable. A required variable that is missing stops startup. A variable needed only when the runner is enabled is required by whoever uses it, when it is needed.

`INV-093` Settings arrive typed, from the config namespace of the owning module: nobody imports `ConfigService` in App code, and only the config namespace factories and the entry point `app.module.ts`, which needs `NODE_ENV` earlier than the settings, read the environment. The gate is a test, not App code: it starts its own App instance with an environment that it sets in its own entry point (`app/test/gate/gate-boot.ts`).

Compose reads these variables, so they are declared in `infra/.env.example`: `APP_MCP_URL` and `APP_OAUTH_OWNER_PASSPHRASE` are the variables of the chat's authorization server; `GBRAIN_CLIENT_ID` and `GBRAIN_CLIENT_SECRET` are the credential issued by the provisioning step; `CLAUDE_CODE_OAUTH_TOKEN` is the variable whose name is set by the SDK; `NOTION_API_TOKEN`, together with `NOTION_API_VERSION` and `NOTION_WEBHOOK_SECRET`, is the deterministic Notion REST credential. The integration behind this token reads, inserts and updates content, reads and inserts comments, and reads information about users without email: the [system writes](#system-writes-to-notion) require this. `NOTION_API_VERSION` is checked against the value the SDK was built for: its types describe that version, so a mismatch stops startup instead of leaving the types wrong. The Notion REST credential and the Notion MCP OAuth state remain two different credentials (`INV-060`), which is why the prefix `NOTION_MCP_*` is reserved for the second one. `APP_TIMEZONE` declares the installation's timezone: the day of the daily run limit and the quiet hours begin in that zone, not in the container's UTC; the code supplies the default value, and validation checks only that the declared name is a real IANA zone. `APP_LANGUAGE` declares the language in which the App itself writes to the person ([Language of texts for the person](#language-of-texts-for-the-person)): the code supplies the default `en`, and validation checks that the language has a catalog. `APP_OWNER_GENDER` declares the grammatical gender the system uses when it addresses the owner ([ADR 0046](decisions/0046-system-voice.md)). `APP_ASSISTANT_NAME` and `APP_ASSISTANT_GENDER` are the assistant's name and the gender the assistant uses for itself: their config namespace belongs to the App MCP server (`mcp/server/assistant.config.ts`), and within the App only `runtime_read` reads them ([ADR 0049](decisions/0049-assistant-name.md)). All three are optional: without them the Ukrainian catalog builds its sentences without gender forms, and the assistant has no name. The queue's concurrency limit is a number fixed in the contract, `run_budget.concurrency`, not an environment variable. The runner ([ADR 0013](decisions/0013-runner-explicit-switch.md)) adds: `RUNNER_ENABLED`, the switch for the adapter, `false` by default; `WORKERS_ENABLED`, the switch for the background workers, `true` by default (the gate turns it off in its own instance in a separate environment and leaves the main App untouched, [ADR 0041](decisions/0041-gate-environment.md)); `RUNNER_PLUGIN_DIR`, the runner's plugin directory (`/app/plugin` in the image); `NOTION_MCP_URL` and `NOTION_MCP_REDIRECT_URI`, the hosted Notion MCP and the callback address of the one-time authorization; `RUNNER_GBRAIN_MCP_URL`, GBrain over the Compose network; `GBRAIN_OAUTH_TOKEN_URL` and `GBRAIN_OAUTH_SCOPE`, its client_credentials. With the runner enabled, the App does not start when any variable of the `RUNNER_NEEDS` list (`config/env.validation.ts`) is missing. The list includes the GBrain client (`GBRAIN_CLIENT_ID`, `GBRAIN_CLIENT_SECRET`) and `CLAUDE_CODE_OAUTH_TOKEN`: a runner without the client would not crash, but every run would silently go ahead without GBrain. `RUNNER_ENABLED`, `WORKERS_ENABLED` and `NOTION_MCP_REDIRECT_URI` are not in the list. With the runner disabled, the variables of the list are optional, but when set they are validated, and a scope wider than `read write` always stops startup. `NOTION_MCP_URL` is also read by the grant keepalive regardless of the switch, so Compose gives it a default value; `NOTION_MCP_REDIRECT_URI` is needed only by the authorization command. Authentication of the App MCP for a run needs no configuration: the App itself issues the bearer ([Authentication boundary](#authentication-boundary)). The authorization server for the chat needs two variables, and the config namespace `mcp/oauth/` reads both: `APP_MCP_URL` is the public address of the endpoint; it is also the `resource`, the audience of the issued tokens and the issuer. `APP_OAUTH_OWNER_PASSPHRASE` is the owner passphrase on the consent page, at least 32 characters long. If either is missing, the authorization server's routes answer `404`, and `/mcp` stays available only to runs. A passphrase without an address stops startup, and a non-`https` address is allowed only for loopback.

---

## App MCP

The capability classes of the App MCP and the normative rule by which the voice chooses the interface are defined in [Three MCP interfaces](#three-mcp-interfaces). Below is the implementation contract of the same seven classes.

| Class | Tools | Purpose |
|---|---|---|
| attention | `add_comment` | a comment in the system's voice: in a page's discussion or as a reply in a named one |
| capture | `convert_inbox_item`, `close_inbox_item`, `park_inbox_item` | conversion of an Inbox item: a Task, an origin comment on the item, the trash; closing without a Task: an origin comment, the trash; parking an item that the conversation left unresolved (chat only) |
| continuation | `schedule_continuation`, `reschedule_continuation`, `get_continuation_state` | durable follow-through for `discussion_id` |
| delivery | `queue_notification`, `get_delivery_state` | enqueuing in the outbox (the App derives the delivery key, [ADR 0025](decisions/0025-app-derives-delivery-key.md)), inspection |
| approval | `create_pending_action`, `get_pending_action`, `list_pending_actions`, `decide_pending_action` | the immutable contract of a change: effects with values, and preconditions; the list of proposals that are waiting; the person's decision (chat only) |
| memory | `record_memory` | a memory entry about a Notion object: an anchor by exact identity, created by convention together with the first entry, and an entry shaped by its kind ([Writes to GBrain](#writes-to-gbrain)) |
| introspection | `get_runtime_state`, `get_schema_mapping` | the narrow technical state of the current lifecycle: the installation's time and timezone, who is acting and whether this step carries the person's words (`person_speaks`), the grammatical gender of address, the assistant's name and gender, when a message would be delivered; the binding with live names |

The table is the human-readable form of [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mcp_toolsets.app`. A run sees only the tools of the App bundles of its row in the [matrix](#mode--toolset): the `tools/list` of its session equals the App part of the row. A chat session sees the App tools according to `chat_toolset` ([mode → toolset](#mode--toolset)): `park_inbox_item` and `decide_pending_action`, which are withheld from runs, belong to it alone.

There are no `cancel_*` tools, because the lifecycles themselves have no cancellation. `schedule_continuation` and `reschedule_continuation` are the same service call: a thread has one open wake, and a new request moves it; thread closure is not involved in this call. A run without the person wakes a thread no earlier than `autonomous_min_lead_minutes` after its own start ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `scheduled_check`): otherwise a continuation that made its own row due immediately would wake itself endlessly. That is why the run on whose behalf a capability acts also carries its start time. The tool that decides a proposal, `decide_pending_action`, is not shown to a run, and the approval service refuses a run anyway: the person decides, with a channel button or in the chat, under the resolve boundary from [App MCP — runtime/control interface](#app-mcp--runtimecontrol-interface). A proposal row carries the run that created it: the evidence for the proposal is in the trace of that run. `list_pending_actions` lists the proposals that are waiting, oldest first, with the id, the thread, the time and the page with its property for the first five effects. It cuts off anything beyond ten proposals and says `truncated`. `get_pending_action` returns the content the person approves.

**Run writes are staged** ([ADR 0014](decisions/0014-app-effects-after-valid-result.md), [ADR 0015](decisions/0015-capabilities-own-run-writes.md)). In an App-triggered run, a write tool checks the request immediately, against the schema and the capability's rules, but the write is applied only when the run has ended with a valid result. The write policy (`effects/`) decides when a write is applied, not the tool. There are two policies, both over the same table of kind owners. `StagedWrites` is for a run and applies the writes at its end, once the dispatcher has found the result valid. `ImmediateWrites` is for the chat, which has no run result: the write is checked and applied on the call, and the tool's response says `applied`, not `staged`. App writes are a closed list of kinds (`memory_entry`, `inbox_item`, `inbox_conversion`, `inbox_closure`, `comment`, `continuation`, `proposal`, `delivery`), and each kind has an owning capability: it checks the write, applies it and shows it. The input of every kind is laid out the same way. At the root of the capability's module sit `<kind>.schema.ts`, with the schema, the request type (`…Request`, the request as submitted) and the type of what has been checked, and `<kind>.wire.ts`, with the wire shape. `check` checks the write and returns the checked result, and it accepts an already checked result a second time. Applying returns the real id of what was written and reports each effect as soon as it happens, so a write of several steps that fails midway leaves the completed steps among the applied effects. A write that Notion accepted but did not confirm in its answer has still taken place: its effect stays among the applied effects, and the write stops at that effect. Writes are applied in the order memory → parking an Inbox item → conversions → closures → comments → continuations → proposals → deliveries. So closing an Inbox item as a reference rests on a fact that is already written, a message never announces an effect that was not applied, and writes that point to a Task or thread the run created get their real ids. Before the first write the policy checks everything that was staged once more. A state that has changed during the run — a snooze the person set in the meantime, or a proposal the person has already decided — stops the applying before the first write. Applying itself is not atomic. A refusal that arises between that check and a write stops the remaining writes, and the run fails. The prefix that was already applied stays and goes into the trace as the applied effects of the failed run. The stack of an error that the capability did not classify as a refusal stays in the log. A write tool's response says that the write was accepted and will be applied at the end. A `get_*` call in the same run shows what was written in the same form as what was applied, with the status `staged`: the same capability shows what was written and what was applied. A run that has failed, been deferred or been aborted does not apply App writes. A retry relies on the idempotency of each capability: a continuation moves the same thread, a proposal is merged with the open one by fingerprint, and a delivery is merged by its idempotency key. So the idempotency key must be derived from the cause — the id of the event, thread or update from the envelope — and not from the time, a counter or a random value. Deriving the key this way is the Skill's discipline. A comment has no idempotency key: Notion does not accept one, so a run that failed after an applied comment may, on retry, write a second comment in the thread. The applied comment goes into the trace, and the retry sees it in the thread it reads again (`GAP-31`). A process failure between applying and recording the conclusion leaves the effects applied — the same at-least-once class as delivery. The chat has no run result and no trace: a refusal or failure is returned to the person and the model on the same call, and the applied effects go to the structured log.

**The App derives the delivery key** ([ADR 0025](decisions/0025-app-derives-delivery-key.md)): `queue_notification` does not accept a key. A run identifies a delivery by its cause — the `event:<event_id>` of the envelope — so a retry of the run does not queue a second message, and a second delivery in the same run is rejected on the call. The chat, where there is no cause, identifies a delivery by the content of the packet. The `queue_notification` response returns the key, and the key is optional in `get_delivery_state`: a run without a key asks about the delivery of its own cause.

`get_*` responses carry the lifecycle status and domain times, but not queue bookkeeping — `INV-030`.

**Wire shape.** Tool fields are named the same way as in the envelope, in `snake_case`, and times are ISO 8601 strings with a timezone. The tool converts the wire shape, the same way for writing and for reading: the model's request becomes the capability's domain request through a function from that capability's `*.wire.ts`, while the capability itself hands back its own view of the response. A capability service does not see the wire shape on input, because it is also called from places other than the wire: a gate command, channel intake, scheduled reviews. A write tool's response states what has been written and that it will be applied once the run ends with a valid result. A proposal written in a run gets a temporary id, and a delivery of the same run can refer to it among the packet's proposals: proposals are applied earlier than deliveries, so the packet gets the real id — of a new proposal or of an open one with the same fingerprint. A packet proposal with an id that the run did not write and that is not waiting for the person's decision is refused at the call itself: otherwise the person would press a button that cannot decide anything. Likewise, a comment on a page gets a temporary `discussion_id` for the page's discussion it will go into. A continuation, a proposal, a delivery and a reply of the same run can refer to it, and applying substitutes the real one.

`INV-088` An App run does not write to Notion before a valid result: it makes system writes to Notion only through the App, and they are applied together with the other App effects.

**Refusal and failure.** A capability's refusal is returned to the model as text: the request must change, and the model can correct it. The refusal is recorded in the trace alongside the perimeter's refusals. Any other error is, for the model, a temporary failure, and the run's session is poisoned after it: the run fails even if it made no writes, because the model went on composing the rest of its plan without knowing what had happened to this call. The third case is a call that does not pass the tool's input schema: the MCP server itself rejects it before it reaches the service. The model receives a validation error and can correct the call, the trace shows the failed call among the tool calls, and the session is not poisoned.

`INV-090` App MCP tools have closed input schemas: a field the schema does not recognize gets a refusal, not silence. A silently dropped field would leave the model sure that something was written when it was not, or that a response answers the refined question.

`INV-092` Only App MCP tools and a capability's wire module (`*.wire.ts`) see the wire shape of App MCP input: outside them no parameter has a wire type. A capability service accepts the domain shape from a tool and from any other caller alike.

`get_schema_mapping` returns the App's configuration (data source IDs, property IDs, option IDs and the representation kind of each canonical semantic — [Semantic adapter](#semantic-adapter)) and, next to each property and option ID, the name that the workspace currently shows (`INV-038`): the Notion MCP refers to properties and options by name, and the binding refers to them by ID. The names are read from the live schema on every call (`INV-003`). They carry no values; they only point to the carrier. The fields of a data source that Notion did not return are left without names, and so is a field whose name is longer than the response limit. The model does not match a field that is left without a name. The property IDs in that response are canonical and decoded: that is the form the proposal input accepts, and the spelling from the binding file is not exposed. The representation kind is static, but **the capability is not static**. For prose semantics the capability is determined when a specific record is read, because an empty body yields `empty` (`INV-009`). `absent` stays with the binding's declaration: there is no carrier anywhere. A detector that takes the capability from this response would assert a semantic that the page does not have — exactly what `INV-002` forbids. This makes the Skill source workspace-agnostic: the canonical semantics live in the Skill, the physical binding in the config.

`INV-028` The App MCP contains none of the names `create_task`, `update_project`, `notion_raw_request`, `write_gbrain_fact`, `append_gbrain_timeline`, `gbrain_raw_request`, `sql_query` or their equivalents.

`INV-029` The App MCP does not launch Claude recursively.

The responses of App MCP tools must stay within the size of a tool result that a run can read: in an App-triggered run an oversized result is replaced by an error and is not read back — `INV-303`, [Tool surface boundaries](#tool-surface-boundaries). So no tool returns an unbounded collection: each has a declared response bound. Two responses can be cut off by the limit: the state of a page's continuations (nearest first) and the list of proposals that are waiting (oldest first); both say `truncated` when more are open.

### Authentication boundary

The user-facing Plugin connection and the App-triggered Claude connection use credentials and scopes defined by the App auth implementation.

**Principal on `/mcp`.** A bearer resolves either to a run session (in the memory of the App process) or to an OAuth token (`app_db`). A chat token opens the session of a person who speaks for themselves, the actor `chat`. Neither of the two bearers can stand in for the other. A request without a valid bearer gets 401 with no explanation except a pointer to where an OAuth client will find the resource metadata: `WWW-Authenticate: Bearer resource_metadata="…"`. The same goes for any other method: whoever is not authenticated does not even learn that `GET` is not served here.

**Run.** An App-triggered run gets its own bearer: the App issues it at admission and forgets it as soon as the run ends, and the bearer's expiry is the ticket's expiry. The bearer is tied to the run's identity and to the App bundles of its row of the matrix; it lives only in the memory of the App process, so no other process knows it. The bearer reaches the command line of the subprocess (`mcpServers` is passed to the CLI as an argument), so it is short-lived and is not written to logs or the trace.

**Chat: the App is itself the authorization server of the installation owner**; for why it is not an external identity provider, see [ADR 0021](decisions/0021-chat-path-oauth-and-chat-toolset.md).

- **Metadata.** Resource metadata (RFC 9728) is at `/.well-known/oauth-protected-resource` and at its variant with the path `/mcp`; authorization server metadata (RFC 8414) is at `/.well-known/oauth-authorization-server`. The issuer is the origin of `APP_MCP_URL`, and the `resource` is `APP_MCP_URL` itself.
- **Client registration** is dynamic client registration (RFC 7591) at `/oauth/register`. Clients are public and registration is open, but redirect addresses are accepted only from the allowlist: the callbacks of claude.ai and claude.com (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) and loopback (`localhost` or `127.0.0.1`, the path `/callback`, any port — Claude Code takes a free port every session, and RFC 8252 requires the port to be ignored). A registered client alone permits nothing. The number of clients has a ceiling, and pruning deletes the clients that have no live token.
- **Authorization** is Authorization Code + PKCE `S256`; PKCE is mandatory. The `resource` parameter (RFC 8707) becomes the token's audience: the endpoint does not accept a token issued for another resource. The code is single-use and lives for a minute. Tokens are random, and `app_db` holds only their SHA-256 digests (`oauth_clients`, `oauth_codes`, `oauth_tokens` — [Persistence](#persistence)). The access token lives for an hour, the refresh token for ninety days, and the refresh token is rotated on every exchange: an old refresh token presented a second time means theft and revokes the whole token family. `/oauth/revoke` revokes the family in the same way.
- **The owner proves their identity with a passphrase from the environment** (`APP_OAUTH_OWNER_PASSPHRASE`, at least 32 characters) on the consent page `/oauth/authorize`, which names the client, the redirect host and the resource. The comparison takes constant time. `OwnerLock` closes after five failures in a row, for half a minute, and then the duration doubles, up to a quarter of an hour; while the lock is closed, the correct passphrase is not accepted either, because otherwise the response, or the time it takes, would tell a correct passphrase from a wrong one. A closed lock answers `429` with `Retry-After`, and the consent page tells the owner how long to wait. There is no second factor (`GAP-33`; for why a confirmation in the channel is not used, see [ADR 0021](decisions/0021-chat-path-oauth-and-chat-toolset.md)). Instead, if the channel is configured, a message in the channel reports every consent to the owner. The message carries the client, the redirect host and a request to revoke the tokens if it was not the owner who connected. This is detection, not a factor: a failed message does not cancel the consent.
- **The server is off until `APP_MCP_URL` and the owner passphrase are set** ([Configuration contract App](#configuration-contract-app)): its routes answer `404`, and `/mcp` stays available only to runs.
- **Changing the public address invalidates tokens.** The audience of an issued token is the old address, so the chat connects again.

`INV-310` The token that Claude Chat uses to talk to the App MCP is issued by the App for this endpoint: the token's audience is `APP_MCP_URL`, the client's `redirect_uri` comes only from the allowlist (the claude.ai and claude.com callbacks and loopback, ignoring the port), PKCE S256 is mandatory, the authorization code is single-use and short-lived, access and refresh tokens live in `app_db` only as hashes, and the refresh token is rotated: an old one, presented a second time, revokes the whole family.

The authorization layer can restrict:

```text
run and session identity
execution mode
available runtime capabilities
expiry
```

This restriction is independent of the Notion and GBrain domain permissions.

### Hosting

The App MCP is served by the same `app` container on port `3000`; it has no separate Compose service.

`https://${APP_DOMAIN}/mcp` is served by the same reverse proxy as the rest of the App's public routes; the App MCP has no separate Caddy site or public port. An App-triggered run reaches it through the loopback of the same container, not through the public address.

---

## Claude runner

### Path App-triggered Claude

```text
Notion event / scheduler / runtime trigger
  -> App
  -> Claude Agent SDK, the `query()` call
     -> Personal Management System Plugin as a local plugin directory
     -> App MCP
     -> Notion MCP
     -> GBrain MCP
```

The App passes a narrow trigger envelope, not a preassembled semantic context. Claude itself decides which domain tools are needed.

The runner is an App module that calls `query()` from `@anthropic-ai/claude-agent-sdk`. The App is written in NestJS and TypeScript, so the runner works through the SDK's TypeScript surface.

### Runner execution environment

`query()` starts a separate child process for each run.

```text
one run   = one subprocess
memory    ≈ 1 GiB per subprocess
timeout   no upper session timeout
```

`INV-304` The App enforces the bound through four mechanisms:

- its own queue with limited concurrency. The number of concurrent runs is a parameter of the App fixed in the contract ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_budget.concurrency`), not a consequence of how many triggers arrive at once;
- `maxTurns` from the `RunProfile`;
- `maxBudgetUsd` from the `RunProfile`;
- its own `AbortController` for each run.

The two budget fields of the profile are therefore always set, not only when needed.

The queue with limited concurrency is the admission of runs in `runs/`: a slot ticket in the ledger, not a separate queue in the runner. The scheduler claims a row only when a slot is free: an origin row that did not get a slot stays in its own queue unclaimed and unchanged. The ticket also bounds the run itself: the `AbortController` from the list above is owned by the dispatcher, which aborts the run before the ticket expires, and the runner connects this signal to the `abortController` of the `query()` call. The runner must heed the signal: an expired ticket gives its slot to the next one, and a run that outlived the ticket would run alongside that next run. The same signal bounds the applying of a run's writes: applying proceeds until the signal fires, and a write that is waiting for an external system stops waiting at that point, so the conclusion is recorded in the ledger before the ticket expires.

The daily limit on runs and the circuit breaker ([Observability and cost](#observability-and-cost)) work on top of the queue, not instead of it.

The organization's managed policy settings take precedence over the programmatic options of `query()`. The options below describe the App's intent; the effective configuration of a run is that intent narrowed by the managed policy.

So the perimeter is checked not against the options object but against what the run actually received — `init.tools` (`INV-302`, [Tool surface boundaries](#tool-surface-boundaries)). The CLI implements `outputFormat` with the synthetic tool `StructuredOutput`: it appears in `init.tools` and is called without an allow entry. The check runs together with the check of the MCP server statuses from the same message — [Runner MCP connections](#runner-mcp-connections).

The set of tools in `init.tools` must equal the row's allow-set together with the harness tools and `Read`. An extra name means a perimeter leak or a new vendor tool that `mcp_toolsets` does not have yet; a missing one means a required server that did not connect, or a narrowed policy. Both are technical failures, and the run is aborted before the first request to the model. There are two exceptions ([Runner MCP connections](#runner-mcp-connections)): a GBrain that did not connect degrades, and its tools simply drop out of the expected set; a Notion that is currently not responding (`failed`, `pending`) yields a deferral when that is the only init problem, and the App then retries the same run. A run does not receive a new vendor tool, and that does not stop work: when the only discrepancy is Notion or GBrain tools that the contract does not know, the runner denies them and repeats the launch once, and later runs deny them right away ([ADR 0031](decisions/0031-vendor-tools-denied-not-fatal.md)). The perimeter closes automatically rather than widening; when the log warns about a new vendor tool, it is worth sorting out its name in `mcp_toolsets`, but security does not depend on that. A tool known to the contract but outside the allow-set, a built-in tool, a foreign server or a missing allowed tool remain a failure with no retry. `init` lists more plugins than are declared. The CLI adds its own (`path: builtin`), and their set is not deterministic: the same CLI sometimes brings a built-in plugin and sometimes does not. So the check does not count the built-in ones and requires exactly one non-builtin plugin, `personal-management-system-runner`, from the declared directory: a check that recorded the contents of one snapshot would fail on the next. For a Skill run, `init.skills` must list `personal-management-system-runner:run`: without it the CLI would read the command in the prompt as ordinary text, and the run would proceed without instructions, with no sign of failure.

`INV-305` The App image carries the SDK's bundled CLI binary for its own libc — exactly one. The binary arrives through npm optional dependencies and is pinned to the SDK package version. So the production image does **not** install dependencies with `npm ci --omit=optional`: such an install produces an image without the binary, in which the runner does not start. `npm ci` itself selects the binary by the `os`, `cpu` and `libc` recorded in the lockfile. A lockfile written by a tool that does not preserve `libc` leaves npm without that axis: both linux variants arrive in the image, and the one for the other libc does not run.

The runner needs outbound access to:

```text
api.anthropic.com                model traffic
http://127.0.0.1:${PORT}/mcp     App MCP — loopback of the same container
https://mcp.notion.com/mcp       Notion MCP
${RUNNER_GBRAIN_MCP_URL}         GBrain MCP — over the Compose network
```

The public addresses of the App MCP and GBrain are for the chat path: [Public production MCP endpoints](#public-production-mcp-endpoints).

### Runner authentication

The runner authenticates with the installation owner's Claude subscription through `CLAUDE_CODE_OAUTH_TOKEN`. The App has no other way of authenticating: the run's environment carries only this token ([Run invocation](#run-invocation)).

```text
token source:     `claude setup-token`
validity:         one year
precondition:     an active Pro / Max / Ultra / Team / Enterprise plan
call accounting:  the plan's usage limits
```

This token is documented for Claude Code in CI; the hosting page of the Agent SDK does not describe it. This is a property of the chosen mechanism: the procedure for issuing and rotating the token comes from the Claude Code authentication documentation, not from the SDK's hosting documentation.

The token lives in the secret store and is passed to the run through `env` — [Secrets](#secrets). The MCP servers do not receive it: they get their own bearer tokens — [Runner MCP connections](#runner-mcp-connections).

### Run invocation

The App calls `query()` with the prompt `/personal-management-system-runner:run <trigger envelope JSON>` and an explicit set of options. The plugin command loads the run entry's `SKILL.md` in the first turn deterministically, not at the model's discretion, and substitutes the envelope as an argument. The model reads the remaining entry files itself according to the envelope's `mode`. A run with its own instructions — the gate command — is not a Skill run: its prompt is the envelope itself. The model, effort, MCP perimeter, tool surface, permission mode, result format and budgets are set explicitly, not taken from the SDK or CLI defaults.

`INV-030` The trigger envelope is narrow JSON. `app_db` rows, retry bookkeeping and the database schema do not reach the prompt. The canonical shape of the envelope is given in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `trigger_envelope`.

| Option | Value | Purpose |
|---|---|---|
| `plugins` | `[{ type: 'local', path, skipMcpDiscovery: true }]` | the runner's plugin, assembled by the image build; `skipMcpDiscovery` because the App owns the MCP connections |
| `mcpServers` | three entries `{ type: 'http', url, headers, alwaysLoad: true }` | App MCP, Notion MCP, GBrain MCP; `alwaysLoad` makes the server statuses final at init and does not hide tools behind tool search |
| `strictMcpConfig` | `true` | the MCP perimeter is narrowed to the three declared servers |
| `settingSources` | `[]` | no `~/.claude`, CLAUDE.md or project settings |
| `tools` | `['Read']` | of the built-in tools only `Read` remains: the model uses it to read the plugin's files according to the envelope's `mode` |
| `disallowedTools` | a reviewed list of built-in tools, the App, Notion and GBrain tools known to the contract that are outside the row, and the vendor tools unknown to the contract that `init` showed ([ADR 0031](decisions/0031-vendor-tools-denied-not-fatal.md)) | removes a tool from Claude's view |
| `allowedTools` | the expanded bundles of the mode's row (key `mode_toolsets`) and `Read(//<absolute plugin directory>/**)` | the run's allow-set; `Read` is allowed only in the plugin directory |
| `permissionMode` | `'dontAsk'` | a headless run with no interactive confirmations |
| `outputFormat` | `{ type: 'json_schema', schema }` | the SDK itself validates the evaluation result |
| `model`, `effort`, `thinking` | explicit, on every run | `RunProfile` |
| `maxTurns`, `maxBudgetUsd` | explicit, on every run | `RunProfile` |
| `sessionId` | the `id` of the ledger row | [Sessions](#sessions) |
| `persistSession` | `false` | the session lives in memory for exactly as long as the call lasts; no transcript is written to disk |
| `systemPrompt` | `''` or the gate run's instructions | the run's behavior comes from the Skill in the plugin directory, which the command in the prompt loads, not from the CLI's system prompt. The instructions, like a model that overrides the profile's model, travel with the run (the `shape` of the run request) instead of standing next to it as state |
| `abortController` | linked to the dispatcher's signal | `INV-304` |
| `stderr` | a handler that keeps the tail of the CLI's output without the run's secrets | diagnostics for a run that ended without a result message |
| `env` | a closed, named set | the subprocess's environment |
| `cwd` | the run's `HOME` | the working directory is the run's temporary directory: the run does not see the machine's files |

These options are never set: `fallbackModel` (`INV-032`), `resume` and `forkSession` ([Sessions](#sessions)), `canUseTool` and `hooks` (the perimeter is enforced by the options above, not by code in the App process).

The options and what the run expects from init (the session id, the model, the permission mode, the servers, the allow-set, the plugin) are derived from the same values in a single call: expectations written separately would drift from the intent. The stream observer keeps the facts — the init and its problems, a model substitution, tool calls, what was read, the plan quota, the result. The classifier decides what they mean for the outcome, and in what order.

In the TypeScript surface, `env` **replaces** the process environment rather than merging with it. The run's environment is therefore part of its definition: it is built from the declared set, the same way as the rest of the call's options.

```text
env = {
  PATH,                                   CLI binary lookup
  HOME,                                   the run's temporary directory
  CLAUDE_CODE_OAUTH_TOKEN,                authentication with the subscription
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  MAX_MCP_OUTPUT_TOKENS: '50000',         limit on an MCP tool result (DEF-29)
}
```

`HOME` is a separate temporary directory for each run, cleaned up after it: even without a transcript the CLI writes its state there, along with the organization policies it has loaded and oversized tool results.

`INV-306` The run's environment equals the declared set.

The set is extended explicitly and for a named need: a proxy or a corporate CA is added to the same list.

`settingSources: []`, `persistSession: false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and the declared `env` together produce a reproducible server-side run: its behavior is determined by the plugin directory, the call options and the CLI version, not by the state of the machine the container runs on, and the run itself leaves no state on that machine. The CLI version is part of the run's definition, on a par with the options: the built-in skills, slash commands and subagent types that init declares depend on it, so the CLI is pinned together with the SDK (`INV-305`), and the trace carries its version. The set of these built-ins also depends on the account's plan, but that is context, not perimeter: `Skill`, `SlashCommand` and `Task` are outside `tools`, so a run cannot call them.

### Runner MCP connections

The runner connects three MCP servers over HTTP transport and supplies the credentials itself:

```text
{ type: 'http', url, headers: { Authorization: 'Bearer …' } }
```

The SDK does not perform interactive OAuth. The App completes the authorization: Authorization Code + PKCE for Notion and client_credentials for GBrain. The run receives an access token that has already been obtained, injected into the `headers` of the matching server.

`strictMcpConfig: true` is the mechanism that keeps the perimeter to the three declared servers: the project `.mcp.json`, user settings, plugin MCP servers and claude.ai connectors do not reach the run. An empty `mcpServers` alone does not silence claude.ai connectors; it is `strictMcpConfig` that does the narrowing.

**A tool's name depends on the load path.** The canonical key of a server is the same on both sides — `app`, `notion`, `gbrain` — but the prefix is applied by whoever connected the server:

```text
App-triggered run     mcp__<server>__<tool>                  programmatic mcpServers
Plugin in Claude Code mcp__plugin_<plugin>_<server>__<tool>  plugin loader
Account connector     the client sets the name               Claude account
```

The scoped form is a requirement of the plugin loader: a rule written for the bare server key does not work there. So no statement about the tool surface is worded as if the names were the same on both paths, and the Skill names a capability, not a tool name — [Skill layer contract](#skill-layer-contract).

`INV-301` A failed MCP server connection throws no error. The status of each server arrives in the run's init message:

```text
connected | failed | needs-auth | pending | disabled
```

The runner checks the statuses of all three servers before trusting the result of the run. The required servers are Notion and App ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mode_toolsets.required_servers`): a run without `connected` on a required server is never a run with the outcome `no_action`. It is a technical failure, except in one case: the only init problem is a Notion that is currently not responding (`failed`, `pending`). In that case the run is deferred, and the App retries the same run ([Scheduler and outbox](#scheduler-and-outbox), `INV-109`). Revoked access (`needs-auth`) and a disabled server do not clear on their own: they are always a failure. GBrain degrades ([`3-policy.md`](3-policy.md#gbrain-unavailability)): without it the run continues, its tools drop out of the expected set of `init.tools`, and the trace records the degradation.

Core App-triggered functionality does not depend on MCP prompts or resources; it uses the surface tools.

### Tool surface boundaries

The three options work together and are not interchangeable:

| Option | What it does |
|---|---|
| `tools: ['Read']` | leaves `Read` as the only built-in tool; disables the rest |
| `disallowedTools` | removes a tool from the request — Claude does not see it |
| `allowedTools` | the run's allow-set |

`INV-049` The run's perimeter is set by the pair `allowedTools` + `permissionMode: 'dontAsk'`. Permission is evaluated in the order hooks → deny → ask → mode → allow → `canUseTool`: a call that no allow rule matches reaches the `canUseTool` step, which is skipped under `dontAsk`, and the call is denied. `allowedTools` alone does not set the perimeter: under another mode an unlisted tool falls through to the later steps and may be approved. Together with `strictMcpConfig` and `settingSources: []`, these options set the intent: exactly three MCP domains and no built-in tool except `Read` in the plugin directory.

`INV-302` The tool surface is closed in the run's effective configuration, not only in intent: `tools` in the init message of an App-triggered run contains no built-in tool except `Read` in the plugin directory, and no name outside `mcp__app__*`, `mcp__notion__*`, `mcp__gbrain__*` other than the declared harness tools ([`contracts/canonical.yaml`](../contracts/canonical.yaml), keys `harness_tools` and `plugin_tools`). For how the init message is checked against the intent, see [Runner execution environment](#runner-execution-environment).

`disallowedTools` lists the built-in tools explicitly, as a second layer. A complete list is not possible: the CLI has dozens of tools of its own, and the set changes from version to version. So the list is a single reviewed constant of the runner, tied to the SDK version, and an SDK upgrade forces a review of it. The primary layer is `tools: ['Read']`, and `init` checks what the run actually received. The same applies to the tools of a vendor's hosted server: on top of the tools the contract knows, the runner adds those that `init` showed and the contract does not know ([ADR 0031](decisions/0031-vendor-tools-denied-not-fatal.md)). `Read` is not in this list: deny takes precedence over allow, and a denied `Read` could not read even the plugin directory.

**`Read` is the only built-in tool of a run.** The behavior contract reaches the model by two routes: a command loads the run entry's `SKILL.md` into the prompt, and the model itself reads the other files it names. Without the `Skill` tool a run does not see the list of skills, so the entry is loaded by a command, not chosen by the model. The CLI substitutes `$ARGUMENTS`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` only in the body of `SKILL.md`, not in files read with `Read`: the envelope reaches the model as `$ARGUMENTS` in `SKILL.md`, and the substitution gives it no paths to the other files. So every name in the entry's table is resolved relative to one directory, the entry directory, where the image build also puts the knowledge ([Decomposition](#decomposition)). The model does not assemble a path from two places. `Read` is therefore allowed by the rule `Read(//<absolute plugin directory>/**)` ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `plugin_tools`). Under `dontAsk` everything else is denied: a file outside the directory, a `..` inside the allowed prefix and a symlink that leads out of the directory. A double `/` at the start means an absolute path; a single one means a path relative to the run's cwd, and with a single `/` the rule allows nothing. The rule is a property of the pinned CLI, not a documented contract. [ADR 0020](decisions/0020-skill-delivery-in-runs.md) explains why `Read` is allowed and what that costs.

`INV-311` The only built-in tool of an App-triggered run is `Read`, and it is limited to the plugin directory: a successful read of a file outside it is a run failure, no matter which allow entry the CLI gave. A denied attempt is not a failure.

The stream observer enforces the second layer in case an organization's managed policies have weakened the rule: a successful `Read` outside the plugin directory (an absolute path outside it, an escape through `..` or a relative path) aborts the run as a `perimeter breach`. An attempt that the CLI denies is the perimeter at work. The observer also keeps a list of what was read: the paths relative to the plugin directory, in order, with denied ones marked. The runner hands this list to the optional attempt subscriber (`RUN_TAP`), together with the denial texts from the result, the GBrain calls and the whole stream of the attempt: the model's text and the tool calls with their arguments and responses, without the run's secrets. In normal operation there is no subscriber, and the runner then does not collect the stream. The gate keeps the rest in its process's memory and writes the stream to one file per run in its own environment. None of this goes into the trace (`GAP-07`). For what reading any plugin file means for its contents, see [Personal Management System Plugin](#personal-management-system-plugin) in the Security section (`INV-038`, `INV-044`).

The permission namespace for MCP is `mcp__<server>__<tool>`, so a deny rule reaches MCP tools too, not only built-in ones. Deny rules accept a glob on the tool name, even as broad as `mcp__*` (all MCP tools of all servers).

**The asymmetry between allow and deny is a trap that makes it easy to lose the perimeter:**

| | glob | consequence of a mistake |
|---|---|---|
| `disallowedTools` | works, including `mcp__*` | — |
| `allowedTools` | a literal prefix `mcp__<server>__` is required; the server segment cannot be a glob | an unanchored `mcp__*` is ignored with a startup warning and auto-approves nothing |

`INV-307` An `allowedTools` entry names a specific tool or a narrow prefix within a single server, such as `mcp__notion__get_*`. A whole server name, `mcp__notion__*`, is never an allow entry.

Anchoring to a server is an SDK requirement; the narrowness of an entry is a requirement of the perimeter. A run's allow-set equals the row of its mode in the [mode → toolset](#mode--toolset) matrix. The run does not receive a tool that row does not name. A tool that appears on any of the three MCP servers does not become available until it is added to `mcp_toolsets` and named by a row of the matrix. That is why the registry is authored and not derived from `tools/list`.

`permissionMode: 'dontAsk'` is the runner's headless mode: there is nobody to ask for permission, so a call outside the allow-set is denied instead of waiting for confirmation.

`INV-303` Apart from `Read` in the plugin directory, a run has no filesystem tools, and this has a consequence for the App MCP. When a tool result exceeds the `MAX_MCP_OUTPUT_TOKENS` limit (25,000 tokens by default), the CLI writes it to a file outside the plugin directory (in the run's `HOME`) and replaces it with an error text naming that file; Claude cannot read the file back. The run raises the limit to 50,000, but a second layer sits above it: the CLI again stores output above ~100 KB in a file and gives the model only a preview. So App MCP responses stay well below both limits: every tool has a declared response bound, and where the bound can truncate a collection, the response says so. This is a requirement on App MCP tools, not on the Skill's instructions. A Notion or GBrain response above either layer remains a dead end inside the run (`DEF-29`): the Skill tells the model to keep queries narrow (a filter, a small page, few fields) and, when a tool says the result is too large, to narrow the query rather than repeat the same call or draw conclusions from a result it did not receive.

### `RunProfile`

There is one configuration record per mode: model, effort, limits and budgets make up one axis, not two. The decision is recorded in [ADR 0008](decisions/0008-runprofile-per-mode.md).

```typescript
interface RunProfile {
  model: string;               // explicit model identifier
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  thinking: 'adaptive';
  maxTurns: number;
  maxBudgetUsd: number;
}
```

If the active model does not support the configured `effort` level, the resolution drops to the highest supported level at or below the configured one. So the profile sets an intent, not a guarantee: the effective effort level depends on the model the profile is paired with.

`effort` and `thinking` are independent axes. The effort level does not set the thinking mode, which in a run has the value `{ type: 'adaptive' }`.

`model`, `effort`, `thinking`, `maxTurns` and `maxBudgetUsd` go straight into the options of `query()`. Tool budgets are not part of the profile: they are not an SDK option but a context discipline that the Skill layer keeps and the trace checks. They determine how much domain context a run is allowed to pull in, not what it costs.

The canonical values of the tool budgets are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `retrieval_budgets`.

The model, `effort` and `maxBudgetUsd` are the same for all App-triggered modes. The profile values are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_profile` ([ADR 0012](decisions/0012-run-profile-and-plan-quota.md)): `default` is the profile of all modes, and `per_mode` is how a mode's profile differs from it. A profile's model is available only to a CLI that recognizes it, so a model upgrade is an SDK upgrade. [ADR 0008](decisions/0008-runprofile-per-mode.md) explains why the model and effort are shared until calibration and why the frequency of a mode's runs does not justify a cheaper model. Calibration waits for an eval dataset (`GAP-06`).

`maxTurns` is derived from the mode's reads budget ([`contracts/canonical.yaml`](../contracts/canonical.yaml), keys `retrieval_budgets` and `run_profile`): a run makes about one call per turn, so the ceiling has room for the reads budget, the Skill files that the mode opens first and the steps a run always takes (`runtime_read`, the conclusion, the limits on new threads and messages), plus a margin for App calls. Reviews read several databases and have their own reads budgets, and so their own turn ceilings ([ADR 0036](decisions/0036-scheduled-reviews.md)).

`INV-031` `model` and `effort` are set explicitly in every run. The CLI default drifts with the version of the SDK package, so a run that relies on it changes behavior together with a package upgrade.

`INV-032` There is no fallback to another model. When the model is unavailable, the run fails with no partial effects and is retried with the same profile. This rule is about the model; lowering `effort` to a supported level is an SDK resolution on a different axis and does not fall under it.

`INV-033` The `modelUsage` of every run is asserted in the trace: the profile's model is present with the same `canonicalModel` and did the main work. The CLI also reports an auxiliary, smaller model for utility calls in `modelUsage`; it is not a fallback.

Profile values are contract values, like `run_budget`, not environment variables: a calibration change shows up in the diff. The path to the plugin directory and the subscription token belong to [Configuration contract App](#configuration-contract-app).

### mode → toolset

| Mode | Notion MCP | GBrain MCP | App MCP |
|---|---|---|---|
| `event_evaluation` | `read` | `read` | `attention`, `continuation`, `delivery`, `approval`, `memory`, `introspection` |
| `scheduled_recheck` | `read` | `read` | `attention`, `continuation`, `delivery`, `approval`, `introspection` |
| `closure_processing` | `read` | `read` | `memory`, `introspection` |
| `daily_control` | `read` | — | `delivery`, `approval_view`, `introspection` |
| `weekly_control_review` | `read` | `read` | `attention`, `delivery`, `approval`, `introspection` |
| `strategic_review` | `read` | `read` | `attention`, `delivery`, `approval`, `introspection` |
| `deep_review` | `read` | `read` | `delivery`, `introspection` |
| `dialogue` (Chat) | full, user-authorized | full | per `chat_toolset` |
| `dialogue` (App-triggered: an Inbox item, a reply in a `dialogue` thread) | `read` | `read` | `attention`, `capture`, `continuation`, `delivery`, `approval`, `memory`, `introspection` |

The cells are bundle names. The table is a checked representation of [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mode_toolsets`, except for the chat row: there the person chooses Notion and GBrain, and the App tools are exposed per `chat_toolset`, as capabilities rather than bundles.

**The chat toolset.** A chat session is not a run: it has no matrix row, and the person chooses Notion and GBrain there. The Notion MCP also lets the chat move pages and databases to the trash (`notion-delete-pages`, `notion-delete-databases`). The trash is restorable. A tool called without `user_confirmed: true` moves nothing and only lists what would disappear. The chat's Skill moves anything to the trash only at the person's separate request and after their explicit “yes”. But the App is the project's own code, and it decides for itself what it exposes to the chat ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `chat_toolset`). The chat sees conversion, closing and parking of an Inbox item, continuations, delivery, reading proposals, the decision on a proposal, memory writes and introspection. It does not see `comment_write`: the person's voice in the chat goes through the Notion MCP ([ADR 0017](decisions/0017-two-authors-of-notion-changes.md)), and a run writes a comment in the system's voice. It does not see `approval_propose` either: a proposal from the chat left unanswered in the same turn stays an Inbox item (`INV-015`). `approval_decide` and `capture_park` are withheld from runs because only the chat sees them. The mirror of the contract in code is `runs/toolsets.ts`. [ADR 0021](decisions/0021-chat-path-oauth-and-chat-toolset.md) explains why the App is its own authorization server and sets the chat toolset itself.

`INV-313` The toolset of App tools on the Chat path contains neither `add_comment` (the person's voice in the chat goes through the Notion MCP) nor `create_pending_action`: a proposal from the chat left unanswered in the same turn stays an Inbox item (`INV-015`).

The canonical list of modes is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `workflow_modes`; the limits of the capture path are in keys `capture_policy` and `capture_policy_rules`.

`read` on GBrain in a review row does not mean that the conclusions go nowhere: it means that the run itself does not write. A durable review conclusion takes one of two routes: a system comment on the relevant Notion object, applied together with the run's other writes, or a row in `pending_actions`, which the executor executes as a system write after approval. The executor is App code, so the run's allow-set does not restrict it. This is `INV-034`: a review proposes; it does not rewrite.

A matrix row defines the run's allow-set: each capability it names expands into concrete tools of that server, and these go into `allowedTools` (see [Tool surface boundaries](#tool-surface-boundaries)). The expansion itself is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mcp_toolsets`: each capability maps to the literal names of tools, which are checked against the `tools/list` of the transport the run goes through. `disallowedTools` remains the second layer: a blanket ban on built-in tools and on those `mcp__<server>__<tool>` that must be removed from Claude's view altogether. The App builds this list per run instead of exposing all write tools unconditionally.

A server for which the row provides no bundle is not connected to the run: `daily_control` does not read memory ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `retrieval_budgets.per_mode`), so GBrain is neither in its allow-set nor among its servers.

`INV-034` On detector-driven paths the Notion MCP only reads: the system writes the comment through the App, and a material domain write goes through `pending_actions`.

`INV-096` The `closure_processing` mode writes only memory, through an App intent (`memory_record`): it reads Notion and GBrain, and the rest of its App tools are reads.

The capture path likewise only reads Notion through the Notion MCP: the Task from an Inbox item is created by a conversion through the App, within the limits of the person's standing authorization (`capture_policy`). The App checks these limits mechanically: database type, Level, status and relations. An Inbox item that was resolved without a Task is closed by `close_inbox_item`, and only in a conversation step. For a duplicate the App checks that the existing Task is open. Only `dialogue` runs see the `capture` bundle. An item that needs the person's decision is not closed but stays in the Inbox with a comment.

**The enforcement boundary that no mechanism removes:**

| Boundary | Why | Control |
|---|---|---|
| Chat path | The person determines the Notion and GBrain part of the toolset through the Plugin; the policy is advisory (the App part is enforced by `chat_toolset`) | Skill + the person's presence; the `path-parity rate` metric |

### Sessions

The App sets a run's `sessionId` before the run starts, so that the run can be matched unambiguously to its trigger and trace.

The `sessionId` is the identifier of the ledger row: the dispatcher passes it to the runner together with the envelope. So the trace has no separate column for the session: `session_id` is the row's `id`, and the runner treats a result message with a different `session_id` as a technical failure.

The runner does not use `resume` or `forkSession`. The SDK session transcript is a local file that does not survive a container restart (a run does not even write it: `persistSession: false`). The SDK documentation itself advises rebuilding the prompt from one's own state rather than relying on resume. This matches the continuation model of Personal Management System: a scheduled recheck carries only identifiers and rereads fresh state (see [Scheduled recheck](#scheduled-recheck) and [Runtime continuity requirements](#runtime-continuity-requirements)).

### Run result

A run's result message carries:

```text
session_id
is_error
terminal_reason
structured_output
permission_denials
duration_ms
num_turns
total_cost_usd
usage
modelUsage
```

Model and token accounting uses `modelUsage`. `total_cost_usd` is an estimate; budget decisions do not rely on it. A failure is reported by `is_error` and `terminal_reason`, not by `subtype`: `success` also arrives with `is_error: true`, for an unauthenticated run and for a run on an unavailable model. The SDK then also throws an exception. The runner classifies by the result message, not by the exception. `apiKeySource` does not indicate authentication either: under a subscription token it is `none`. An exhausted plan quota is not a failure: the run ends `deferred` ([Observability and cost](#observability-and-cost)).

Evidence that the plan quota has been reached is a limit event with `status: rejected`, overage usage, a `rate_limit` error in an assistant message or `terminal_reason: blocking_limit`; a limit event with `status: allowed` arrives in every run and is not evidence. The runner aborts the run as soon as the evidence appears, as it does on an `init` that cannot be trusted and on a model fallback that the CLI would make automatically (`INV-032`): the run spends no more than it has already spent.

### Result validation

The SDK itself validates the evaluation result through `outputFormat: { type: 'json_schema', schema }`. The schema is generated from zod in draft-07 with `z.toJSONSchema(s, { target: 'draft-7' })`. The SDK rejects newer drafts. The canonical shape of the result is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `evaluation_result`.

The schema enforces content as well as form: the `type` of a detection is a value of `detector_labels`; `evidence` and `counterevidence_checked` of every detection are non-empty together with their elements; and `outcome` is snake_case. The CLI checks `enum`, `minItems` and `pattern` (Ajv without `format`): a violation is returned to the model as a tool error, and the model corrects the result in the same run. Once the attempts are exhausted, the run fails. Field descriptions (`description` in zod) go into the same schema, so the model sees them in the tool schema from the first turn. The schema does not check a label's mode (`detector_activation`): that is enforced by the Skill (`claims.md`) and by gate M6 (observations derived from the key), and a test checks that the Skill agrees with the key.

A run is considered successful only when `is_error` is false, `terminal_reason` is `completed` and `structured_output` is present and passes the App's schema: the CLI validates draft-07 but does not check `format`, so the App checks the result once more with its own zod schema.

`INV-035` An invalid or missing structured output leaves no App effects: this run's App MCP writes are not applied ([App MCP](#app-mcp)), the failure goes to the trace, and the retry stays within the attempts of the origin row. System writes to Notion and to GBrain memory go through the App and wait for the same conclusion (`INV-088`, [Writes to GBrain](#writes-to-gbrain)).

`INV-036` Every `evidence` ref matches an object read by a tool call in the same run.

An object counts as read if a successful call of a tool of the same server in this run returned its identifier. Notion ids are compared in canonical form. A Notion reference with exactly one id (a database address `collection://<id>`, a page URL) is compared by that id, because the response names the object by id and not by the address the model requested it by. Anything else is matched as a string in the response. The text of the responses is held only in memory for the duration of the run and does not go into the trace (`GAP-07`).

### Standard cognitive cycle

Whatever the trigger, Claude goes through one common cycle.

#### Applying operating-loop phases

Every run applies one or more functions of the methodology's operating loop:

| Phase | Behavior MVP |
|---|---|
| `Capture` | save the input quickly, without premature classification |
| `Clarify` | determine whether the input is actionable, the object type and, if a Task is created, the Task Status |
| `Organize & Align` | write to the right Notion object or store, set the minimally useful relations and check capacity and alignment |
| `Engage` | show the hard landscape and a small Available Now; do not turn the full Task database into an execution interface |
| `Reflect` | reread the current state, hold the relevant review and find stale or inconsistent commitments |
| `Adapt` | change the Task or its status, Project, Behavior System, Objective/Key Result, Area of Focus.Mode, Principle or process according to evidence and authorization |

A run is not required to go through all six phases mechanically. For example, a Task event may be `Reflect → Adapt`, and an explicit command “write this idea down” may be `Capture → Clarify → Organize & Align`.

#### Determining scope

Claude first determines the narrowest canonical object, Inbox item or discussion that is the center of the situation.

For a webhook, the scope may already contain the exact page or comment ID. For a conversation, the scope may be found through an explicit mention, Notion search, a GBrain alias or context or the person's clarification.

Do not start with a global workspace search if the precise scope is already known.

#### Reading the current management/operational state

Claude reads the target object, the relevant properties, unresolved discussions and direct relations.

Further relation traversal depends on the hypothesis. For example, a `Waiting For` Task may need its dependency, Project and alternative Tasks; for Project deadline risk, the critical unfinished Tasks; for Behavior System friction, the cue, environment and recovery fields and recent evidence; for an Objective decision, the Key Results, the related Area of Focus and, through the Key Results, the supporting mechanisms: from the Objective's side this is a two-step traversal, not a direct relation.

#### Restoring bounded semantic context

Where a canonical GBrain anchor exists, Claude reads the compiled truth and the structural neighborhood. Hybrid retrieval is performed only when needed.

#### Hypotheses and counterevidence

For every plausible detection Claude determines:

- which claim Claude is checking;
- which evidence supports that claim;
- which facts could refute or weaken it;
- why the situation matters at the moment.

`no_action` is a full-fledged, correct result.

#### Choosing the smallest useful effect

The result of the cycle may contain:

- a reply to the person;
- no external action;
- a reply to or creation of an attention discussion;
- a scheduled continuation;
- a proactive notification;
- an explicitly authorized native domain action;
- a proposal for an approval-required action;
- a review packet or Available Now;
- a durable memory item, when the policy allows it.

---

## Skill layer

### Skill layer contract

There is a single copy of the Skill source: the Chat entry and the knowledge live in `plugin/`, and the run entry lives in `app/plugin/`. Each execution surface loads its own:

```text
plugin/                                 -> installation marketplace     -> Claude Chat
app/plugin/ + plugin/ knowledge         -> App image, local plugin      -> App-triggered run
```

The knowledge is stored in the repository once, in `plugin/`: the image takes it from its own commit, and the chat takes it from a pinned commit. A shared commit makes the two identical. The run entry does not reach the chat, and the chat plugin does not go into the image ([ADR 0047](decisions/0047-chat-and-runner-plugins.md)).

Both plugins come from one commit: the image is built from it, and the installation's marketplace entry pins its `sha`. The server is upgraded first and the `sha` follows ([RUNBOOK](../infra/RUNBOOK.md#release-order)), so the chat does not run ahead of the App, and rolling the chat back means returning to the previous `sha`.

`INV-308` The Skill refers to a capability, not to a tool name. Tool names differ on the two paths (see [Runner MCP connections](#runner-mcp-connections)), so a behavior tied to a literal name is not reproduced on one of them, and `path-parity rate` has nothing left to measure.

The Skill source has version-control and review provenance. The version of the behavior contract that a run sees is the content of the runner plugin in the same system release as the App; its digest is kept in the `init` snapshot of the trace.

### Routing tools

The Skill layer uses this rule:

```text
Need current operational state?
  -> Notion MCP

Writing to Notion on the person's behalf (the person asks for it in the chat)?
  -> Notion MCP

Writing to Notion on the system's behalf (a comment, a conversion or the closing
of an Inbox item)?
  -> App MCP

Parking an item in the Inbox when it was not resolved in the chat (the person's
words, which the App carries over on the bot's behalf)?
  -> App MCP

Need semantic memory or a native GBrain operation?
  -> GBrain MCP

Need a durable continuation, technical delivery,
a pending approval lifecycle or narrow runtime state?
  -> App MCP
```

A side effect is not in itself a reason to route a domain operation through the App MCP. The reason is voice: only the App writes to Notion on the system's behalf.

### Decomposition

```text
plugin/skills/
└── personal-management-system/                  — the Chat entry, self-contained
    ├── SKILL.md                — what to do when the person speaks; situation → files
    ├── conversation/           — conversation procedures: capture, changes, follow-ups, reviews,
    │                             pages (GBrain pages: change, link, lesson)
    └── knowledge/              — surface-neutral knowledge; the run entry reads it too
        ├── ontology.md         — canonical types, statuses, Date and Deadline, Levels
        ├── clarify.md          — how to resolve an input: destination, equivalent, fields
        ├── detectors.md        — `detector_labels`, evidence standards, the self-regulation limit
        ├── portfolio.md        — statuses of Project, Behavior System, Area of Focus, Objective
        ├── memory.md           — GBrain anchors, exact identity, what to write and how
        ├── lessons.md          — lesson and pattern: episodes, thresholds, what the wording names
        ├── reviews.md          — what each review covers, day and staleness limits, judging findings
        └── schema.md           — field states, `schema_gap`, `ambiguous_input`, `Hidden`

app/plugin/skills/
└── run/              — the App-triggered run entry
    ├── SKILL.md                — the envelope, the files by `mode`, the budget
    ├── knowledge/              — in the image only: the build puts the Chat entry's knowledge here
    ├── frames/                 — a procedure for each dispatched mode, and the review budget
    ├── acting.md, claims.md    — how a run acts; what to do with a label
    ├── reviewing.md            — how a review composes the packet and the result
    ├── follow-ups.md, notifications.md, proposals.md
    └── result.md               — the form and semantics of the result
```

The knowledge is kept once, in the Chat entry's directory, and the Chat entry does not depend on the run entry: it works as a directory loaded separately. The run entry sees the knowledge as its own `knowledge` directory: the image build puts that same directory there, so every name in its table is resolved relative to its own directory, and the `Read` perimeter is a single rule. Every mode that the App dispatches has a frame, and no other mode has one ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_frames`).

A file name in the Skill text refers to the **owner**: the file where the rule or definition that a step applies lives. A step refers to the owner and adds only what is its own: the source, the limit, the order, the result. The owner itself names the files it points to. A path is what the agent follows for one case: the shared steps and one branch of a frame, a section of a procedure, a kind of review, a label card. On one path the owner of a rule is named once. The agent uses these names to open files “as needed”: in the run entry, the files named in the file that the `mode` reads first, or in a file that the first file has already pointed to. In the Chat entry, a sentence below the router also names each such file, together with its question. Knowledge that both entries read names only knowledge, so an entry's procedure that the knowledge points to is named by that entry's router. The router test enforces that the “as needed” files are reachable. Whether each name is needed is an editorial judgment, as with `INV-037`.

`INV-048` Every execution surface has its own plugin, while the domain knowledge lives in one place: the chat plugin is installed from the `plugin/` directory at a pinned commit, and the App image assembles the runner plugin from the runner's entry and the same knowledge and attaches it as `plugins: [{ type: 'local', path, skipMcpDiscovery: true }]`.

`INV-037` Every Skill entry contains only what its situation needs: the run entry holds the files of its `mode`, the Chat entry holds the files of the conversation situation. The rest is progressive disclosure, and the volume that a situation loads on its first read is limited.

`INV-038` The Skill operates on canonical semantics; physical names come from `get_schema_mapping`.

`INV-039` `detectors.md` is a single multi-label ontology. The canonical list of labels is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `detector_labels`.

`INV-040` The Skill makes no external network calls. On the App-triggered path a mechanism backs this up: of the built-in tools only `Read` in the plugin directory remains, and `WebFetch`/`WebSearch`/`Bash` are in `disallowedTools` (see [Tool surface boundaries](#tool-surface-boundaries)).

`INV-314` **The Skill is an instruction for an agent, not a copy of the norms.** The text of the Skill is read by a model that does not know the project: it contains no implementation requirements, acceptance criteria, register gaps, references to norms and decisions, design rationales or negations of its own identity; every rule is stated in one place. The behavior a norm requires is ensured by the implementation, not by a reminder in the text.

`INV-315` **A surface has its own entry; knowledge knows nothing of the surface.** The Chat entry does not speak of runs, the run entry does not speak of Chat, and the knowledge both read speaks of neither. “In Chat… in a run…” inside one file means there are too few files, not that the agent has to be told how it was launched.

**Delivery.** The chat plugin is installed from the installation's marketplace: a separate repository with a single file that follows the template `infra/marketplace.example.json`. The entry points to `plugin/` of this repository through `git-subdir`, with `ref` and `sha` pinned. It carries a name, a description and connectors with the installation's addresses. It serves as the plugin's manifest, so it has `strict: false` and no `version`: the chat's version is set by the `sha`. The source must be a public repository: claude.ai does not read a private external source. It is not proven that a plugin from claude.ai reaches all of the account's clients (`GAP-08`). `.mcp.json` takes the App and GBrain addresses from the variables `APP_MCP_URL` and `GBRAIN_MCP_URL` of the Claude Code environment, and the entry overrides these connectors by name. The account connectors provide the tools. The image build assembles the runner plugin from `app/plugin/` and the chat plugin's knowledge and passes it to the runner through `plugins: [{ type: 'local', path }]`. A run loads the entry's `SKILL.md` with the command `/personal-management-system-runner:run` and reads the files of its `mode` and the shared knowledge with `Read` in the plugin directory ([Tool surface boundaries](#tool-surface-boundaries)). In Chat the `personal-management-system` entry is loaded by its `description` ([ADR 0026](decisions/0026-separate-plugin-entries.md), [ADR 0047](decisions/0047-chat-and-runner-plugins.md)). The Skill upholds the discipline that no mechanism enforces: GBrain is written as the last step of a run, and Notion and GBrain queries stay narrow. The App derives the idempotency key ([ADR 0025](decisions/0025-app-derives-delivery-key.md)).

---

## Persistence

### Runtime continuity requirements

The App exists so that cognitive work survives time and technical interruptions.

The MVP requires durable support for:

- event deduplication;
- scheduled rechecks;
- retryable delivery notifications;
- pending approvals and actions, when they are needed;
- recovery after a process restart.

These mechanisms do not become hidden domain memory.

A scheduled continuation stores only the technical identity that is enough to reopen the authoritative discussion and Notion state later. It does not store a semantic shadow copy of the problem.

The App's `scheduled_recheck` is a runtime wake-up mechanism and is not the same as the Task status `Scheduled`, the Task property `Date` or a Calendar event. Domain time semantics stay in Notion. The App stores only the technical continuation needed for a reliable relaunch; a recheck always rereads fresh Notion state.

A durable approval or action record stores the proposal's immutable contract (the effects with their values and the preconditions), so after approval the action cannot silently turn into a different action.

### Minimum logical records of `app_db`

The exact SQL DDL belongs to the App implementation and migrations. This section records the minimum logical persistence contracts so that the reliability semantics are not lost.

#### `webhook_receipts`

```text
id
source                 the event source; together with external_id it forms the unique identity:
                       a separate column with a closed list keeps the sources apart, so
                       identifiers from different sources do not overlap
external_id            the event's identifier at the source
event_type
entity_id?
page_id? / object scope
attempt_number?        the provider's attempt number, taken from the event itself
diagnostics            a projection for diagnostics, not the provider payload
received_at
processed_at?
status
last_error?
```

The table provides idempotency, retry and recovery after a duplicate delivery or a process failure.

`diagnostics` holds a **projection for diagnostics**, not the provider payload: types, identifiers, authors, the attempt number. It deliberately has no content: a Telegram update carries the text the person typed to the bot, and keeping it in the clear in a technical table forever would mean keeping the person's notebook where nobody needs it. The caller builds the projection, so an omitted field is visible at the call site.

Rows older than the provider's redelivery window are pruned. The retention period is **derived**, not chosen: Notion redelivers up to eight times over ≈24 hours, so deduplication must cover that period, and seven days (`receiptRetentionDays` in `maintenance/maintenance.config.ts`) gives a margin of an order of magnitude. The same period prunes the rows that have reached a **conclusion** (`done`) in all three run queues: `evaluation_windows`, `scheduled_checks` and `review_occurrences`. This is not a retention decision either: only a successful run can conclude a queue row, and that run has left its envelope in `run_traces` (the origin, its id, the time, the page) and a back reference through `origin_id`. What is pruned is a copy, not history. For each review, the last occurrence that took place stays: the next occurrence computes `since` from it ([Schedule and recurrence](#schedule-and-recurrence)). The match of the period with the receipts is derived too: the only value a concluded row has left is forensic, and its anchor, the event receipt, disappears at the same horizon.

`failed` queue rows are not pruned. No run took place and no run trace exists, so the row stays the only record of work the system did not do. Retention of run traces and of the delivery queue is not covered here: that is history, and its period is the owner's decision.

**An unfinished receipt is a claim, not a fact:** a provider redelivery continues the work from the same row, and idempotency is guaranteed by the key, not by the transaction. The statuses, what `rejected` is for and why `failed` is not terminal are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `webhook_receipt`.

#### `scheduled_checks`

```text
id
discussion_id?         the attention thread, if a conversation has already taken place
notion_page_id
run_at                 when to wake
reason_code
version                increases when scheduling moves the row
status
attempt_count
locked_until?          who is working on the row at the moment
last_attempt_at?
last_error?
notion_hold_until?     the time until which the row waits for Notion: the run did not reach Notion
notion_held_since?     when the row's uninterrupted wait for Notion began; the pause
                       and the limit of the wait are counted from it
failure_noticed_at?    when the person was told that a wake whose time they named did not take place
created_at
updated_at
```

The baseline technical vocabulary of `reason_code` is in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `reason_codes`.

`reason_code` explains the technical wake-up reason but does not classify a semantic issue.

The statuses and lifecycle rules are in the same file, key `scheduled_check`.

#### `evaluation_windows`

```text
id
page_id                the page whose events are merged
discussion_id?         appears if the window includes comment.created or a person's reply
                       from the channel
person_replied         the person replied in a discussion the system manages;
                       a merge does not clear the fact
inbox_item_created     the person put this page in the Inbox in Notion
channel_inbound        the person replied in the channel to a system message: the person's
                       message is already in Notion as a comment in the thread, and the window
                       was opened by the channel consumer; always together with
                       `person_replied` and `discussion_id`
updated_properties     the union of the changed property IDs across all events of the window
event_types            the event types that entered the window: a sorted set,
                       not a history
latest_event_id        the event that closed the window
latest_event_type      its type; kept apart from `event_types` because that set is sorted
                       and does not answer the question “which one was last”
latest_event_at        the time of the event itself, as the provider reported it, not the time
                       the row was written: this is the time that goes into the envelope
                       (`INV-030`)
not_before             the end of the window
version                increases with each merge
status
attempt_count
locked_until?          who is working on the row at the moment
last_attempt_at?
last_error?
notion_hold_until?     the time until which the row waits for Notion: the run did not reach Notion
notion_held_since?     when the row's uninterrupted wait for Notion began; the pause
                       and the limit of the wait are counted from it
created_at
updated_at
```

The table implements debounce and coalescing (`intake/notion/` in the [module map](#module-map)). The facts `person_replied`, `inbox_item_created` and `channel_inbound` determine the window's origin and partition the selection of candidates; the channel consumer (`intake/channel/`), not the Notion webhook, absorbs `channel_inbound` into the same window of the thread's page. `inbox_item_created` applies only to pages that the person put in the Inbox in Notion themselves: the channel creates no Inbox items. A window with no new events is retired as `failed`. The rule and its reason are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `evaluation_window`; the maximum age is `evaluationWindow.maxAgeDays`.

The table is kept separate from `scheduled_checks` on purpose. The boundary between them lies not in the mechanics (which are the same) but in the payload. `INV-020` promises that a continuation has a narrow envelope: thread, page, reason. An event carries a wider one ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `trigger_envelope`). One table for both paths would make that promise unverifiable. The second reason is that `reason_codes` is closed and has no value for “a property has just changed”. A window does not need a reason anyway, because the event itself names it.

There is one open window per page (the partial unique index `evaluation_windows_one_open_per_page`; see [Implementation inventory](#implementation-inventory)), and the window is **not** an attention thread: `INV-204` forbids per-page uniqueness for threads. Threads live in `scheduled_checks`, and partial unique indexes there enforce one active wake and one active closure per `discussion_id` and, for rows with no thread, one per pair “page, `reason_code`”.

**Concluding a row is conditional.** “Open for absorption” and “already in progress” are one state: an event that arrives between the claim of the window and its conclusion is absorbed into a row that has already been handed to a run along with the snapshot that was read. So the row carries a version, and the row is concluded only at the version the run saw; otherwise the row is made claimable again together with what was absorbed. A timestamp is not enough for this: it has millisecond precision.

The same rule applies to `scheduled_checks`, for the same reason: a snooze set during an active recheck moves `run_at` of a row that would otherwise become `done` a second later, and the person's instruction would be lost.

The window's ceiling limits how far events can **push the window back**. It does not pull the window forward: a window that comes due a second time because it changed during the run stays pushed back by a new quiet period, even though its ceiling is already in the past.

The statuses and rules are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `evaluation_window`.

#### `system_discussions`

```text
discussion_id          the Notion thread the system commented in
page_id                the thread's page
mode                   the mode in which the thread continues when the person replies
first_written_at
last_written_at
block_id?              the block the thread is attached to; empty means the thread is on the page
last_comment_id?       the system's last comment in the thread
```

This table is the registry of discussions the system manages (`attention/` in the [module map](#module-map)): a row appears with the system's first applied comment in a thread, and each later comment advances the last-write time and the last comment. Intake asks the registry whether a person's reply is a reply to the system ([System-managed attention episodes](#system-managed-attention-episodes)). The row does not carry the comment text: the text lives in Notion, and the row keeps only what identifies the thread without a query to Notion.

`mode` determines the mode of the reply run: a thread in `dialogue` continues in `dialogue`, all others in `event_evaluation`. It is set by the system's first write in the thread and does not change afterwards. A thread on an Inbox item is `dialogue`, whoever opened it: a reply about an Inbox item is its processing, and an Inbox item is processed by a conversation step. Any other thread continues in the mode of whoever opened it. A row the system has not written to for a long time is pruned. The rule and its reason are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `system_discussion`; the retention period is `maintenance.systemDiscussionRetentionDays`.

`block_id` and `last_comment_id` are the thread anchor and the comment by which the [reconciliation](#resolved-thread-reconciliation) finds a resolved thread: Notion returns the unresolved threads of a block only by block id, and a comment that can be read distinguishes a resolved thread from a deleted one. The reconciliation draws no conclusion about a row without them; the system's next write in the thread fills in both.

#### `sweep_marks`

```text
page_id                the page the sweep woke
rule                   the rule by which the situation was found
basis_hash             the hash of the basis
woke_at
```

This table is the memory of the [periodic safety sweep](#periodic-safety-sweep): a candidate that was woken on the same basis is not woken a second time by the sweep, even when no run took place — otherwise an overdue `Waiting For` would wake a run on every tick. The basis is stored as a hash: `app_db` holds no domain values. The sweep's daily limit counts rows by `woke_at`, and a mark older than the recency threshold is forgotten: the situation arose no later than the time it was woken, and beyond the threshold the sweep no longer wakes it.

#### `discussion_reconciliations`

```text
discussion_id
seen_open_at?          when the reconciliation last saw the thread among the unresolved ones
closure_requested_at?  when the reconciliation last requested a closure
gone_at?               when the reconciliation found the thread deleted
checked_at?            when the reconciliation last asked about the thread's anchor
```

This table is the memory of the [resolved-thread reconciliation](#resolved-thread-reconciliation): the reconciliation draws a conclusion about a thread that is not among the unresolved ones only if the thread has been seen open since the last conclusion. `checked_at` drives a round-robin pass over the anchors. Rows of threads outside the reconciliation's scope are pruned.

#### `review_occurrences`

```text
id
mode                   a review; CHECK lets no other mode through
occurrence_key         the period key in the installation's time zone
due_at                 the time of the occurrence
closes_at              the end of the window: an occurrence that did not take place before it
                       is retired
since_at               the time from which the review looks at changes
status
attempt_count
locked_until?          who is working on the row at the moment
last_attempt_at?
last_error?
notion_hold_until?     the time until which the row waits for Notion: the run did not reach Notion
notion_held_since?     when the row's uninterrupted wait for Notion began; the pause
                       and the limit of the wait are counted from it
failure_noticed_at?    when the person was told that the occurrence did not take place
created_at
updated_at
```

This table holds the occurrences of a [scheduled review](#schedule-and-recurrence): one row per period, unique by `(mode, occurrence_key)`. Claiming, returning, the attempt counter and the wait for Notion work the same way as in `scheduled_checks`; the statuses and rules are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `review_occurrence`.

#### `notification_outbox`

```text
id
idempotency_key        unique delivery operation
discussion_id?
channel
payload
external_id?           the message id the channel gave, only in `sent` rows
status
attempt_count
next_attempt_at?       when the row may be tried at all (backoff,
                       `retry_after`, quiet hours)
locked_until?          who is trying it at the moment
quiet_hours_exempt     whether the delivery breaks through quiet hours
sent_at?
last_error?
created_at
```

`external_id` serves two purposes: it lets a person's reply find the queue row, and through it the thread the message was about (the index `(channel, external_id)`), and it lets the system edit that same message when a proposal closes ([Telegram — channel adapter](#telegram--channel-adapter)).

There are two fields, `next_attempt_at` and `locked_until`, and no status “being sent”: backoff and the lease answer different questions, and the lease, not a status, says who is currently trying the row. See [`contracts/canonical.yaml`](../contracts/canonical.yaml), keys `notification_delivery` and `runtime_record_rules`.

The outbox guarantees that a logical delivery is queued **once** — the unique `idempotency_key` merges parallel attempts to enqueue the same delivery — and that the row is retried until it succeeds or reaches the attempt limit, after which it becomes `failed`. Exactly-once on the wire does not follow from these guarantees: see [Telegram — channel adapter](#telegram--channel-adapter). A concrete provider is not a state authority and can be replaced.

#### `notification_proposals`

```text
outbox_id              the message                         PK (outbox_id, pending_action_id)
pending_action_id      the proposal it showed
position               the zero-based place in the packet  unique (outbox_id, position)
fate?                  what the proposal has become; empty means it awaits a decision
```

A row is written when the message is enqueued, together with the message itself. The rows make it possible to find the message of a proposal when the proposal is decided, and to find the proposals shown by a delivered packet, including those that expire (`INV-104`). The fate is written to its own row, so two fates recorded at the same time do not overwrite each other. Membership and fates are rows, not the content of `payload` (`INV-083`).

#### `pending_actions`

```text
id
discussion_id?
notion_page_id          the page the action changes: an action acts on one object
proposed_by_run_id?     the run that made the proposal: its run trace carries the proposal's
                        evidence. Empty when the author is not recorded
fingerprint
effects                 what will change, exactly: the page, the property and the canonical
                        value; every effect must have a precondition that will see it
preconditions
status
last_error?             why the action ended as it did: otherwise four different reasons would
                        end up in a single `failed`, `conflict` has no `detail`, and whoever
                        looks at the row cannot see what happened. Not returned to the model,
                        which reads the fresh state again (`INV-030`)
next_attempt_at?        there is no point in trying before this time: Notion is unreachable
                        or answers with a rate limit. The column is not about once-only
                        execution, which the monotonic status and revalidation enforce.
                        It is about order, without which one slow action starves all the
                        others
published_status?       the last fate already published to the thread and to the message
                        (ADR 0043): publication waits until `published_status` equals `status`
approved_at?            when the person approved: the limit on Notion's temporary
                        unavailability is measured from it (ADR 0044)
access_failures         the number of execution attempts in which Notion denied access to the
                        page (ADR 0044)
failure?                why the approved change was not written (only in `failed`): no access,
                        Notion did not respond for longer than the limit, or Notion did not accept
                        the write
recheck_requested_at?   the person changed the page where the proposal waits: the preconditions
                        need to be checked (ADR 0044)
created_at
resolved_at?
```

The effects are frozen when the proposal is made, and `status` says whether they are approved. `fingerprint` is the fingerprint of the effects, unique among the rows in non-terminal statuses: there cannot be two open proposals for the same change, since otherwise two runs about the same situation would produce two identical messages. The preconditions are not part of the fingerprint: the same change with a different check remains the same change. There is no expiry timestamp: the expiry is measured in reviews.

The statuses and the remaining rules are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `pending_action`.

#### `connector_credentials`

```text
connector              unique: 'notion_mcp'; 'gbrain' is reserved
client_id?             the public client of dynamic client registration; not a secret
access_token           encrypted at rest
access_token_expires_at
refresh_token?         encrypted at rest; client_credentials has none
scope?
obtained_at            when the person's authorization was obtained; the grant ceiling is counted from it
refreshed_at           when tokens were last issued; the inactivity limit is counted from it
updated_at
```

This table holds the “encrypted/secret technical state” named in [Security](#security). The encryption key comes from env and is not stored in the table.

The PKCE `code_verifier` is not part of this table: it lives exactly as long as one authorization lasts, and persisting it would mean keeping the secret of unfinished attempts on disk. An authorization interrupted by a restart starts over. Authorization is a manual operation that recurs once per grant ceiling ([Integration contract Notion](#integration-contract-notion)).

A refresh rotates the refresh token and revokes the earlier one, so there is a single refresher: the refresh runs under a row lock, and the new tokens are written in the same transaction. Whoever waited for the lock sees an already fresh token and does not refresh it. One gap remains, a failure between the provider's response and the write. In that case the grant is dead and the person is needed. That is why the App refreshes rarely ([Integration contract Notion](#integration-contract-notion)).

Re-authorization rewrites the row in full, including `obtained_at`: the ceiling is counted from the new authorization, not from the first. `gbrain` is reserved in the list: the App does not keep its `client_credentials` token in the table ([Integration contract GBrain](#integration-contract-gbrain)).

#### `oauth_clients`, `oauth_codes`, `oauth_tokens`

```text
oauth_clients
id
client_name
redirect_uris          redirect URIs, each from the allowlist
created_at

oauth_codes
code_hash              SHA-256 of the code; the code itself is not stored
client_id
redirect_uri           the exchange must name the same address
code_challenge         PKCE S256
resource               the audience of the token to be issued
expires_at
redeemed_at?           the code is single-use: the exchange sets this time with a conditional
                       update
created_at

oauth_tokens
id
family_id              the rotation family of the refresh token
client_id
resource               audience: the App MCP address the token was issued for
access_hash            unique
access_expires_at
refresh_hash           unique
refresh_expires_at
rotated_at?            this pair's refresh token has been used: the next pair has been issued in
                       its place
revoked_at?
created_at
```

These tables hold the technical state of chat authentication ([Authentication boundary](#authentication-boundary)), not domain memory. A secret is never stored in them: only SHA-256 digests of codes and tokens (`INV-310`). The code and token rows are tied to the client by a foreign key with a cascade: a client and what derives from it are one thing. `MaintenanceWorker` prunes expired codes, tokens that expired long ago or were revoked, and clients that have no live token.

#### Forbidden tables

`app_db` has no domain tables such as:

```text
tasks
projects
cases
knowledge
entities
embeddings
discussion_summaries
```

`INV-017` `app_db` has no domain tables.

### Implementation inventory

The logical records are `webhook_receipts`, `scheduled_checks`, `evaluation_windows` (which implements debounce and coalescing), `system_discussions` (the registry of discussions the system manages), `sweep_marks` and `discussion_reconciliations` (the memory of the sweep and of the resolved-thread reconciliation), `review_occurrences` (the occurrences of scheduled reviews), `notification_outbox`, `notification_proposals`, `pending_actions` and `connector_credentials`. The module that needs each one is named in the module map. Three more tables, `oauth_clients`, `oauth_codes` and `oauth_tokens`, hold the state of chat authentication and belong to `mcp/oauth/`.

The remaining six tables are the **run trace**. The MVP requires a structured execution trace, and the trace is technical runtime state. The makeup of its fields and the point from which each is required are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_trace_fields`. There are several tables because parts of the trace have different readers and are written at different times:

- **`run_traces` is the ledger.** The ledger has one row for every launched run, holding the mode, the execution surface, the trigger envelope (`trigger`) and the page the run is about (`page_id`, taken from the envelope; a review has no page), the origin, the budget class, the status, the App's latency, timestamps and, for each run that failed, was deferred or was abandoned, the reason (`reason`). Every admission reads the ledger (the plan quota, the daily limit, the circuit breaker, the slot), and so does the sweep, which asks whether a run about the page of a situation has reached a conclusion. The ledger holds nothing that these readers do not need. The envelope is read only whole, and runs about a page are looked up by `page_id` (`INV-083`).
- **`run_snapshots` is the run snapshot**, at most one per ledger row. It has three parts, each from its own point in the run:
  - **init**: the CLI version, the plugins, the digest of the run's plugin, the servers with their statuses, the set of tools;
  - **the result message** ([Run result](#run-result)): `model`, `num_turns`, `duration_ms`, `terminal_reason`. The model is the profile's model in canonical form if it actually worked (`INV-033`), otherwise `none`: that is how a run on an unavailable model ends, and an auxiliary CLI model that managed to make its utility call does not become the run's model;
  - **the result** that passed the App's schema.
- **The snapshot's lists** are rows, in the order in which the run reported them: `run_tool_calls` holds the tool calls from init (server, tool, success; there are no payloads, `GAP-07`); `run_policy_decisions` holds the denials of the SDK perimeter (from the result message) and of the App MCP (with the reason, likewise from init); `run_model_usage` holds tokens per model from the result message (`modelUsage`).
- **`run_applied_effects` holds the effects the App applied**, in the order of application, with the id of the row or Notion object that an effect created or touched. The applied effects are not the run's report but what the App did with the run's writes, so the list belongs to the ledger row, not to the snapshot.

A ledger row carries two more columns that are not in the list of trace fields and need not be: the **slot** and the **ticket expiry**. They are admission bookkeeping, not trace content. They are in the ledger, not in a separate table, because admission and the creation of the ledger row are one act. The property the slot enforces is stated separately, though: the row is never deleted, while exclusivity belongs to the slot and ends together with the expiry.

The runner returns the run's outcome (`RunOutcome`) through a port. The dispatcher writes it into the run trace, together with what happened to the App effects ([App MCP](#app-mcp)), in one transaction: the ledger status, the snapshot, the lists and the applied effects appear together or not at all. There are three outcomes: `completed`, `failed` and `deferred`. A deferred run either ran into the plan quota or did not reach Notion. In the first case the row carries `deferred_until`, before which no new runs start ([Observability and cost](#observability-and-cost)). In the second case the row carries the flag `notion_unavailable` and has no `deferred_until`, because what waits is the origin row, not the run gates ([Scheduler and outbox](#scheduler-and-outbox)). The failure of a person's snooze that did not reach Notion carries the same flag: the breaker does not count such failures.

`session_id` has no column of its own: it is the `id` of the ledger row ([Sessions](#sessions)), which is also the key of the snapshot. `required_when` in `run_trace_fields` states from which point each field is required, and it is the database, not the writer, that enforces it:

- the `CHECK`s of the table enforce what is visible within a single row: exactly the runs that failed, were deferred or were abandoned carry a reason (`run_traces_reason`); exactly the runs deferred because of the plan quota carry the reset time (`run_traces_deferred`), and only a deferred or failed run carries the flag `notion_unavailable` (`run_traces_notion_unavailable`); the result message's report is written whole or not at all (`run_snapshots_report`); a snapshot with none of its parts does not exist (`run_snapshots_recorded`);
- the rules across tables are enforced by a constraint trigger deferred to the end of the transaction: a `completed` run has a snapshot with init, the model and the result (`run_traces_completed`); only a run that has reached a conclusion has a snapshot and applied effects (`run_traces_reported`); there are no calls or denials without init, and no tokens without the model (`run_snapshots_init`, `run_snapshots_usage`).

Once the part that a list belongs to is recorded, the list is recorded whole: an empty one means “there was none”, not “unknown”. Calls and denials are recorded when there is an init; tokens when there is a model; applied effects when the run has reached a conclusion. The report of a run whose ticket was revoked is lost together with its status: an `abandoned` row says that the run did not report, and nothing but the ledger row remains of it.

`INV-079` The run trace — the `run_traces` ledger, the snapshot and the lists — is read and written only by `runs/`: the runner hands the run's outcome over through a port, and the dispatcher writes it into the trace.

The continuation, delivery and proposal queues each have a single entry point: its capability's service. The service checks a request against a schema that lets no extra fields through, and decides what cannot be entrusted to the caller: exempting a delivery from quiet hours, the right to name `user_snooze`, the right to decide on a proposal. It decides according to who is acting (`Actor`): an App run with an origin, the person in the chat, or the person who pressed a button in the channel. Two rules (whether the person asked for the step and whether the person speaks for themselves in it) are written once in `runs/` for all three kinds of actor, not in each capability. The queue store stays inside the module, so every producer (the App MCP, the channel intent router, scheduled reviews) passes the same checks. Apart from the service, the module exposes at most a run source: it places no rows, but moves the due ones into a run and prunes the concluded ones ([Scheduler and outbox](#scheduler-and-outbox)).

`INV-080` Capability modules — continuation, delivery, approval, attention, conversion — export a service and at most one run source: the queue and the store stay inside, so every entry into a capability passes its checks.

`INV-081` Only `notion/binding/` and `notion/semantics/` read the binding, and only `notion/client/property-id.ts` translates the shape of a property ID: the rest of the App sees canonical IDs and the description of the semantics, not the file format or the shape on the wire. `notion/workspace/` knows the format of the binding file in order to write it; the running App does not load this directory.

`INV-082` Queue leases — `locked_until` — are written and compared only in `platform/queue/`: the owner fence, the lease release and the transition timestamp are implemented there once, not in every disposition of every queue ([Scheduler and outbox](#scheduler-and-outbox)).

**When to use JSON.** A document whose shape the App does not define, and a structure that a reader consumes whole, are stored as JSON: split into columns, they would keep a shape the App does not own in the schema, or tear apart what is read together. Records that are counted, grouped and joined are stored as rows: JSON would hide their shape from the database, and every metric would parse it anew. That is why the tool calls, denials, tokens and effects of the trace are tables, not columns of the ledger.

`INV-083` A JSON column in `app_db` is only a document: a value whose shape the App does not define, or a nested structure that its single reader consumes whole. A set of same-type records that the App or its metrics count, filter or join consists of table rows. The documents are listed in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `json_documents`.

**Foreign keys exist only inside the owning module.** A snapshot refers to its ledger row, the lists refer to the snapshot or the ledger row, and deleting a row removes the rows that refer to it by cascade: this is one thing recorded in several tables. Between modules an id is an identity, not a relation, as in `pending_actions.proposed_by_run_id` and the row id in an applied effect: a key would tie the lifecycle of one module's row to a table that module does not see (`INV-079`).

Required indexes:

```sql
-- one active wake-up per attention thread ...
CREATE UNIQUE INDEX scheduled_checks_one_active_wake_per_discussion
  ON scheduled_checks (discussion_id)
  WHERE discussion_id IS NOT NULL AND status IN ('pending', 'running')
    AND reason_code <> 'resolution_reconciliation';

-- ... and one active closure of it
CREATE UNIQUE INDEX scheduled_checks_one_active_closure_per_discussion
  ON scheduled_checks (discussion_id)
  WHERE discussion_id IS NOT NULL AND status IN ('pending', 'running')
    AND reason_code = 'resolution_reconciliation';

-- ... and per (page, reason) where no thread exists yet
CREATE UNIQUE INDEX scheduled_checks_one_active_per_page_reason
  ON scheduled_checks (notion_page_id, reason_code)
  WHERE discussion_id IS NULL AND status IN ('pending', 'running');

-- one queued delivery per logical notification
CREATE UNIQUE INDEX notification_outbox_idempotency_key_key
  ON notification_outbox (idempotency_key);

-- one receipt per delivery of a source
CREATE UNIQUE INDEX webhook_receipts_source_external_id_key
  ON webhook_receipts (source, external_id);

-- one open debounce window per page
CREATE UNIQUE INDEX evaluation_windows_one_open_per_page
  ON evaluation_windows (page_id)
  WHERE status IN ('pending', 'running');

-- one open proposal per effects fingerprint
CREATE UNIQUE INDEX pending_actions_one_open_per_fingerprint
  ON pending_actions (fingerprint)
  WHERE status IN ('proposed', 'approved');

-- one running run per slot
CREATE UNIQUE INDEX run_traces_one_running_per_slot
  ON run_traces (slot)
  WHERE status = 'running';
```

The non-partial unique indexes are the schema's `@unique` and `@@unique`, and Prisma names them. Prisma does not describe partial indexes, `CHECK`s or triggers, so they are added to the migration by hand; the `CHECK`s and constraint triggers enforce the required trace fields named above. The consequence for the process is stated here because otherwise it gets lost: the schema is changed through `prisma migrate diff` and an edit of the migration file, not through `prisma migrate dev`, which does not know about these indexes and would remove them as drift. Both environments apply migrations through `migrate deploy`, which the App image runs first on every start. [`app/README.md`](../app/README.md#migrations) describes how a new migration is written.

There are three indexes on `scheduled_checks`. A thread has at most one wake and at most one closure: a closure is an obligation derived from state, not a point in time, so if it shared a place with wakes, it would compete with everyone who moves the row. The reason class (`resolution_reconciliation` against the rest) lives in `continuations/reason-class.ts` and in the predicates of these two indexes; an integration test over all pairs of reasons keeps both copies in agreement. The third index is for attention threads with no conversation: `discussion_id` names the thread where there is one. Where there has been no conversation yet (deadline follow-up, safety recheck), the pair `(page, reason_code)` takes its place. One index for both cases is not enough: in PostgreSQL NULLs are distinct, so an index on the thread does not constrain rows with no `discussion_id` at all, and the predicate `discussion_id IS NOT NULL` is written out so that this is visible rather than inferred.

Two different `reason_code` values on one page are not duplicates: `reason_code` goes into the prompt (`INV-020`), so merging two wakes into one row would make the surviving row misstate the reason. The `pending_actions` fingerprint, not this index, stops two nudge messages from the runs woken for the two reasons: an identical proposal from both yields one row. The division of work is the same as in the [delivery guarantee](#telegram--channel-adapter).

---

## Behavior under degradation — mechanisms

What stays true for the person under each kind of unavailability is defined by [`3-policy.md`](3-policy.md#behavior-under-degradation-and-failures). The mechanisms that guarantee it are:

- **Notion is unavailable.** An init whose only problem is that Notion does not respond (`failed`, `pending`) yields a deferral ([Runner MCP connections](#runner-mcp-connections)), and a run that did not reach Notion writes nothing: the App retries the same run, and the origin row waits out a pause ([Scheduler and outbox](#scheduler-and-outbox)). An approved change waits within the limits of its `pending_action` ([Preconditions and executor](#preconditions-and-executor)).
- **GBrain is unavailable.** The run continues without it, its tools drop out of the expected set in `init.tools`, and the run trace records the degradation ([Runner MCP connections](#runner-mcp-connections)).
- **The App MCP is unavailable.** For a run the App is a required server ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `mode_toolsets.required_servers`): a run without it is a technical failure, not a conclusion. In the chat Claude does not claim that a continuation, a delivery or a decision on a proposal has been recorded until the App has confirmed the call.
- **The runner or the model is unavailable.** Origin rows wait in their queues unchanged (`INV-084`), and the scheduler checks the run gates on every tick ([Run priority](#run-priority)).
- **The chat session has ended.** Whatever must outlive the conversation is already recorded in its system of record: Notion, GBrain or `app_db`.

Degradation at the representation level means that a canonical semantic has no carrier at all (`absent`) or its carrier does not allow the operation that the behavior requires. The absence of a native property is not degradation in itself: `relation`, `traversed`, `page_body` and `gbrain` are representation kinds of equal standing, as described in [Semantic adapter](#semantic-adapter); the canonical representation kinds are in [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `representation_kinds`.

---

## Security

### Public surface

```text
22/tcp
80/tcp
443/tcp
443/udp optional
```

Public application endpoints:

```text
https://api.example.com/webhooks/notion        intake of Notion events
https://api.example.com/webhooks/telegram      channel inbound
https://api.example.com/mcp                    App MCP
https://api.example.com/.well-known/oauth-protected-resource
https://api.example.com/.well-known/oauth-protected-resource/mcp
https://api.example.com/.well-known/oauth-authorization-server
https://api.example.com/oauth/register         the chat's authorization server
https://api.example.com/oauth/authorize
https://api.example.com/oauth/token
https://api.example.com/oauth/revoke
https://brain.example.com/mcp                  GBrain MCP endpoint
https://brain.example.com/authorize            the OAuth flow for it
https://brain.example.com/token
https://brain.example.com/register
https://brain.example.com/revoke
https://brain.example.com/.well-known/oauth-authorization-server
https://brain.example.com/.well-known/oauth-protected-resource
https://brain.example.com/.well-known/oauth-protected-resource/mcp
https://brain.example.com/health
https://brain.example.com/admin                operator UI
```

The declared GBrain surface is what Claude needs plus the operator UI. The rest of the service's routes stay outside it: the reverse proxy answers them with `404` and does not forward the request.

**The same rule applies to the App**, and it is written into the Caddyfile just as explicitly: `/health` is checked by the container itself and is not exposed to the internet. This way the App's declared surface matches the real one.

The App trusts **one** proxy hop, as GBrain does through `GBRAIN_HTTP_TRUST_PROXY`. Without that trust the throttler sees Caddy's address instead of the client's, every client in the world shares a single bucket, and when the bucket runs out, provider deliveries are cut off — that is, exactly the events the system exists for.

The App MCP has no host port of its own.

In production the direct host ports `3000`, `3131` and `5432` are absent.

### PostgreSQL

- no public `5432`;
- separate roles;
- no superuser for workloads;
- `PUBLIC CONNECT` revoked;
- `gbrain_user` has `BYPASSRLS`, which GBrain's RLS migrations require, and does not have `SUPERUSER`, `CREATEDB` or `CREATEROLE`; the attribute applies only within `gbrain_db`, the only database accessible to this role;
- the event trigger `auto_rls_on_create_table` is owned by `postgres` (`CREATE EVENT TRIGGER` is superuser-only); the function `auto_enable_rls()` is owned by `gbrain_user`, because GBrain's migrations run `ALTER FUNCTION` on it.

### Personal Management System Plugin

- The Plugin package is behavior and tool configuration, not a secret store: an App-triggered run reads any file in the plugin directory, so the plugin carries nothing that must not be read — neither secrets nor physical IDs;
- credentials are not committed to Plugin Skill source or reference files or `.mcp.json`;
- the root `CLAUDE.md` is not treated as a Plugin policy source;
- core behavior does not depend on hooks or sub-agents;
- the digest of the plugin that the run loaded is stored in its run trace: the run's Skill ships in the same release as the App.

### App — inbound perimeter

Throttling is a single global `APP_GUARD` with named `ThrottlerModule` profiles: every Nest route is counted in every profile it does not skip (`@SkipThrottle`), separately for each “route, client address” pair. Webhooks and `/mcp` skip the `default` profile and are counted only in `webhooks`: a limit sized for a person would reject a batch of provider redeliveries, and would cut a run that makes dozens of App MCP calls a minute off in the middle of its work. This limit does not restrain brute-forcing of a run's bearer token, and does not need to: its 256 random bits cannot be brute-forced. On the remaining routes both profiles count, and the lower one, `default`, sets the limit. The routes of the chat's authorization server have their own, lower limit within the `default` profile: thirty requests a minute. What restrains guessing of the owner passphrase, though, is not that limit but the lockout after failures (`OwnerLock`), which does not depend on the client address. A guard attached to the controller as well would count the same key twice, and the webhook limit would fall by half.

### App MCP — perimeter

- The App MCP is authenticated: by a run's bearer token or by a token issued by the App's own authorization server ([Authentication boundary](#authentication-boundary));
- the chat sees App tools only according to `chat_toolset`, and the owner passphrase, tokens and codes are not stored in `app_db` in the clear;
- the App MCP exposes runtime/control capabilities and a closed list of the system's intents in Notion and GBrain — what the system writes on its own behalf;
- the App MCP does not expose raw SQL;
- the App MCP does not proxy or rename the operations that the person performs through the Notion MCP and the GBrain MCP;
- an App MCP call never launches Claude recursively;
- pending approval contracts store changes in canonical terms — effects with values and preconditions — which are executed by a system write, not by an App-owned domain operation.

### Notion

- Notion is an external authoritative operational system, not a Personal Management System-hosted database.
- App REST credentials are scoped to the minimum workspace access needed by deterministic App operations and system writes; Notion attributes every system write to the integration bot, and the App checks this.
- Notion webhook requests go through authentication and validation in the App before event processing.
- The Notion MCP uses its own OAuth connection; App-triggered use requires OAuth Authorization Code + PKCE, token refresh and secure credential storage.
- A person's writes through the Notion MCP remain native Notion MCP operations; an App run only reads through the Notion MCP.
- Notion page and content data is treated as untrusted data, not as executable system instructions.

### Claude remote MCP

- App-triggered Claude receives only the bearer access tokens that the current MCP connections need, not long-lived client secrets. The App, not the SDK, performs Authorization Code + PKCE for Notion and client_credentials for GBrain.
- The runner reaches the Notion MCP over public HTTPS, the App MCP over the loopback of its own container, and GBrain over the Compose network ([Runner execution environment](#runner-execution-environment)); each connection is declared as `type: 'http'` with a per-server `Authorization` header.
- `strictMcpConfig: true` keeps the perimeter at the three declared servers: the project `.mcp.json`, user settings, plugin MCP servers and claude.ai connectors do not get into the run.
- The App configures MCP tools per server and per run and does not expose unnecessary writes.
- The core App-triggered integration relies on MCP tools, not on MCP prompts or resources.
- A failed MCP server connection throws no error: the status of each server is checked on the init message before the run's result is trusted.
- The run's MCP traffic goes directly from the App container to the three MCP hosts; model traffic goes to `api.anthropic.com`, under the usage limits of the subscription plan with which the runner is authenticated.

### GBrain

- The App's GBrain service credential has `read write` without `admin`;
- the App client secret is never passed to Claude;
- Claude receives a short-lived access token;
- direct Claude Chat and external clients use independent GBrain credentials;
- GBrain native writes remain GBrain MCP operations;
- `GBRAIN_HTTP_TRUST_PROXY=1` is used only for a single trusted Caddy hop;
- `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` is the permanent credential of the GBrain admin UI: it is used to issue sessions to `/admin`, and it lives in the container's environment for as long as the container runs.

### Secrets

Credentials are not stored in:

- Git;
- `gbrain-repo`;
- Plugin source;
- application source code;
- Docker images.

The App keeps long-lived connector refresh credentials in `connector_credentials`, encrypted with the key `APP_ENCRYPTION_KEY`, which is not in the database: this is secret technical state, not domain memory. There is one key and it has no version: changing the key means re-authorizing the connectors. The table holds at most one row per connector, and there are two connectors, so a keyring for an operation needed once every few years would cost more than the described procedure (`GAP-22`).

`APP_OAUTH_OWNER_PASSPHRASE` is a static secret, the only factor for consenting to a chat connection. It is protected by its length, the lockout after failures, the allowlist of redirect URIs, PKCE, a single-use short-lived code and a message about every consent; there is no second factor through the channel (`GAP-33`; [Authentication boundary](#authentication-boundary)).

`CLAUDE_CODE_OAUTH_TOKEN` does not get into the App image, is not passed to MCP servers and does not appear in the run trace; it is passed only through the `env` of the subprocess of a specific run ([Runner authentication](#runner-authentication)).

The names of the variables for the Notion REST credentials, the Notion MCP OAuth state, the GBrain client credentials, the App MCP auth configuration and the path to the plugin directory belong to the App configuration contract ([Configuration contract App](#configuration-contract-app)).
