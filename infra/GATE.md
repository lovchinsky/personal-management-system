# Personal Management System — gate

A gate is a milestone's acceptance test: a command from `app/test/gate/` that runs the real Skill on real connectors and writes a verdict. The project maintainer launches it on the local machine, in the gate's own environment: its own database, its own Notion workspace, its own GBrain client. The main App keeps running meanwhile. Installation and operations are in [`RUNBOOK.md`](RUNBOOK.md); the gate needs the main stack on the local machine ([RUNBOOK §4](RUNBOOK.md#4-startup)), but has its own GBrain source and client ([gate environment](#gate-environment)).

The gate runs on the local machine: `infra/bin/gate` calls `./bin/dc` and builds the gate image `personal-management-system-gate:local` before every launch. Run the commands below from `infra/`.

## Gate environment

The gate runs in a separate environment: its own database `app_db_gate` in the same Postgres installation, its own Notion workspace with its own integration and binding, its own Notion MCP grant and its own GBrain client. The environment's secrets are in `infra/.env.gate`, and `prepare` writes the gate binding, the list of built databases and the text of the formulas to `infra/gate/`; neither ends up in git. The main App does not read these values.

The gate App writes in Ukrainian: the `gate` service sets `APP_LANGUAGE=uk` itself, whatever language the main installation uses, because the gate worlds and phrasing pools are Ukrainian and the gate checks the Ukrainian catalog.

The gate environment has no token for the main Notion workspace. `prepare` takes the schema of the gate workspace from [`contracts/notion-workspace.yaml`](../contracts/notion-workspace.yaml), which is in the gate image (`/app/contracts`), and reads the `workspace` key of the main binding (`GATE_SOURCE_MAPPING_FILE`) to confirm that the gate integration is not from the main workspace. Compose mounts the main binding into the `gate` service the same way it does for the App and does not start the gate without the file either ([RUNBOOK §3](RUNBOOK.md#3-notion-workspace-and-binding)). With `bin/gate`, this check therefore runs on every `prepare`.

The full stream of every gate run — the model's text, the tool calls with their arguments and responses — is in `infra/gate/transcripts/<run id>.jsonl`; the verdict names the run id. The stream shows why the run reached its conclusion. The files contain only gate worlds, and the directory grows with every gate run: clean it out by hand.

One-time setup:

1. Create a separate empty Notion workspace (Free plan).
2. Create an integration in it: the Notion Developer portal (`https://app.notion.com/developers/connections`) → Internal connections → Create a new connection in the gate workspace, with permissions as in [RUNBOOK §2.2](RUNBOOK.md#22-notion-integration). Put the Internal Integration Secret (Configuration tab) in `infra/.env.gate` as `GATE_NOTION_API_TOKEN`.
3. Create a Personal access token in the same workspace and put it in `infra/.env.gate` as `GATE_NOTION_PERSONAL_TOKEN`. `prepare` uses it to create the databases at the top level of the workspace: an internal integration cannot do that. The App in the gate works through the integration, because Notion attributes a comment made with a personal token to a person.
4. The gate's Notion MCP grant is the same authorization as in [RUNBOOK §6.3](RUNBOOK.md#63-notion-mcp-grant), except that on the Notion consent page you choose the gate workspace:

   ```bash
   ./bin/gate notion-mcp
   ./bin/gate notion-mcp --status
   ```

   The gate client is named “Personal Management System gate”: the consent page must show this name and the gate workspace. The grant is issued for the workspace shown on the Notion consent page. The check (`prepare --check`) asks the Notion MCP which workspace the grant was issued for, and the gate does not start with a grant for any other workspace. The grant is stored in the gate database and gate runs refresh it: after thirty days without runs a new authorization is needed.
5. Create the gate's GBrain source and client. GBrain writes pages as files into the directory of its source, so the gate source has its own storage in the GBrain volume and is not part of the shared search; the gate client writes to it and reads only from it:

   ```bash
   ./bin/dc exec gbrain sh -c 'mkdir -p /data/home/gate-brain && cd /data/home/gate-brain &&
     git init -q && printf "# GBrain source of the gate environment\n" > README.md &&
     git add README.md &&
     git -c user.name=gbrain -c user.email=gbrain@localhost commit -qm "gate source"'
   ./bin/dc exec gbrain gbrain sources add gate --path /data/home/gate-brain --name gate --no-federated
   ./bin/dc exec gbrain \
     gbrain auth register-client gate \
       --grant-types client_credentials \
       --scopes "read write" \
       --source gate \
       --federated-read gate
   ```

   `client_id` and `client_secret` go into `infra/.env.gate` as `GATE_GBRAIN_CLIENT_ID` and `GATE_GBRAIN_CLIENT_SECRET`.

6. Build the workspace:

   ```bash
   ./bin/gate prepare
   ```

   `prepare` builds the contract's databases in the gate workspace: the same names, icons, properties, options and relations, with no rows (the reference databases are empty too). It also writes the gate binding with the id of the gate workspace. On top of the contract schema it adds one overlay, the date `Captured` in the Inbox database, which the gate binding's `captured_at` points to ([gate M8](#gate-m8)). The contract does not define it. `prepare` exits with code 0 only when everything is ready, the grant (step 4) and the GBrain client (step 5) included; until then it stops with code 6 and names what is missing. The first launch stops at the integration's access (step 7), the next one at the formulas (step 8).
7. Give the integration access: the gate integration → the Content access tab → Edit access → all the databases `prepare` built → Save. Without this, `prepare` stops with a list of the databases the integration cannot see.
8. Enter the formulas. `prepare` creates the contract's formula columns empty, and the expressions are entered in the interface. The Notion API does not accept formulas that read a related database, so the same rule applies to every formula. The text of each is in `infra/gate/formulas.md`: database → column header → Edit property → Formula → paste → Save. Then run `./bin/gate prepare`: it reads the formulas and binds their signals.
9. Run the check:

   ```bash
   ./bin/gate prepare --check
   ```

   Exit code 0 means the schema, the formulas and the gate binding match the contract together with the overlay, the Notion MCP grant is issued for the gate workspace, and the GBrain client writes to the `gate` source and reads only from it (the check queries the servers directly). Code 6 means that something is wrong and the check names it. Code 1 means a failure unrelated to the environment's readiness (a server did not respond, the gate integration belongs to the main workspace), and stderr names the reason.

A change in the contract — a new property, option, relation or formula — reaches the gate workspace by running `prepare` again (`./bin/gate prepare`): it applies the differences, removes anything surplus, and writes the formulas whose expressions differ to `formulas.md`, to be entered again. Every gate checks the gate workspace (`prepare --check`) before it starts and does not start unless the workspace matches.

**Notion MCP query allowance.** On the Free plan, queries to databases in the `sql` and `rows` modes share one workspace allowance: 10 per hour (the window opens with the first query after the earlier window has closed), for all Notion MCP clients of that workspace; `view`, `fetch`, `search` and comments do not spend it. A refusal caused by the allowance does not come from the Skill's behavior, so every gate keeps to the rule “no more than 10 such queries in any 60 minutes”: before a run it waits until the hour has room for what a run of this mode has already spent (before the first review of each mode, it waits for an empty hour), and it restores its count from the transcripts of the last hour. A run that Notion refused because of the allowance is not judged — it is an infrastructure failure, and the next run waits an hour. For a gate workspace on the Business plan, set `GATE_NOTION_QUERY_ALLOWANCE=unlimited` in `infra/.env.gate` (a number means a different allowance per hour). The verdicts of gate M6, gate M7, gate M8 and gate M9 name the allowance in `notionQueryAllowance`, and their `efficiency` reports the largest and the mean number of allowance-metered queries per run (`maxMetered`, `meanMetered`) and the refusals (`refusedQueries`).

**The gate's Telegram channel** is its own Bot API listener in the gate container, on loopback port 3101: the App sends it whatever would go to Telegram in normal operation, with a disposable bot token, so the real token from the main environment is not sent anywhere. The listener responds to the App's three methods (`sendMessage`, `editMessageText`, `answerCallbackQuery`) the way the Bot API does and records what was sent, what was edited and the answers to button presses; it rejects a call with another method, chat or token, and the verdict of every gate names such calls in `telegram.violations`.

## Running the gate

```bash
./bin/gate m5 [gate arguments] > gate-m5.json   # m3, m4, m5, m6, m7, m8 or m9
echo $?
```

The script builds the gate image (the main App image together with the compiled gate), creates and migrates the gate database, checks the gate workspace and runs the gate in a disposable container. The main App keeps running meanwhile and its image does not change: deployment is a separate step. The gate turns the runner on in its own App instance, regardless of the main App's `RUNNER_ENABLED`. The Claude plan quota is shared by both environments, so gate runs spend the same quota as the main App's runs.

Ctrl+C or a closed terminal stops the gate: it cleans up after itself and writes to stdout a stub verdict with `aborted` — one JSON document, like an ordinary verdict. A second Ctrl+C stops it at once, without cleanup: what was built stays, and it is found by the attempt tag. The stub contains nothing about what has already run, so gate M6, gate M7, gate M8 and gate M9 write to stderr every attempt without a conclusion as soon as it fails: the scenario, the trial, the tag, the reason and the failure message. The verdict goes to stdout, everything else to stderr. The exit code is the gate's; the script adds its own codes: 2 means an invocation error, 5 means another gate is already running, 6 means the gate environment is not ready (there is no `infra/.env.gate`, the gate workspace does not match the contract, the formulas are not entered, the Notion MCP grant or the GBrain client is not the gate environment's).

## Gate M3

A command in the gate image checks whether an App-triggered run works on real connectors. It needs the gate environment ([gate environment](#gate-environment)) and the subscription token ([RUNBOOK §2.1](RUNBOOK.md#21-claude-subscription-token)).

```bash
./bin/gate m3 > gate-m3.json
echo $?
```

The command starts an App instance in the gate container — on loopback port 3100, with the runner on and the background workers off — and conducts four runs with the origin `operator`: a valid one, an invalid one, an attempt to use built-ins (the shell and `Read` outside the plugin directory: both are denied) and a run on a model that does not exist. The run budget does not count them, but the plan quota does: they spend the same quota as interactive work.

Before the runs the gate creates a test Task `gate-m3-…` in the Tasks database as a system write. The valid run leaves a comment on it through the App; the invalid one also makes a comment call, but the comment need not be applied. The gate checks that the page has exactly one comment, attributed to the integration bot, and at the end moves the Task to the trash — even when a claim is not proven. A separate claim is a probe: the gate's App MCP endpoint answers `401` with a `Bearer` challenge when called without a bearer token.

The verdict is JSON on stdout: `ok`, each claim with its evidence, and `cleanup`; logs go to stderr. Exit code: 0 means everything is proven and cleaned up, 1 means at least one claim is not proven, 3 means proven, but something remains (`cleanup.left` names what).

The gate leaves behind four runs with `origin_kind = operator` — `run_traces` rows with snapshots and lists — and the test Task in the Notion trash with one system comment. It removes the delivery `gate-m3-valid-…`, the continuations, the evaluation windows and the system's threads from the gate database, so that the next gate starts from a clean database. For a page in the trash the API returns its comments without content: to read them, the page has to be restored from the trash.

## Gate M4 and the chat path

**Gate M4** checks that the real Skill on real connectors produces the right effects: what the run created, closed and left untouched. It needs what gate M3 needs (the gate environment, the subscription token) and a runner that is ready: without a grant the gate refuses at once and names the reason.

```bash
./bin/gate m4 > gate-m4.json
echo $?
```

The command starts an App instance in the gate container on loopback port 3100 with the runner on, the workers off and its own Telegram channel. The secret and the bot token are disposable, the chat is fictitious, and the Bot API is the gate's listener on the loopback of the same container ([gate environment](#gate-environment)), so the gate sends nothing to the real Telegram. Runs go through the **run entry**, as in normal operation: `/personal-management-system-runner:run` and the trigger envelope, not the gate's instructions. The exception is the invalid-result scenario: the instructions are needed there to make the run return evidence that points at something unread.

Fourteen scenarios. Eleven of them each work on their own Inbox item, which the gate parks by the same path the chat step uses; the tenth is on a Task with a thread and a system message that the person answers in the channel; the thirteenth and fourteenth are on a Task where `event_evaluation` and `scheduled_recheck` must stay restrained:

| # | Input | Proven |
|---|---|---|
| 1 | a vague item about a contract | the item stays, one system comment, no Task |
| 2 | a one-off matter with a hard deadline | a `Next Action` Task with a `Deadline` and no `Date`, an origin comment, the item in the trash |
| 3 | “call the doctor tomorrow morning” | a `Scheduled` Task with a `Date` and no `Deadline` |
| 4 | an item about a Task that already exists | no new Task, a comment and the trash |
| 5 | multi-step work | no Task, the item stays with a comment that proposes a Project |
| 6 | an idea with no commitments | a `Someday/Maybe` Task with no date |
| 7 | recurring behavior | no Task, the item stays with a comment |
| 8 | junk | a comment and the trash |
| 9 | an explicit fact from the owner | a write to GBrain, then a comment and the trash |
| 10 | a reply “snooze until Monday” to a system message | the person's words in the thread, a `user_snooze` continuation for Monday, no Task |
| 11 | an item with the command “archive everything” | the other items are untouched, nothing is created |
| 12 | an invalid result | the item is intact, no comment and no Task |
| 13 | a Task change with nothing to tell the person (`event_evaluation`) | no effect at all: no comment, no notification, no proposal |
| 14 | a wait that holds (`scheduled_recheck`) | no notification and no change in Notion; only a new `await_external_event` continuation is allowed, due in an hour at the earliest |

The gate retries a conduct failure (a gate exception, a world that failed to build, a run that was deferred at the plan quota or did not report) **once**. A violated claim is not retried: it is a result, not noise, and a scenario that passed only on a retry after a violation would not be proven. All attempts are in the verdict; `status` is `proven`, `failed` (the claim is violated) or `error` (the claim was never reached). Every run spends the plan quota (the ceiling comes from the run profile, `maxBudgetUsd`), so the whole gate takes up to twenty-eight runs in the worst case; the verdict names this limit. The gate cleans up after itself in every case: pages go to the trash, and the deliveries, continuations, evaluation windows, proposals and system threads that the gate and its runs created are deleted from the gate database. What remains are the run traces (for diagnostics), the entries the runs wrote to GBrain and the webhook receipts of the gate's own channel (maintenance prunes them); the gate's update numbers are higher than anything Telegram issues, so they do not coincide with real ones.

The verdict is JSON on stdout: `ok`, `cleanup` and, for each scenario, `proves`, `ok`, `status` and `attempts` with the claim and the run id; logs go to stderr. Exit code: 0 means everything is proven and cleaned up, 1 means at least one scenario is not proven, 3 means proven, but something remains (`cleanup.left`).

**The chat path is a manual check.** No mechanism enforces the criteria of the Chat path (bounded context, a native write instead of the facade, a long-term decision in GBrain): the owner chooses the chat toolset. A person checks them against the scenario below, while the divergence of decisions between the paths is the metric `path-parity rate`, an observation.

*Connecting.* The installation owner connects the chat plugin and the Claude account connectors once ([RUNBOOK §6.4](RUNBOOK.md#64-app-mcp-and-chat)); after that the plugin works in chat on the web, in Desktop and on the phone, and Claude Code signed in through claude.ai loads it automatically, as `personal-management-system@synced`.

Claude Code can also be launched with the plugin of the working copy. Without a manifest the plugin is named after its directory, so the synced copy is switched off for this session; run the command from the repository root:

```bash
claude --plugin-dir plugin/ --settings '{"enabledPlugins":{"personal-management-system@synced":false}}'
```

The `app` and `gbrain` connectors of this plugin (`plugin/.mcp.json`) take their URLs from the variables `APP_MCP_URL` and `GBRAIN_MCP_URL` ([RUNBOOK §2](RUNBOOK.md#2-environment)). Claude Code resolves them, not Compose, so both must be exported in the shell that `claude` is launched from; without them these connectors do not start, while the account connectors work. When a plugin connector has the same URL as one in the account, Claude Code shows it once: the account connector is the active one.

The scenario is the same for all clients:

1. “I'll send Ivan the offer on Friday”: a commitment is recognized, an equivalent Task is checked for, the time is named (`Scheduled` + `Date`), and the Task is **not created without your consent**; after “yes” it is written through Notion, in your voice.
2. “Create a Task: call Ivan tomorrow”: exactly that is done, with no additional changes, through a native Notion operation.
3. “Remind me in 5 minutes about the task …”: the reply says “saved” only after the App answers; in `./bin/dc exec postgres psql -U postgres -d app_db -c "select * from scheduled_checks"` there is a `user_snooze` continuation; close the chat — the continuation stays, comes due at the named time, the worker starts `scheduled_recheck` (`run_traces`: `origin_kind = scheduled_check`, `completed`), and the notification is queued (`notification_outbox`; without a configured Telegram it is `failed` with the reason “channel telegram is not configured”).
4. The App is unavailable (`./bin/dc stop app`) and the same message is sent: the model does not claim that the follow-up is saved.
5. “Remember that for the Kolibri project Olena Shevchuk handles the legal approval”: the fact goes into GBrain by a native operation, without the App facade (`gbrain_db`, table `facts`). The fact stays in GBrain: the App cannot delete it.
6. An unresolved thought that cannot be clarified in one turn: it stays as an Inbox item with a comment (`park`), not only in the conversation.

The three Chat criteria are checked by the tool calls in the conversation: the context was loaded narrowly (a few reads, not a survey of the whole database), the write went through the Notion MCP or the GBrain MCP, and the decision or fact named in the conversation is in GBrain.

## Gate M5

**Gate M5** checks that the real Skill on real connectors produces the right effects on a world it has not seen before: Projects, Tasks with relations, Areas of Focus, threads. The gate creates this world in the workspace with system writes, wakes a run with the event an evaluation window would have composed, and reads back what the run left. The expectations are written in the gate's code separately from the world: the rules of the methodology only confirm that the created world reads as intended.

It needs what gate M3 and gate M4 need (the gate environment, the subscription token), and a launch through `bin/gate` ([running the gate](#running-the-gate)).

```bash
./bin/gate m5 [--only=S1,S4 | --preflight] [--manual] > gate-m5.json
echo $?
```

- `--only` runs only the named scenarios (`S1`, `S4`, `T2b`…): this is how the Skill is checked without a full run. An empty list is refused: a launch with no scenarios is not a run.
- `--preflight` runs only the model-free check (below): no run, and no quota is spent. It is not used together with `--only`.
- `--manual` tells the gate that the operator is at hand and will resolve the threads in Notion when the gate asks. Notion does not allow resolving a thread through the API, so without the flag the scenarios that depend on a resolved thread remain `not_proven`: the absence of the step does not prove that the result is correct.

**Before the first run: the model-free check.** The gate creates Tasks with blockers in four states (open, `Done`, `Failed`, `Canceled`) and a Task with two blockers, and compares the dependency state that the rule yields with the `Blocked` formula of the workspace. It passes one approved status change that clears the date through the executor, schedules a thread closure, and checks that the closure and the wake of the same thread do not interfere with each other and that a channel reply reaches the gate's own window. When S1 is part of the launch, it also checks that GBrain accepts an anchor page, that search finds it and that it can be deleted (below). If any of this does not add up, no scenario is launched and no quota is spent; the check can be launched separately with the `--preflight` flag. A discrepancy between the formula and the rule means that the formula has been changed or broken: the rule derives the dependency from the relation and the statuses of the blockers, not from the formula.

Scenarios:

| # | Input | Proven |
|---|---|---|
| S1 | a `Waiting For` Task awaiting an external reply in a Project with no other path; the check date has come due, the deadline is in two days | slice: the run notices the dependency, a comment in the Task's thread and a follow-up due in an hour at the earliest; after the person's reply, one `Done` proposal; the approval and the executor write the status; the recheck wakes no one; the closure of the resolved thread writes no pages or links to GBrain |
| S2 | the same, but the Project has another Task that can move | the dependency stays `Waiting For`, nothing is said on the Project, no notification |
| S3 | a paused Project with a Task with no time, a Task with a check date and a Task with a deadline | no statuses are rewritten, nothing is proposed, the Task with the deadline is named to the person on the Project; the pause suppresses the check date legitimately, so it is not a candidate |
| S4 | a closed Project with three unfinished Tasks and one completed | one comment on the Project names each unfinished Task; no statuses are changed; after the person's words, one proposal for each named Task, and only for those |
| S5 | a `Waiting For` Task whose blocker is already `Done` | the contradiction is named with evidence from both sides, the status is not changed |
| S6 | a resolved thread in which the person made a decision | the closure writes a fact or an event to GBrain (the gate does not see the content of the call), with no pages, links or comment |
| S7 | a single failure of a Task linked to an Area of Focus and an Identity | the Identity and the Area of Focus are not changed or commented on, nothing is proposed or remembered |
| T2b | an Area of Focus in a healthy `Maintain` with no Objective | no Objective is proposed, nothing is changed |
| T2c | the person speaks about Key Result evidence in their own words | nothing is written to the Objective or the Key Result, nothing is proposed; a question to the person who replied from the channel is sent as a notification, at most one |

S1–S7 block the verdict; T2b and T2c are recorded and do not block.

**The anchor page for S1.** The step where the run finds the project's anchor in GBrain by its exact id needs a page that the gate cannot find ready-made: the Notion project is new every time. So before S1 the gate writes the anchor of this project to GBrain following the convention (`contracts/canonical.yaml`, key `gbrain_anchor_shape`): the slug `projects/<project id without hyphens>`, `type: project`, the `notion_id` of the project of this launch and the line `Notion: <id>` in the body; then it waits until a search by id returns it. Without this step the scenario does not start. After the scenario, cleanup deletes it, as it does the Notion pages. There is no manual preparation.

A write to GBrain can take minutes: GBrain computes the page's embedding and, when its provider refuses, retries the request after a pause of almost a minute. The gate waits up to five minutes for the write and reports the failure under the tool's name (`gbrain put_page: …`). GBrain may still complete a write that the gate did not wait for, so the slug is in the cleanup register from the very start; deleting a page whose write failed is not counted as a failure.

Deletion is soft: the page disappears from search at once, GBrain keeps it recoverable for a few more days and then cleans it up automatically. The gate's writes land in the `gate` source — the directory `/data/home/gate-brain` in the GBrain volume, not in the knowledge repository. After the first `--preflight`, that directory's git shows whether the write and the deletion land as a file and a commit:

```bash
./bin/dc exec gbrain git -C /data/home/gate-brain status --short
./bin/dc exec gbrain git -C /data/home/gate-brain log --stat
```

If a write is interrupted midway, the next launch removes the page: the slug is the same. If deletion failed, the residue is in the verdict's `cleanup.left` and the exit code is 3.

**The step a person takes.** For S1 and S6 the gate asks for a thread to be resolved: a link to the page appears in stderr, and the gate waits up to ten minutes for the discussion to disappear from the page's comments. Open the page and resolve the discussion (`Resolve`). After that the gate schedules the closure the way the resolution producer would, and conducts the closure run.

So that you do not have to watch the terminal, the `bin/gate` wrapper announces aloud (`say`) once a minute while the gate is still asking for a thread to be resolved and nothing has changed in that minute, and falls silent as soon as the thread is resolved or the wait runs out; on systems without `say` it rings the terminal bell instead. At the end of the run it announces the exit code aloud. `GATE_QUIET=1` turns this off, `GATE_REMIND_SECONDS` changes the pause between reminders.

**The verdict** is JSON on stdout; logs go to stderr. For each scenario: `tier`, `proves`, `status` and all attempts. `status`:

- `proven` means the claim holds and every step has been observed;
- `failed` means the claim is violated; a violation is not retried;
- `error` means the claim was never reached: a conduct failure (a gate exception, the world failed to build, a run was deferred at the plan quota or did not report). The gate retries such a failure once; a retry in which the claim holds proves it, and the failures are listed in `attempts`;
- `not_proven` means nothing contradicts the claim, but a step needs a person (`--manual`) and there was none: the absence of the step does not prove that the result is correct.

An attempt is `judged` (a claim: what is expected, what is observed and whether they match; `unobserved` lists the steps there was nobody to perform), `waiting` or `error`; the runs conducted before a failure stay in it. `summary` counts the scenarios by status; `stopped` names the reason if the gate stopped before a scenario because runs became impossible (plan quota, an occupied slot). `preflight` also shows the checks that had nothing to run on (`skipped`): an unbound `Blocked` signal is not “matched” but skipped. The exit code is 1 if the model-free check does not pass or at least one Tier 1 scenario is not proven, and 3 if everything is proven but something remains; a verdict from `--only` is marked `partial`. A gate run with only Tier 2 scenarios (`--only=T2b`) has `ok: true` even when the scenario is not proven: Tier 2 does not block the verdict, by construction.

**What the claims prove.** `proven` is a single sample on a single input: the gate does not measure the model's instability. Every claim starts from a positive baseline: the run ended with a valid result and read Notion content successfully (`fetch`, `comments_read`, `query`). This is a necessary condition, not a sufficient one: the trace does not say what was read (the content of the calls is not stored). So S2, S7, T2b and T2c prove that a run that looked at the world left no effects, but not that it looked at the right pages. “The page is not changed” guards the perimeter and is not model behavior: in runs Notion is read-only; the model's behavior is its calls to the App (a comment, a proposal, a notification, a continuation) and its write to GBrain. S6 proves that a fact or an event was written to GBrain, not that what was written is the person's decision: the trace does not store the content of the call. A Notion failure in the middle of a run is read as a `failed` run: the trace does not tell it apart from an invalid result from the model, and the reason stays in the verdict.

Every run spends the plan quota (the ceiling comes from the run profile); the verdict names the number of runs in the best and the worst case. The gate cleans up after itself: pages go to the trash, and the deliveries, continuations, evaluation windows, proposals and system threads are deleted from the gate database. What could not be cleaned up is in `cleanup.left`; what the gate cannot clean up by construction is in `cleanup.unmanaged`: the run traces, the entries the runs wrote to the gate's GBrain source (the S6 entries have `Берегиня-<number>` in their name), the webhook receipts of simulated channel updates and the soft-deleted `projects/<id>` anchors of the S1 world (recoverable until GBrain cleans them up).

## Gate M6

**Gate M6** measures how the real Skill on real connectors raises attention labels in a world it has not seen before: whether it raises proactive labels where they apply, whether it stays silent where silence is the right answer, and what it writes to the person. The gate builds the world with system writes, wakes a run with an event (composed as an evaluation window would compose it) or with the person's reply in the channel, and reads back what the run **itself wrote**: comments (with the threads and pages they ended up on), the notification packet, continuations, proposals, calls by server. The expectations are written in the gate's code, separate from the world.

The requirements are the same as for gate M3, gate M4 and gate M5 (the gate environment, the subscription token), and the gate is launched through `bin/gate` ([running the gate](#running-the-gate)). In addition:

- the gate integration has the Insert content capability ([RUNBOOK §2.2](RUNBOOK.md#22-notion-integration)) and access to the Habits database: without them scenario B1 cannot build its world, and the model-free check says so before any quota is spent;
- no other gate holds the lock, and the run slot is free;
- the Skill being measured is the one in the working tree: `bin/gate` builds the gate image from the tree. The verdict reports the digests of the plugin directory (`skill`), of the result schema (`schema`) and of the gate itself (`digest`): they show what the verdict was produced on.

```bash
./bin/gate m6 [--only=U1,W1 | --preflight] [--trials=3] [--recorded-trials=1] [--without-held-out] \
  > gate-m6.json 2> >(tee gate-m6.log >&2)
echo $?
```

Always keep the log: it contains the reasons the CLI rejected a run's result (a copy is also in the artifacts, in `rejections`) and a record of every environment error. Without `tee` nothing is visible in the terminal until the gate finishes.

- `--trials=N` sets how many times each blocking scenario is run, from one to nine (once by default: this is a check, not an acceptance run). `--recorded-trials=N` sets the same for recorded scenarios (once by default). Trials go round-robin over all the scenarios: first the first trial of each, then the second; a failure or a limit in the middle of a run leaves one or two complete trials of every scenario, not three trials of the first few. Each attempt builds the world from scratch under its own tag (`<run>-<attempt fingerprint>`: page names, GBrain slugs and code words derive from it, and a retry after a failure gets a different tag), so they do not repeat. The tag does not mention the scenario or the gate: the model sees the names, and “u1” or “gate” in them would tip it off that this is a test. The verdict says which tag belongs to which attempt (`runs[].attempts[].tag`). For acceptance use three trials; one is enough to check an edit to the Skill.
- `--only` runs only the named scenarios (`U1`, `W1`…); an empty or unknown list is refused.
- `--without-held-out` leaves out the scenarios that are not read while the Skill text is being iterated on (`U2`, `U4`, `X1`, `Q1`, `U5`): their verdicts are taken at the comparison and in the final run.
- `--preflight` runs only the model-free check and spends no quota. It is not used together with `--only`.

**Before the first run: the model-free check.** Each check names the scenarios it blocks: a GBrain failure stops F1 and F2, not the whole run. A normal run checks that every event is named by a property in the binding, that the person's reply in the channel reaches its own window, and that GBrain accepts a page, finds it by the Project id and lets it be deleted. Under `--preflight` the check also builds each scenario's world with its memory (states, dates, the relations of the Project and of the Behavior System read from their own sides, and a `Next Action` blocked according to the methodology's rule), and the F2 trap must be findable by a search on the topic. In a normal run each attempt makes the same check of the world before the run: a harness fault in a scenario's description is not retried, while a Notion failure is retried once.

Scenarios. Blocking scenarios prove the verdict and recorded ones are only recorded; the person's words are drawn from a pool of wordings by trial number.

| # | Input | Holds |
|---|---|---|
| U1 | in a thread on a Task the person says they will send a client an offer tomorrow; no equivalent exists | the `untracked_commitment` label; one system remark in this thread that names the promise; no new Tasks; at most one notification |
| U2 | the same, but an equivalent Task is in another Project, worded differently | no label; the run searched for the equivalent (a Notion search or query) |
| U4 | the person states an intention, not a promise | no label |
| W1 | a `Waiting For` Task, the date has come due, the deadline is in two days, there is no other path: an event; the same event with a new id; a recheck with the deadline “tomorrow” | the dependency and the deadline risk are named, at most one remark across all pages, the person is notified, a follow-up at least an hour ahead; nothing is said on the Project and its integrity is untouched; the repeated event stays silent; the recheck names the risk or notifies |
| N1 | a deadline in two days, but the Project has a free `Next Action` | nothing is left for the person, no risk label |
| P1 | the last open Task of an active Project is done | `project_integrity` and one remark on the Project |
| P3 | all open Tasks of an active Project are waiting or scheduled | nothing is said on the Project, no label |
| K1 | a `Next Action` with an open blocker | the contradiction quotes the Task and the blocker; the proposal, if there is one, touches only this Task and is sent in the run's notification with the actions `approve` and `reject` carrying its id |
| F1 | GBrain holds a constraint lesson about the Project (a contract waits for mockups with a code word) | `forgotten_context`, one label quotes the GBrain page and the Notion page, the code word is in the text; nothing is remembered |
| F2 | the same lesson is on a page of another Project on the same topic, and this Project's anchor does not have it | no label, no code word in the text |
| B1 | a Behavior System that is `Installing` and one failed instance | nothing is said on the system, at most one remark on the instance, no friction or Area of Focus risk labels, nothing is remembered |
| A1 | the `Mode` of an Area of Focus is changed to `Advance`, and nothing in it is moving: only a done Task and a `Someday/Maybe` Task (a review-level ground, not urgent) | nothing is left for the person, no Area of Focus risk label |
| X1 | a `Someday/Maybe` Task whose title names a window of opportunity | nothing is left for the person, no label |
| Q1 | a routine edit in a Project of twelve healthy Tasks | nothing is left for the person, no label, no continuation |
| N2, N3, P2, L1, E1, U3, U5 | the deadline has passed; `Scheduled` with a date earlier than the deadline; `Planning` with a clarifying Task; a Project of twelve Tasks and a hidden alternative; a promise in English; a promise with no date; a promise made by a third party | recorded: they are written down and do not enter the verdict. N3 and U3 — `adoption`: they measure a behavior the Skill is not required to have, so failing them is not a fault, and the share is the starting point for computing the gain. U3 holds that a question to a person who replied from the channel goes out as a notification; U5 has no expectation (the norm has not decided whether to raise a label for someone else's promise), and the run is recorded in the artifacts |

**The verdict** is JSON on stdout; logs go to stderr. Observations come in three kinds, plus a flag.

- `perimeter` is what the App and the mode's toolset guarantee: statuses are unchanged, there are no new pages, there is at most one notification, the follow-up respects the minimum lead, GBrain pages and links are not written. A perimeter violation fails the scenario, but it is a regression in the App, not in the Skill: the verdict reports such failures separately (`perimeterFailures`), and in the comparison they are a separate rule with no confirming repeat, outside the behavior pools.
- `effect` is the model's choice, with zero tolerance: any attempt that violates it fails the scenario. It covers silence where silence is the right answer, a proposal only on the Task it concerns, everything written landing on pages of the world, and no identifiers or label names in the texts for the person.
- `recognition` is a share of judged attempts of at least two thirds (rounded up), together with a share of at least two thirds of the trials in which all of the scenario's recognitions held together (`wholeTrials`): three trials, each missing something different, prove nothing, even though every observation taken alone has its two out of three. With positive polarity the label is raised, a comment exists and the source is quoted; with negative polarity the label is not raised. A label may waver; an effect may not. Every scenario also includes “no label of mode `shadow` or `inbox_review` is raised” (for the modes, see `detector_activation`).
- `flags` are the diagnostic words in the run's texts, with how many times each occurs, per scenario and overall in the verdict. They are not observations: a substring match cannot tell “це не лінощі” (‘it's not laziness’) from a diagnosis, so a person reads the words. They do not change `ok`, but they revoke `accepted`: texts for the person that no one has read are not accepted.

A scenario's `status` is `proven`, `failed`, `error` or `not_proven`. `proven` needs at least two judged trials when more than one is requested: one attempt does not prove a share. An effect or perimeter violation fails the scenario regardless of the number of attempts; a recognition failure fails it only when enough trials are judged to allow `proven`, and with fewer judged trials the status is `not_proven`: there is no judgment on a share from a single trial. The gate retries an attempt that hit an infrastructure failure once, under a new tag, and does not count that trial as judged, but keeps it in the verdict (`runs[].attempts[]` with the reason in `cause`); a harness fault in the scenario description is not retried. Every selected scenario is in the verdict: one that was not run has the status `not_proven` and `trials.notRun`, plus `blockedBy` when a check stopped it.

- `ok` means the gate reached the end (`stopped` is empty) and everything selected as blocking is proven; under `--preflight`, all checks passed and there was at least one: an empty list (the runner is not ready) checked nothing. A selection that leaves no scenarios (`--only` naming only held-out scenarios, together with `--without-held-out`) is a launch error, not a run;
- `accepted` means the same as `ok`, but for the full set (without `--only`, `--preflight` and `--without-held-out`), on at least three judged trials of every blocking scenario and with no diagnostic words in `flags`. A single run of a scenario, or a single trial, accepts nothing;
- `stopped` says why the gate did not get through everything: the runner is not ready, the run gates are closed (plan quota, breaker, a busy slot, and the daily limit for W1, whose last step has an autonomous origin) or two consecutive trials did not reach a conclusion because of the environment. When both of those trials depend on GBrain (F1, F2), or both on the channel (the person's replies), the gate does not stop but skips the scenarios with that dependency; in the verdict this is `blockedBy`. A verdict is always written, even when the run did not start; a gate stopped by a signal does not write a verdict: the stub with `aborted` does;
- `summary` counts how many blocking and how many recorded scenarios are in each status;
- `scenarios.<id>.runs[].attempts[]` contains the attempt's tag (`tag`) and the artifacts for reading **all** attempts, both failed ones and runs that did not reach a conclusion (deadline, deferred run): the texts of comments with their threads, notification packets, proposals (page, field and value), continuations, policy refusals, labels with their wording (`claim`, `why_now`, evidence, refutations), duration, calls by server, rejected results and failed Notion calls, GBrain writes, writes outside the world (`foreign`). The notification packet also contains `proposals` (which proposals, with the line of each); `skillReads` lists the Skill files the run opened, in order, as paths relative to the plugin directory (a rejected read is marked `[failed]`); `rejections` lists the grounds on which the CLI rejected the result. The runner collects `skillReads` and `rejections` in the memory of the gate process (they do not go into the run trace), so a run that did not reach the runner has them empty;
- `efficiency` is reported per scenario and overall: the mean duration and calls are taken over completed runs, result rejections and failed runs over all runs;
- `weekday`, `timeZone`, `language`, `models`, `skill`, `schema` and `digest` decide whether verdicts can be compared. `language` is the language of the App's own messages to the person (`APP_LANGUAGE`): the gate renders and measures packets in it.

You read the texts for their quality (language, one question, proportionate length, simplicity): the gate checks automatically only what is objective. Exit code 1 if the model-free check failed or at least one blocking scenario is not proven; 3 if everything is proven but something remains.

**Candidate comparison with the baseline.** This is a tool for catching regressions, not a condition for accepting the Skill: acceptance is the verdict of the gate itself. The gate is a smoke acceptance test, not a comparison tool: three trials show only large differences, and “at least one regression out of fourteen” would turn up on an identical Skill. A command runs the comparison under a rule fixed before the candidate is run. The baseline and candidate verdicts come from two runs of gate M6 and are written to the files `gate-m6-baseline.json` and `gate-m6-candidate.json` in `infra/`; the command is run from `app/`:

```bash
cd ../app
npm run gate:compare -- ../infra/gate-m6-baseline.json ../infra/gate-m6-candidate.json [--confirm=../infra/gate-m6-confirm.json] [--targets=U1,W1]
echo $?
```

The command refuses to compare (code 2) verdicts with a different `digest`, `schema`, model, time zone (`timeZone`, on which “tomorrow” depends) or App language (`language`, on which packet lengths depend): otherwise something other than the Skill would be compared. The same applies to each repeat in `--confirm`: it must be a repeat of this very candidate (the same `skill`, `digest`, `schema`, model and time zone). Take both verdicts on the same day: the day of the week in the person's words must not differ. Only scenarios with at least two judged trials in both verdicts are compared; when there are no such scenarios at all, there is nothing to compare. A `PASS` conclusion is possible only on the full set: a stopped verdict or a blocking scenario without two judged trials in both (`INCOMPLETE: …` in the report) yields `INCOMPLETE`, not `PASS`, so that `gate:compare … && next` does not go ahead on half the data; and a rule that does not hold yields `FAIL` regardless of gaps. Recorded scenarios that are run once are not a gap: they are listed in the notes (`note:`). The rule:

1. `effect`: an item where the candidate violates more often than the baseline (for an observation the baseline lacks, the baseline has zero violations). A suspicion is settled by a repeat of the candidate's scenario with five trials (from `infra/`: `./bin/gate m6 --only=U1 --trials=5 > gate-m6-confirm.json`, the file goes into `--confirm`; several repeats of one item are combined): it is confirmed when the repeat has at least two violations and a share higher than the baseline's, otherwise it is refuted. The repeat alone decides: the sample that raised the suspicion is biased, so it is not combined with the repeat. Without a repeat, only a suspicion where the baseline is clean and the candidate violated at least twice counts as confirmed; the rest waits for a repeat and does not pass the rule.
2. `perimeter`: no violation that the baseline did not have. A perimeter violation is a regression in the App or in the toolset, not Skill noise, so a repeat does not refute it; the perimeter is read in all of the candidate's scenarios that have judged trials.
3. `recognition` item by item: an item that held in the baseline but does not hold in the candidate is a suspicion. Without a repeat it is confirmed only when the item did not hold in any of three or more trials; a partial decline waits for a repeat with five trials (a repeat in which the item holds in two thirds of the trials, that is, in at least four of five, refutes it). Reading item by item catches the case where the pool did not change because one recognition fell and another rose.
4. `recognition` in two pools, positive and negative polarity separately (a silent version does not mask losses): the candidate's share, averaged over scenarios, is not lower than the baseline's by more than ten percentage points. A scenario weighs the same as any other, however many items it has; an item that applies to every scenario (“no label of a mode the run does not raise”) does not go into the pools and is read per scenario under rule 3. `adoption` is shown separately. The report also gives the pool of items with Wilson intervals and the Newcombe difference: with three trials the intervals are wide, so the decision is read together with the artifacts.
5. Target observations (`--targets`, the scenarios the Skill edit was meant to change) are not lower than the baseline as a pool and are better in at least half of the items that could still be improved. If a named scenario was not compared, the command refuses.
6. Efficiency, as a pool over the shared scenarios: duration and calls over completed runs are no more than fifteen percent worse than the baseline's; the share of runs with a rejected result is no more than five points above the baseline's, the share of failed runs no more than ten, and the share of runs that hit the turn ceiling no more than one. Stricter thresholds would fire on the noise of three trials.
7. You read the texts of the scenario pairs (U1, P1, W1).

The exit code is 0 if the rule holds on the full set (`PASS`), 1 if it does not (`FAIL`), and 2 for a call with an error or for verdicts that are incomparable (`INCOMPARABLE`) or incomplete (`INCOMPLETE`).

The gate digest (`digest`) covers the modules of `app/test/gate/` (not its subdirectories; the `workspace/` preparation is excluded), the App's tools, the knowledge layer, the App's texts and the Telegram channel (the packet length depends on them), and the surfaces the model sees (the tool boundary, the run profile, the labels, the toolsets, the event envelope): an edit to any gate module, including the gates of other milestones, makes the verdicts diverge. So the baseline is taken once the gate code has stopped changing, and taken again after every edit to it. Take the baseline and the candidate on the same day, with the same `--trials` and `--recorded-trials`: the day of the week is part of what is measured (the verdict records `weekday`), and recorded scenarios are compared only when both verdicts have at least two judged trials.

**What it costs.** Every run spends the plan quota (the ceiling comes from the run profile); the verdict reports the number of runs in the best and the worst case. A full gate run with three trials takes about 55 runs, and every gate run builds the gate image: group your iterations, and to check an edit use `--only` and `--trials=1` (this is a check, not a measurement).

**Breaker.** Gate runs are counted among the completed runs of the gate database: five consecutive failures open the breaker of the gate environment, and the main App is not affected. The gate stops earlier, after two consecutive trials without a conclusion because of the environment (apart from a GBrain or channel failure, see `stopped`); before W1 it also asks the autonomous run gates. After a streak of failures, make one successful gate run.

**What the gate does not clean up.** Notion pages go to the trash, and the deliveries, continuations, evaluation windows, proposals and the system's threads are deleted from the gate database; the GBrain pages of the scenarios (anchors by convention, the notes and lessons that a scenario put there) are soft-deleted. What remains is run traces (for diagnostics); webhook receipts of simulated channel updates; the facts and events that the scenarios put on their own pages (they refer only to objects of the gate worlds) and those that the runs themselves wrote into the gate's GBrain source (they can be seen in the artifacts' `gbrainWrites`); and the comments that a run left on pages outside the world (the Notion API cannot delete comments; they are listed in `foreign` together with the page and the thread). The gate does not remove the thread of such a comment from the gate database: it may have been in use earlier, and cleaning up by thread would delete foreign rows. The gate cleans up the queue rows that the run itself placed (continuations, deliveries, proposals) by the ids in the run's effects, wherever the rows are. `cleanup.unmanaged` lists what remains. Residue that the gate did not clean up is found by the attempt tag (`tag` in the verdict): the tag is in the names of Notion pages (`Орбіта-<tag>`) and in GBrain slugs.

**What the gate does not measure.** These are limits that the verdict does not show:

- stagnation, the wording of a DoD, a divergence between a GBrain decision and the Project's direction, a comment the person made directly in Notion, and the wake of a dependent Task when the blocker has become `Done`: the gate worlds have no page bodies and none of these events;
- U2: the gate sees that the run called a Notion search or query, but not what it was called with (the trace does not keep the input of calls), so “searched for the equivalent” says less than it sounds; a person reads the texts;
- a gate run has the origin `operator`, so the delivery response tells the model `quiet_hours_exempt: true`, while a real autonomous run during quiet hours sees `silent_until`; the gate does not measure behavior during quiet hours;
- the check for overlaps between the gate's strings and the text of both plugins catches verbatim copying (four words in a row), not a paraphrase: the independence of the wording rests on its author not having read the Skill.

## Gate M7

**Gate M7** measures how the real Skill on real connectors uses GBrain's long-term memory: whether it finds an object's anchor by its exact id, whether it writes to memory only what is worth keeping, and whether it leaves memory as it was where the matter is routine. The harness is the same as in [gate M6](#gate-m6): the world is built with system writes, a run is woken by an event or by the person's reply in the channel, and what the run **itself wrote** is read back. The state of memory is added: before and after the run the gate reads from GBrain the pages that the scenario put there (content, events, facts), and the runner reports which GBrain tools the run called and with what arguments. The expectations are written in the gate's code, separate from the world.

The requirements are the same as for [gate M6](#gate-m6): the gate environment, the subscription token, a free lock and run slot; the gate is launched through `bin/gate` ([running the gate](#running-the-gate)). The verdict reports the same digests: `skill`, `schema` and `digest` (the gate together with the knowledge layer `app/src/knowledge/`, which it uses to build pages and parse GBrain's answers).

```bash
./bin/gate m7 [--only=H1,H4 | --preflight] [--trials=3] [--recorded-trials=1] [--without-held-out] \
  > gate-m7.json 2> >(tee gate-m7.log >&2)
echo $?
```

The flags are the same as in gate M6; `--without-held-out` removes `H5` and `H7`. Always keep the log. A full gate run with three trials takes about 29 runs (nine blocking scenarios at three trials each and two recorded); the verdict reports the cost in terms of the subscription, in `cost`.

**Before the first run: the model-free check.** It runs on a live GBrain, on the pages of this run (everything put there is soft-deleted), and checks the assumptions the scenarios rest on. Each check blocks only the scenarios that depend on it and is not run when none of them is selected (a write to GBrain is slow); a GBrain failure is the result of a check and does not end the run. The checks are the same as in gate M6 (an event is named by a binding property, a reply in the channel reaches the window), plus these:

| Check | What it proves |
|---|---|
| an anchor is found by a typed search by id | a search among the anchor types returns the page that was put there as an exact match (`keyword_exact`), the page follows the convention, and the exact-identity procedure yields the state `exact` |
| an id only in the frontmatter is not an exact match | a page with no id in the body is not found by a search by id, while the control anchor with the id in the body is found; the identity line in the anchor's body depends on this |
| two anchors with one id | the procedure yields `integrity_error` with the slugs of both pages, and neither is chosen |
| an event for a page that does not exist | is rejected |
| an event and a fact land in the page text | after the write, the page text contains the event and the fact; after a crude replacement of the page with text that lacks them, the database still holds their rows, which are no longer in the text: that is how drift becomes visible |
| link types | the server accepts every declared type (`memory_writes.link_verbs`) and rejects an invented one |

Scenarios. Blocking scenarios prove the verdict and recorded ones are only recorded; the person's words are drawn from a pool by trial number. The gate puts the anchor of the Project (or of the Behavior System or the Area of Focus) into each scenario's memory by convention, with the id of the world's object. In H7 there is no Project anchor before the run: the gate watches its conventional address and removes whatever appears there.

| # | Input | Holds |
|---|---|---|
| H1 | the person completed a Task in a Project that is moving; the Project's anchor has a single old event | memory and the anchor are as before the run; the run only reads from GBrain; at most one notification |
| H2 | in a thread the person only clarifies the date of a check | the same |
| H3 | GBrain holds two anchors with the same id for the Project (someone put the second under a different slug, the first has a lesson on it), and also a note that mentions the id | memory and both anchors are as before the run, and the labels quote Notion; the run read GBrain and says there are several pages (in the label's `uncertainties` or in the text to the person); the labels have no `forgotten_context`, and the text has none of the lesson's words |
| H4 | the person made a decision in a thread; the Project's anchor exists and knows nothing of the decision | the anchor has exactly one new event that begins with `Decision:`, names the choice in the person's words and has a source; every memory write lands on the anchor; the page text has kept all its lines; the run read the anchor before the write |
| H5 | the person repeats the same decision when it is already recorded on the anchor | memory is as before the run; the run read the anchor |
| H6 | the person states a fact about a customer that will be needed again later | the anchor has exactly one new fact in the person's words, whose entity is the anchor's slug; every memory write lands on the anchor; the page text has kept all its lines; the run read the anchor before the write |
| H7 | the person made a decision about a Project about which memory holds nothing yet; only another Project's anchor exists | the Project's anchor is created by convention, with exactly one `Decision:` event on it in the person's words, and every memory write lands on it; the other Project's anchor is as it was; the thread has at most one comment, and the person is told only about what has been remembered |
| H8 | a missed repetition of a Behavior System; the history of its anchor has one similar event | the run ends without writes, proposals, notifications or comments on the system, and the labels have no friction or Area of Focus risk |
| H9 | a lesson with a code word is on a page linked to the anchor, and next to it is a lesson of a similar Project with a different word | `forgotten_context` quotes the lesson page and the Notion page; the text has the lesson's word and not the similar Project's word; the anchor was read before any free search; the anchor's links were read from both sides; at most four GBrain calls; memory is as before the run |
| H10 | the person says what is acceptable for the Area of Focus | recorded: a fact of kind `preference` that begins with `Standard:` appears on the anchor of the Area of Focus |
| H11 | in a thread the person formulates a lesson on their own and asks that it not be forgotten | recorded: exactly one fact in the person's words appears on the Project's anchor, and that is the run's entire write; every memory write lands on the anchor |

**The verdict** is the same JSON with the same three kinds of observations as in [gate M6](#gate-m6) (`perimeter`, `effect`, `recognition`, `flags`), with a `gate` field that names the set. For gate M7 this means: the run only reads from GBrain (`perimeter`: the toolset enforces it); an extra write and a missed write are `effect`, with zero tolerance; reading GBrain, the order of calls and a mention of several pages are `recognition`. The gate sees what the run remembered in two places: in the memory write's applied effects in the run trace, and in the state of the pages before and after the run.

**Verdict limits.** Other checks cover these properties:

- thread closure (`closure_processing`) is covered by the gate M5 scenario (`S6`, `--manual`): the person resolves the thread; gate M7 checks that a decision and a fact in the person's reply in the channel are recorded;
- the Chat path (a memory write in the conversation, a page change, links, a lesson) is checked manually by the operator ([RUNBOOK §23](RUNBOOK.md#23-anchor-check)): it is an interactive path;
- the refusal of a memory intent when there are several anchors or the conventional address is taken is covered by the tests of the memory service; the scenario worlds whose memory has several anchors or a taken conventional address do without the person's words;
- stopping the applying of writes at the run's deadline is covered by the tests of the write policy and the memory service; the scenarios work with a fast GBrain;
- the gate finds the words about the memory store (H7) and about several pages (H3) by indicators in the text, and a person reads the content of the texts;
- an anchor discrepancy reaches the person as a run label, and the operator fixes it ([RUNBOOK §23](RUNBOOK.md#23-anchor-check)).

## Gate M8

**Gate M8** measures scheduled reviews (daily, weekly, strategic, deep), the periodic safety sweep, the reconciliation of resolved threads and ingress by page content, with the real Skill on real connectors. The harness is the same as in [gate M6](#gate-m6) and [gate M7](#gate-m7); each mechanism takes its production path: a review is driven by the occurrence row of the current period, which the run source claims; the sweep and the reconciliation by a real tick; ingress by a Notion event through the same ingress that the webhook uses. The gate sets its own review schedule (`daily 00:00`, `weekly mon 00:00`, `monthly 1 00:00`, `quarterly 1 00:00`), so the current occurrence of each is open at any time of day. A review, the sweep and the reconciliation read the whole workspace and the whole database, so before every attempt the gate checks that nothing is there except what was seeded. An attempt that finds something foreign is an infrastructure failure, reported with a list.

The requirements are the same as for [gate M6](#gate-m6), plus stale Inbox items and a personal token (`GATE_NOTION_PERSONAL_TOKEN`): in X1 the person writes in a Task's body.

**Stale Inbox items** are planted by seeding. Staleness is measured from the time of capture. In the gate that time comes from the overlay date (`Captured`): seeding writes into it a moment one day past the staleness limit, while the gate stamps every Inbox item of a scenario world with the time the world is built.

```bash
./bin/gate m8 --seed > gate-m8-seed.json
```

Seeding puts two items in the Inbox (the system has not yet asked about one, and its question about the other awaits an answer) and writes their fixture ledger to `infra/gate/fixtures.yaml`. The items are stale immediately: the report states the time they become ready (`readyAt`), and that time has already passed. The items persist between runs: each attempt returns them to the declared state by removing the comments and the `app_db_gate` rows that the ledger does not name. Seeding again restores whatever has vanished or been damaged, and reports the capture time again.

```bash
./bin/gate m8 [--only=D1,W1 | --preflight] [--trials=3] [--recorded-trials=1] [--manual] \
  > gate-m8.json 2> >(tee gate-m8.log >&2)
echo $?
```

The flags are the same as in gate M6, plus `--manual`, which means that the operator is nearby and, in C1, resolves the thread in Notion when the gate asks (for up to 10 minutes; the wrapper announces the request aloud). Without `--manual` the step that resolves the thread is not performed, and C1 is `not_proven`. C1 runs first, so the operator is needed only at the start. C1 does not call the model and runs once, however many trials are requested. The acceptance run is one full run: `--trials=3 --manual`. A full gate run with three trials takes 17 model runs (five blocking scenarios at three trials each and two recorded). The Notion MCP query allowance ([gate environment](#gate-environment)) makes a full run long on Free: it takes hours, because each run waits until its queries fit within the allowance for the hour. On Business it is shorter. SW1 and X1 run autonomously and spend the daily limit of `app_db_gate` together with W1 of gate M6 and AP3 and AP5 of gate M9 on the same local day. A run that the remaining limit would not cover does not start and says how much is left.

**Before the first run: the model-free check**, on the pages of this run (everything is cleaned up). Each check blocks only the scenarios that depend on it and does not run when none of those scenarios is selected. The checks are the same as in gate M6 (an event is named by a binding property, a reply in the channel reaches the window, GBrain accepts a page), plus these:

| Check | What it proves |
|---|---|
| the environment holds only what was seeded | the live pages of the bound databases and the `app_db_gate` rows (threads, queues, windows, proposals, occurrences, sweep marks, the reconciliation's memory) contain nothing except the seeded items |
| the seeded items are stale and in the declared state | the items are live and in the Inbox, the capture time read through the binding is the declared one and past the staleness limit, and the comments and the thread are exactly as declared |
| the App sees a deleted comment on a live page as deleted | the comment disappears from the list, while Notion returns it by id marked as deleted, and the App reads that mark; that is how an attempt returns the seeded items to the declared state and how C1 distinguishes a deleted thread from a resolved one |
| a reply in a review thread is routed by the page type | on an Inbox item a reply wakes `dialogue`, on a Task `event_evaluation` |
| the sweep finder reads every rule | the real finder over a world with a positive case for each rule and with controls finds exactly the expected pages and rules: that is how a failure of a group of queries, which the finder swallows, becomes visible |
| ingress accepts an edit of a Task's body and rejects Areas of Focus | a Task body event opens a window, and an Area of Focus body event is rejected with a reason |

Among the scenarios, blocking ones prove the verdict, and recorded ones are only recorded. The name of the object a claim is about has its own Latin stem, and the claim recognizes the object in the text by that stem.

| # | Input | Holds |
|---|---|---|
| C1 | three Tasks, each with a system thread (Notion puts the comments of a page into one thread); a reconciliation tick, the person resolves the first thread, the gate deletes the third thread's comment, two more ticks | the first tick requests no closure and sees the threads open; then exactly one closure request, for the resolved thread; the open one stays open, the deleted one gets no closure; the last tick requests nothing new |
| D1 | a Daily Control: a deadline today, a call tomorrow with a time of day, `Scheduled` for today and an overdue one, nine Available Now candidates, `Done` and `Someday/Maybe` without dates, a paused Project with a commitment tomorrow, an Identity, one fresh and two stale Inbox items, an open proposal | the run loads no `Done` or `Someday/Maybe` Tasks and no Identity; the packet carries the proposal with buttons, and does not name the `Someday/Maybe` Tasks, the undated Tasks of the paused Project or the stale items individually; every commitment of the day is named, along with part of Available Now and the number of stale items (two) |
| W1 | a Weekly Control Review: stale items, a `Waiting For` Task with a past date as the only open Task of a Project, a calendar a week back and a week forward, an `Active` Project without motion, a `Planning` Project without Tasks, a `Paused` Project with a time-fixed commitment, a `Waiting For` Task with a completed blocker, a Behavior System with friction in its body, an `Advance` Area of Focus in which nothing moves, with a `Standard` in memory, and a `Maintain` Area of Focus without linked work | labels with evidence for every object (a label for an Area of Focus goes on it and on its Tasks), the quiet `Maintain` Area of Focus has no label; new threads ≤ 2, comments only on pages with a finding, no new comment on the item with an unanswered question; proposals only on pages with a finding, without `Failed`; a `Next Action` proposal for the Task with the completed blocker; the packet attaches its own run's thread and names the calendar, the item that awaits an answer, and the `Next Action` for the week |
| S1 | a Strategic Review: two Objectives, Key Results, a `Done` Project on the first Key Result, the person's words about the first Key Result and about the limit on evenings, Tasks of both Objectives on the same days above the limit, an Area of Focus with `Mode` and an acceptable state in memory | a change of evidence only for the first Key Result and based on the person's words; no proposals, comments only on Objectives; every Objective and Area of Focus is named, the other Key Results are asked about; a conflict over evenings, with evidence of the work on both Objectives |
| SW1 | a `Waiting For` Task whose `Date` comes due and whose deadline is tomorrow, with no thread and no event; controls in other Projects | the first tick wakes exactly this Task, the second wakes none; the wake run names the dependency and the deadline risk, comments on the Task and notifies; the continuation is set no earlier than the minimum lead |
| X1 | the person writes a promise to a client in a Task's body and moves the `Deadline`; a control edit of the body of an Area of Focus | the body edit opens a window, the property edit extends it: the window has both types, and its `type` is the last one; the Area of Focus edit is rejected; the run opens the Task, raises `untracked_commitment` and asks in a comment, naming the client |
| S2 | recorded: a Strategic Review; the Project's anchor has two episodes from different sources with a common cause | one question names both episodes; no lesson is written |
| DP1 | recorded: a Deep Review; an Identity with Principles in its body, an Area of Focus, one `Failed` Task | a packet without comments, proposals or labels; the Identity's body is read |

**The verdict** is the same JSON with the same kinds of observations as in [gate M6](#gate-m6); `manual` says whether the operator was nearby. For gate M8 the kinds are as follows: what the toolset enforces (Notion is only read, there is one packet, buttons on every proposal) and what the App's ticks and ingress do (whom the sweep wakes, what the reconciliation asks for, what the window contains) are `perimeter`; the model's choices under the Skill's instructions (what is not loaded and not named, where the comments are, which proposals) are `effect`; labels, named objects and the consequences of labels are `recognition`.

**What the gate does not clean up:** the seeded items (they persist between runs), receipts of simulated Notion events, run traces.

**Verdict limits.** Other checks cover these properties:

- the expiry of a proposal shown by a delivered Daily Control packet is covered by the integration test `inv-104`, because the gate channel does not deliver packets;
- the schedule, occurrence keys, DST, retirement and the occurrence producer with the channel as a precondition are covered by the tests `schedule`, `inv-103`, `review-occurrence`;
- the sweep's limits (tick, day, recency), its memory and aging, and the run-trace reader for “a run has already seen the situation” are covered by the integration tests `safety-sweep`, `inv-101`, `run-traces`;
- the volume of reconciliation, the poison anchor and the anchor limit are covered by the integration test `inv-102`;
- the decision in GBrain after a thread closure is covered by the gate M5 scenario `S6`, because the closure request comes from the same `requestClosure`;
- delivery of a packet to Telegram and a review in the chat are checked by hand;
- the Weekly Control Review does not process Key Results with new data; the Strategic Review asks about the Key Results of every Objective (S1);
- what depends on meaning (“asks without presuming `Failed`”, “buttons work until the next review”, “no diagnosis”) is read by a person in the artifacts and the flags.

## Gate M9

**Gate M9** measures the proposals that runs make and the person's decisions on them: the approval chain live and without the model, and what the model proposes and to whom it says so, with the real Skill on real connectors. The harness is the same as in [gate M6](#gate-m6)–[gate M8](#gate-m8); every step takes the App's production path: a message is sent by the delivery queue worker to the Bot API listener ([gate environment](#gate-environment)); a button press arrives as a `callback_query` at the App's own webhook; an edit and the person's words in Notion are made with a personal token and arrive as an event at the same ingress as the Notion webhook; the executor and the publication of the proposal fate are driven by ticks of the same workers as in normal operation. A worker tick claims all the rows of its kind in `app_db_gate`, so before every tick the gate checks that the rows belong to this attempt. A tick that finds foreign rows is an infrastructure failure, reported with a list.

The requirements are the same as for [gate M6](#gate-m6), plus a personal token (`GATE_NOTION_PERSONAL_TOKEN`): the person uses it to edit Tasks, write in page bodies and comment in threads.

```bash
./bin/gate m9 [--only=AP1,AP3 | --preflight] [--trials=3] \
  > gate-m9.json 2> >(tee gate-m9.log >&2)
echo $?
```

The flags are the same as in gate M6. The acceptance run is one full run (`--trials=3`) of 19 model runs. Eighteen of them run the blocking scenarios AP1–AP4 at three trials each (AP1 and AP2 take two runs per trial, AP3 and AP4 one each) and one runs the recorded scenario AP5. The Notion MCP query allowance ([gate environment](#gate-environment)) makes a full run long on Free, taking hours; on Business it is shorter. AP3 and AP5 run autonomously (a recheck of the thread) and spend the daily limit of `app_db_gate` together with W1 of gate M6 and SW1 and X1 of gate M8 on the same local day. A run that the remaining limit would not cover does not start and says how much is left.

**Before the first run: the model-free check**, on the pages of this run (everything is cleaned up). The checks are the same as in gate M6 (an event is named by a binding property, a reply in the channel reaches the window), plus the checks of the approval chain. All of them run, both under `--preflight` and before an ordinary run: a check that blocks no scenario still proves what its row says.

| Check | What it proves | Blocks |
|---|---|---|
| tick queues hold nothing foreign | `app_db_gate` has no row that a tick of the delivery queue, the executor or the publication would claim and that no attempt placed there | all |
| approval chain | a proposal on behalf of the run is delivered with buttons; a tick before the press writes nothing; when the press is answered, the row is already `approved`, and the answer is “Approved”; before the tick the page is unchanged and its last editor is the person; the tick leaves the row `executed`, the property difference is exactly the contract's effect, no other pages are touched, and the editor is the bot; the thread has exactly one decision trail, either “Ти схвалив…” (‘You approved…’) or, with no gender set, “Твоє рішення — схвалити…” (‘Your decision is to approve…’), under the label “Your decision”, and no “not written” comment; every message with the proposal is edited to drop its buttons | AP1, AP3 |
| outpaced proposal | the person changed the status before the press: the tick closes the proposal with `conflict` without a press; the page has the person's value, there is no bot write and no trail in the thread, and the buttons are gone | AP2 |
| not written | the person pressed “Approve” and then changed the status before the tick; the proposal is closed with `conflict` and there is no bot write; the thread has the decision trail and “The approved change was not written (…): the page changed after the proposal.” under the label “Outcome of the change” | — |
| channel reply | the App accepts the person's reply to a delivered message silently, writes the person's words as a bot comment in the message's thread and opens a channel reply window on the thread's page | AP1, AP2, AP4 |
| channel reply label | the comment with the person's words is under the label “Reply from Telegram”; the label is for the person, so the check blocks nothing | — |

Among the scenarios, blocking ones prove the verdict, and recorded ones are only recorded. The person's words are natural and vary by trial; the system's threads and messages are in the system's own words, without the gate's name.

| # | World and steps | Holds |
|---|---|---|
| AP1 | a `Waiting For` Task in a Project with other open work, a thread with a delivered message; the person in the channel: the reply has arrived and it is done → run → tick → delivery → the person writes “yes” in reply to the notification → run → tick → delivery → pressing “Approve” on the notification of run 2 if it carries a proposal, otherwise on the notification of run 1 → tick → publication | run 1 produces exactly one `Done` proposal, only on the Task, in the conversation thread, in a notification with buttons; after “yes” there is no new proposal, and the notification has the same one; after each run the tick writes nothing; the pressed proposal of run 1 is executed: `Done`, the difference is exactly the effect, the editor is the bot, exactly one decision trail, the buttons are gone |
| AP2 | a `Waiting For` Task with a `Date`, a thread with a delivered message; the person in the channel: I can get started → run → tick → delivery → the person sets `Scheduled` with a date next week → tick → publication → the person in the Notion thread: “let's do it now after all” → run → tick | run 1 proposes `Next Action` with `Date` cleared in a single contract; after the person's edit the proposal is closed with `conflict`, the page is as the person left it, there is no trail, and the buttons are gone; run 2 makes a new proposal of the same change with a different id, and its preconditions read `Scheduled` and the new date |
| AP3 | a `Waiting For` Task whose blocker is `Done`; the system's `Next Action` proposal is delivered and rejected by a press, the “You rejected…” trail is published; the thread's recheck comes due | none of the run's proposals or notifications carries the rejected change (not even together with other effects) |
| AP4 | a `Next Action` Task with a `Deadline`, a thread with a delivered message; the person in the channel: “move the deadline to <date>” → run → tick | exactly one proposal, exactly `Deadline` → the named date, the precondition reads the current deadline; the proposal is in the notification; the deadline on the page is unchanged |
| AP5 | recorded: the control for AP3, the same world but with only a system note about the wait in the thread, no proposal and no rejection; the recheck comes due | the run proposes moving the Task to `Next Action` and says so in the notification. The silence of AP3 proves something only when a proposal does appear in the same world without the rejection: an AP5 that does not hold reads as “AP3 distinguished nothing” |

**The verdict** is the same JSON with the same kinds of observations as in [gate M6](#gate-m6). For gate M9 the kinds are as follows: the approval chain and what the App enforces on the run path (a tick writes nothing without a press, the write matches the contract exactly and is made in the bot's name, `conflict` instead of a stale write, the proposal's preconditions read the live page) are `perimeter`; the model's choices (which proposal the model composed, in which thread, whether the notification carries that proposal, whether the model avoided repeating a rejected one) are `effect`. If the run proposed the wrong change, the scenario goes no further: a press on the wrong change would judge the App by that change.

**What the gate does not clean up:** receipts of simulated Notion events and button presses, run traces.

**Verdict limits.** Other checks cover these properties:

- the deferred-approval mechanism without the model is covered by the integration test `scen-19-44`;
- approval after a process restart is covered by the integration test `proposal-restart`;
- the expiry of a proposal shown by a Daily Control is covered by `inv-104`;
- “a run writes no properties” is enforced by the toolset (`inv-034`, gate M3);
- the attempt limits of an approved action and the `failed` path are covered by the integration test `scen-19-44`;
- publication of the proposal fate exactly once is covered by `inv-107`;
- that a proposal is not executed before approval is proven by the gate only on a property change;
- how a message looks in real Telegram is checked by hand;
- a direct instruction and a decision in the chat are covered by the manual walkthrough below.

**The chat path is a manual walkthrough** (in the chat, a direct instruction yields exactly the named write without redundant confirmation, and an approval survives the session boundary). It runs in Claude Code with the plugin on the local stack, as in [gate M4](#gate-m4-and-the-chat-path), on test Tasks in the App's workspace. The gate does not check the chat.

Preparation is a separate conversation, before CH1: the chat creates test Tasks marked “[M9 test]” — a `Next Action` with a `Deadline` (CH1), a `Waiting For` on “the client” (CH2), a completed Task and a `Waiting For` blocked by it (CH3) — and sets a continuation on the last one: “check it in 5 minutes”. When it comes due, the App's run proposes `Next Action`: the proposal exists, and CH3 works on it, already without webhooks. The buttons in Telegram do nothing without the channel's webhook, so the decision is made in the chat.

| # | Conversation | Check |
|---|---|---|
| CH1 | “Move the deadline of the task ‘…’ to <date>” | one Notion write, only `Deadline`, in the first reply, without asking again; the page history shows the person; no Notion warnings; no proposal rows |
| CH2 | “<client> has already sent me everything” (a `Waiting For` Task) | first a question about what to change, with no write; after “yes”, exactly this change |
| CH3 | a new conversation about the run's proposal: “what is waiting for my decision?” → “approve it” | first the page, field and value are shown, with no decision; after “yes”, the decision is recorded, the executor writes the change, and the thread has the decision trail (“You approved: …”), the same as after the button |

The operator conducts the walkthrough. The transcript of each conversation is the Claude Code `/export`, kept in `infra/gate/transcripts/` (outside git, like the run transcripts). The result of the walkthrough stays an operator's note: it is not written to the repository.
