# ADR 0041 — The gate works in a separate environment

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D41` |
| **Related** | ADR 0013 · ADR 0017 · ADR 0048 · `INV-093` |

## Context

The gate is the App's acceptance test: it starts real runs on real connectors over a scenario world and gives a verdict. The gate builds a scenario's world with system writes in the databases of the binding, and an event on a page of the world wakes a run.

Scheduled reviews, the periodic safety sweep and the reconciliation of resolved threads read whole databases. In the main workspace, a gate review would see the owner's backlog next to the world and comment on real Tasks, and the sweep and the reconciliation would wake real pages and threads. Main workers that shared a database with the gate would see its rows: delivery would carry its messages into the real channel, and the scheduler would take its windows. A gate built into the main image would deploy into the main App the code it tests.

The gate takes a long time, sometimes waits for a person to resolve a thread in Notion, and when stopped midway it must clean up after itself.

## Decision

**The gate is a test, not App code, and runs in a separate environment where every dependency is its own.**

- **Code.** The gate lives with the tests (`app/test/gate/`): it imports the App from `src/`, and the App imports nothing from the tests. The main App image does not contain the gate; the `gate` target of the same Dockerfile is the main image plus the compiled gate, because the gate needs the same environment: the Claude CLI, the plugin, the App's dependencies, the contracts.
- **Environment.** Its own database in the same Postgres installation (`app_db_gate`), its own Notion workspace with its own integration and binding, its own Notion MCP grant (in the gate database), its own GBrain source and client. The `gate` service in Compose sets these values from the secrets in `infra/.env.gate`. The gate environment has no token for the main Notion workspace; the service takes the main binding file from the main environment and reads only its `workspace` key. The gate's entry point refuses to start outside the gate environment: the database is not `app_db_gate`, the binding is not the gate's, or there is no integration token or GBrain client.
- **Launch.** `infra/bin/gate` builds the gate image, creates and migrates the gate database, checks the gate workspace and launches the gate in a one-off container. The main App is not stopped and keeps its image; deployment is a separate step. A lock keeps two gates from running at the same time: they would share the gate database and workspace. The gate starts its own App instance on loopback with the workers off and the runner on: it drives the runs and the ticks itself (ADR 0013).
- **The preparation builds the gate workspace** (`bin/gate prepare`) with the engine and the contract `contracts/notion-workspace.yaml` that are in the gate image (ADR 0048), together with the gate overlay, and writes the gate binding with the id of the gate workspace. The preparation builds no rows: the reference databases stay empty, and the gate builds the worlds. The personal token of the gate workspace only builds databases: Notion attributes a comment made with it to a person, so the App in the gate works on an internal integration, as it does in the main environment. The preparation recognizes from the `workspace` key of the main binding that the gate integration does not belong to the main workspace; without that file the check is skipped, and the preparation says so in the log.
- **Formulas are mandatory in the gate.** Formula columns and their entry follow the rule of ADR 0048; the preparation writes the text to enter into `infra/gate/formulas.md`, and the gate does not start until every formula of the contract has been entered.
- **The overlay is the only deliberate difference between the gate workspace and the contract.** An Inbox item is judged stale by `captured_at`, and the contract takes that from the page's creation time, which the API does not set: the gate could not build an item “days old” except by waiting. So the gate's Inbox database has its own date for the time of capture, and `captured_at` of the gate binding points to it. It is an ordinary date: Notion SQL reads it just as it reads the creation time, so the model asks for the time of capture with the same query (a formula would not do here, because Notion SQL does not read formulas). The gate marks every Inbox item it builds with this date: a world item with the time it is built, a seeded item with a time past the staleness limit, so a seeded item is stale immediately. An item that the App itself creates (capture from the channel) stays without a time of capture: the gate knows nothing about its creation, and the gate's claims about capture do not read this date. The name and description of the date are neutral, like those of a workspace field: the model sees in it the time of capture that the binding points to, not a gate crutch that could be sidestepped by using the creation time. The App and the Skill know nothing about the overlay: both read the property that the binding names.
- **Check.** Before every gate run, the wrapper runs the check (`prepare --check`): it checks the schema, the formulas and the binding of the gate workspace against the contract together with the overlay and, on a mismatch, refuses, naming what differs and advising a rerun of the preparation.
- **Connector credentials are the gate's.** The workspace of a Notion MCP grant is chosen by the person on the Notion consent page, and the sources of a GBrain client by the command that registers it; nothing else constrains them. So the same check asks the servers themselves: the Notion MCP, whose workspace this is; GBrain, where the client writes and what it reads. The gate does not start with a grant that is not for the gate workspace, or with a client that sees more than the gate source.
- **The Telegram channel is the gate's own listener.** The Bot API that the App sends messages to is a gate server on loopback in the same container (`app/test/gate/bot-api.ts`): it answers as the Bot API, records the sent and the rewritten messages and the answers to button presses, and rejects a call with any other method, chat or token; the verdict of every gate names such calls (`telegram.violations`). The bot token, the webhook secret and the chat of the gate's App are disposable and dummy: the gate's App does not receive the real token and sends nothing to the real Telegram. The outgoing side of the channel — delivery with buttons, rewriting with proposal fates, the answer to a button press — becomes visible, the same for every gate. The gate feeds the button presses and the person's replies to the App's own webhook.
- **One file sets the environment of the gate's own App instance** — `app/test/gate/gate-boot.ts`: the workers switched off, the runner, the port, the Telegram channel on loopback and the review schedule, the same for every gate. It has only light imports, because everything that pulls in `AppModule` reads the environment at import time.
- **The gate summons the person with a line on stderr.** When a scenario waits for a person, the gate writes to stderr a line that begins with `GATE_NEEDS_PERSON`, and when the step is done or the time has run out, one that begins with `GATE_PERSON_DONE`; between the two lines the wrapper on the host announces aloud every minute and at the end names the exit code. The markers live in `app/test/gate/gate-signals.ts` and, literally, in `infra/bin/gate` as well; a contract test that launches the real wrapper on stubs enforces that they match. The host's sound does not reach the container, and stdout carries the verdict, so the gate has no other channel to the operator.
- **The gate owns the signals itself.** The gate catches SIGINT, SIGTERM and SIGHUP (`AbortGuard`): it runs the cleanup, closes the application, writes to stdout a stub verdict with `aborted` and exits with the code `128 + signal`. `enableShutdownHooks()` belongs to the lifecycle of the main process, not to the HTTP perimeter: `main.ts` enables it, and the shared `configureApp` does not. Otherwise Nest would destroy the application on a signal and pass the signal on to the process, the gate's `finally` blocks would not run, and the pages would stay in the gate workspace. The wrapper turns the operator's second signal into an immediate stop without cleanup.

**Rejected:**

- **The gate in the main workspace.** Reviews, the sweep and the reconciliation read whole databases: the world would mix with real rows, and the runs' comments would stay on real pages.
- **Separate gate databases inside the main workspace.** A Notion MCP grant covers the whole workspace: in a review the model would find and read real pages.
- **A database and a container shared with the main process.** The main workers would see the gate's rows, and stopping them for the duration of the gate would mean stopping the main system.
- **A gate schema taken from the live main workspace.** It requires the main integration's token in the gate container and ties the gate to a workspace it must not touch.
- **A personal token for the App in the gate.** Notion attributes a comment made with it to a person, and the system would take its own comments for the person's words (ADR 0017).
- **A real bot and a person pressing buttons.** The gate would write to the real Telegram, and every press would wait for a person — an acceptance run has dozens of them; there is no step here that the API cannot perform: a press is an update, and the gate supplies it itself.

## Consequences

- `INV-093` has one App entry point that reads the environment before the settings, `app.module.ts`; the environment of the gate's own App instance is set by the gate's entry point, which is a test.
- A change to the schema contract reaches the gate workspace by running the preparation again; the gate does not start unless they match.
- The gate's Notion MCP grant is refreshed by gate runs; after thirty days without runs it needs a new authorization.
- The verdict goes to stdout and everything else to stderr. The exit code is the gate's; the wrapper's own codes are 2 for an invalid invocation, 5 for another gate already running, 6 for a gate environment that is not ready.

## Cost

- One-time setup by the project maintainer: the workspace, the integration with its permissions, the personal token, the integration's access to the built databases, the entry of formulas, the Notion MCP grant, the GBrain source and client.
- A new or changed formula of the contract needs to be entered in the gate workspace; until then the gate does not start.
- There is one Claude plan quota for both environments.
- In the gate the model sees a workspace without the owner's records: behavior that would rely on them is not reproduced in the gate.
- A gate stopped without cleanup leaves what it built in the gate workspace; it is found by the attempt tag.
