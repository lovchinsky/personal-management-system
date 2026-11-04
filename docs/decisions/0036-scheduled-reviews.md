# ADR 0036 — Scheduled reviews: an occurrence is a period, not an instant

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D36` |
| **Related** | ADR 0008 · ADR 0011 · ADR 0012 · ADR 0016 · ADR 0018 · ADR 0019 · ADR 0025 · ADR 0039 · `INV-019` · `INV-020` · `INV-030` · `INV-037` · `INV-080` · `INV-085` · `INV-103` · `INV-105` |

## Context

The methodology has four reviews of different frequency: Daily Control, Weekly Control Review, Strategic Review and Deep Review (`docs/1-methodology.md` § “Why different review frequencies are needed”). The contract gives each review a mode, a row of the toolset matrix, the origin `review_schedule`, which is exempt from the daily limit and from the breaker, and the run priority class `review` (`contracts/canonical.yaml`, keys `workflow_modes`, `mode_toolsets`, `run_budget` and `run_priority`). A review the person did not ask for must arrive automatically, at the configured time, with no event.

The schedule is the person's wall-clock time, not the container's UTC. The App counts day boundaries in the installation's time zone (`platform/time/local-day.ts`): an hour skipped by the transition to daylight saving time shifts forward, and an hour that occurs twice is taken at its first occurrence. The recurrence must say what counts as “one” review, what to do with one that was missed, and why a clock change does not produce two reviews in one night.

A review has no page and no thread. It is pages and threads that the continuation queue carries: its row is a thread or a `(page, reason_code)` pair, and the wake reason is the thread's technical reason (`INV-019`).

## Decision

**A scheduled review is a row in its own run queue for each occurrence of a period; an occurrence is identified by the local key of the period, not by an instant.**

- **The schedule** is an environment variable per review in the config namespace of the `reviews/` module (ADR 0019): `REVIEW_DAILY_CONTROL`, `REVIEW_WEEKLY_CONTROL`, `REVIEW_STRATEGIC`, `REVIEW_DEEP`. The grammar is closed: `daily HH:MM`, `weekly <mon…sun> HH:MM`, `monthly <1–28> HH:MM`, `quarterly <1–28> HH:MM`, `off`. An empty value is the same as an absent one and gives the default schedule (`contracts/canonical.yaml`, key `review_schedules`). The day of the month is limited to 28, so that a shorter month does not lose occurrences.
- **The time** is wall-clock time in `APP_TIMEZONE`, computed by the rule of `local-day.ts`.
- **An occurrence** is identified by the period key: a date (`2026-10-14`), an ISO week (`2026-W42`), a month (`2026-10`), a quarter (`2026-Q4`). A `review_occurrences` row is unique per `(mode, key)`, and the producer places the current occurrence idempotently. A clock change creates no second occurrence in a period and loses none; a change of the time in the schedule within the period creates no new occurrence.
- **No catching up.** An occurrence that has not taken place by the end of its window is retired with a named reason: the daily one by the end of its local day, the others by the time of the next occurrence.
- **The person is told about a review that did not take place.** A `failed` occurrence — both after exhausted attempts and when retired past the window — yields one system message: which review did not take place for which period, what went unreviewed, and that you can start the review in a Claude chat. Otherwise the silence of a review that did not take place would be the same as the silence of a review with no findings. This holds for every review, the daily one too (`INV-105`).
- **The prerequisite is a delivery channel and the runner.** The main result of a review is a packet for the person; without a channel a review would be a run that nobody sees, and the expiry of proposals rests on the delivered packet (ADR 0039). Without the runner (`RUNNER_ENABLED`) an occurrence would only wait for the end of its window and become a failure though nothing has broken. Without a configured channel or runner the occurrence producer places no occurrences and says so once in the log.
- **The queue** is a `RunRows` description over `review_occurrences` (ADR 0018): the time is `due_at`, the origin is `review_schedule`. The budget exemption and the priority class are set by the contract.
- **The trigger envelope** is the third variant of the origin, next to the event and the continuation: `type` (`review.<mode>`), `event_id` (`review:<mode>:<key>`), `timestamp` (the time of the occurrence) and `since`, the time of the last carried-out occurrence of this review, no more than two periods back. `since` gives the bound of “what has changed since the last review” as a point in time, not as a state (`INV-030`); pruning keeps the last carried-out occurrence of each review. The delivery key derived from `event_id` (ADR 0025) yields one packet per occurrence, and a retry of the run enqueues no second one.
- **The result:** the review's `scope` is `Review` with the occurrence's `event_id`; the detections are the labels the review puts into the packet.
- **The reads budgets and the turn ceiling** of a review are its own (`retrieval_budgets` and `run_profile`, per mode): a review covers several databases, and the shared limits of an evaluation run — the reads budget and the turn ceiling of the default profile — are too small for it. The turn ceiling is derived from the budget: a run makes about one call per turn, so the ceiling has room for the reads budget, the Skill files the review opens first, the steps the run always takes, and a reserve for App calls (proposals, continuations, reading proposals). The model, the effort and the per-run cost safeguard (`maxBudgetUsd`) are shared with the other modes (ADR 0008, ADR 0012): they are differentiated by calibration.
- **Domain dates** are read by the same time rule. A `Date` without a time of day comes due at the start of its local day; a `Deadline` without a time of day expires at the end of its day. A value with a time of day but no offset is local time in the time zone of the date itself, and in `APP_TIMEZONE` where the date has none.

**Rejected:**

- **Cron expressions.** A cron library has its own semantics for clock changes, different from the App's rule for day boundaries, and the system would have two notions of time. The cron grammar is broader than the person needs.
- **An occurrence as an instant.** An instant shifts with a clock transition and with an edit of the schedule: the same review would appear twice or vanish.
- **Catching up on missed reviews.** After an App outage yesterday's Daily Control would arrive today, and the missed ones would arrive in a batch.
- **A review in the continuation queue.** A continuation row is a thread or `(page, reason_code)`, and the reason is the thread's technical reason; a review has neither, and a new reason would blur the `reason_codes` vocabulary. A new queue on `RunRowSource` costs a table and a description (ADR 0018).
- **A shared turn ceiling.** The reads budget of the Weekly Control Review alone exceeds the shared turn ceiling: the review would be aborted before the packet, and the occurrence would fail, leaving the person with nothing.
- **Candidates from the App in the envelope.** A list of pages selected by the App and placed in the envelope is context gathered in advance, while the model must read the state itself (`INV-030`). The review reads the databases itself.

## Consequences

- The `reviews/` module: the config namespace, `review_occurrences`, the occurrence producer, and a run source in the `scheduling/` list (`INV-080`: a service and one source).
- `run_frames` and `DISPATCHED_MODES` name the four reviews, and the plugin's run entry has four frames (`INV-037`).
- `trigger_envelope` in the contract lists the fields of each variant of the envelope separately.
- The norm for recurrence is `docs/2-system.md` § “Schedule and recurrence”.
- `INV-103`: one review occurrence per period, even across a clock change.

## Cost

- A missed review is lost: the next one comes on schedule.
- The grammar cannot express “every two weeks” or “twice a day”; that is a new decision.
- Without a delivery channel there are no reviews at all.
- A review spends the plan quota shared with interactive work and occupies the single run slot: a run that answers the person and arrives during a review waits for the review to end.
