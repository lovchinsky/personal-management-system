# ADR 0037 — Periodic safety sweep wakes `safety_recheck` continuations and remembers what it has raised

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D37` |
| **Related** | ADR 0016 · ADR 0018 · ADR 0027 · ADR 0028 · ADR 0036 · `INV-017` · `INV-019` · `INV-020` · `INV-080` · `INV-081` · `INV-094` · `INV-101` · `INV-212` |

## Context

A Notion event wakes a run when the person has changed something. A risk that arises only with the passage of time — the check date of a `Waiting For` Task has come due, a deadline has drawn near or passed — has no event (`docs/2-system.md` § “Periodic safety sweep”). A continuation that a run sets itself covers only situations the system has already touched; a Task that became `Waiting For` with a date set for Friday wakes no one on Friday.

The selection of such situations is done by methodology rules over the records that were read (ADR 0027): a closed Project with unfinished Tasks, a `Waiting For` Task whose `Date` has come due. The `methodology/` layer is pure: no clock and no time zones (`INV-094`).

The `safety_recheck` reason occupies a continuation queue row that has no thread: a `(page, reason_code)` pair. Budgeted runs, `safety_recheck` among them, spend the daily limit (`run_budget.daily_limit`) shared with the evaluation of changes; `run_budget.exempt` also exempts some runs without a person from it, such as a scheduled review.

## Decision

**The sweep is a deterministic pass by the App that draws no conclusions: it finds candidates with bounded REST queries, sets a `safety_recheck` continuation for those that have no follow-through, and remembers what it has already raised.**

- **Reading** is done through the App's REST: a data source query with filters over the canonical slots; the status filter takes the current option name from the live schema by the binding's option id (`INV-081`). The recency threshold sits in the query itself, and the query returns the freshest first: the count limit cuts off the older rows. A group of queries is a unit of work: the tick skips a group that was not read and does the rest. The Notion MCP SQL quota does not apply to the App's reads; the rate limit does.
- **Selection** is done by the `methodology/` rules, which take ready-made time facts: the instant a date stands for and the current time, as numbers computed by the caller under the time rule (ADR 0036). The candidates are a `Waiting For` Task whose `Date` has come due; an open Task with a past `Deadline`, or a `Waiting For` Task with a `Deadline` in the window; a `Planning`/`Active` Project with no open path; a `Paused` Project with a time-fixed commitment; a closed Project with unfinished Tasks; a structural `Waiting For`/`Next Action` contradiction. A Task of a paused or closed Project is not woken separately, only the Project is.
- **What the sweep does not wake:** a `Scheduled` Task whose `Date` has come due (the content of the Daily Control), stale Inbox items and review-level labels: reviews bring them up (ADR 0036); a Project with an “approaching deadline” (a Project has no date); an Area of Focus that deviates from its acceptable state or is under `Advance` without motion — likewise a review-level label.
- **The wake** is a `safety_recheck` continuation with no thread, due immediately, set through an App entry without an actor, like `requestClosure` (ADR 0028): it does not move an existing open row and does not touch the person's snooze. The run is `scheduled_recheck` with the continuation's trigger envelope (`INV-020`). A page with follow-through — an open continuation, an evaluation window or a proposal — is not woken.
- **Recency.** A situation that arose earlier than the recency threshold (`contracts/canonical.yaml`, key `sweep.recency_hours`) is not woken: a review brings it up. The recency of a time rule is the instant of its date; that of a structural rule is the last edit of any of the participants. The time rules query for dates from the recency threshold onward, Projects are taken if edited within it, and dependent Tasks are all taken, the most recently edited first: an edit to the blocker also changes the situation of a dependent Task. This way, situations already present when the sweep is switched on and situations that arose during a long outage cause no burst of wakes.
- **The event is not lost.** If a run reached a conclusion about one of a situation's pages after the situation arose, the sweep does not wake it: that run has already seen it. For a structural situation this is the ordinary case — it arises from an edit, and an edit is an event — and the sweep remains a fallback path.
- **Memory** is `sweep_marks(page_id, rule, basis_hash)`: a candidate that has already been woken on the same basis is not woken again, even when there was no run. The basis is the value of the date together with its phase (“near” or “passed”) for time rules, and the last edit of the participants for structural ones; its hash is stored, not the value itself (`INV-017`). A mark is forgotten when the situation falls outside the recency threshold: after that the situation is not woken even without a mark.
- **Limits:** no more new wakes per tick and per local day than the keys `sweep.wakes_per_tick` and `sweep.wakes_per_day` specify, deadlines first. The tick does not proceed when the run gates of an autonomous run are closed — the runner is absent or not ready, the plan quota, the breaker, the daily limit. A `safety_recheck` row with no thread that has produced no run within `scheduled_check.safety_recheck_max_age_days` days after its time is retired, like an evaluation window that has no launcher.

**Rejected:**

- **An evaluation window instead of a continuation.** A window is a Notion event and its changed properties; the passage of time is not an event, and there is one window per page, which would blend with real edits.
- **A list of candidates in the review envelope.** See ADR 0036.
- **No memory.** An overdue `Waiting For` Task would wake a run on every tick until the person changes the date.
- **A first tick that only sets marks.** The recency threshold does the same without a separate “first tick” state, and protects in the same way after a long outage, which a first tick does not see.
- **Clearing a mark after a full query with no candidate.** The recency threshold makes the mark of an old situation unnecessary, and a truncated query need not be told apart from a full one.
- **A shadow of domain state in memory.** Storing date values in `app_db` is a copy of Notion outside Notion; the hash gives the same equality.

## Consequences

- The `sweeps/` module: the worker, the memory, and the service entries of other capabilities (`ContinuationsService.requestSafetyRecheck` and checks of a page's open state).
- `pending_actions` carries the effect's page: a proposal changes one object, so it has one page, and “is there an open proposal on the page” is a query, not a parse of JSON.
- The list of candidates, of what the sweep does not take, and why, is in `docs/2-system.md` § “Periodic safety sweep”.
- The contract key `sweep` holds the thresholds, limits and frequency.
- `INV-212` has something to apply to for “missed event”; `INV-101`: the sweep writes only `safety_recheck` continuations and asserts nothing about the domain.

## Cost

- The sweep spends the daily limit of autonomous runs, up to `sweep.wakes_per_day` per day.
- Situations older than the recency threshold — those present before the sweep is switched on and those that arose during an outage longer than the threshold — are not woken by the sweep: the nearest review shows them.
- A structural situation that an event run saw and left without follow-through is not woken by the sweep a second time.
- The tick limit can delay a wake by an hour or two when there are many candidates.
- Each tick is a few REST queries, within the workspace's shared limit.
