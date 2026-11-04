# ADR 0012 — Run profile — Opus 5.5 · high; an exhausted plan quota is a deferral, not a failure

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D12` |
| **Related** | ADR 0008 · ADR 0009 · ADR 0016 · ADR 0036 · ADR 0045 · `S7` · `INV-031` · `INV-032` · `INV-033` · `INV-084` · GAP-15 |

## Context

The run profile is an axis per mode (ADR 0008), and it needs values: the model, the effort and the per-run ceilings. The profile's model is constrained not only by the API but also by the CLI version that the SDK package carries: a CLI older than the version the model needs refuses that model before any request is made.

Runs spend the subscription's plan quota, which the owner also uses for interactive work. A run that hits the quota has not failed: its job is not broken; it cannot be done until the quota resets. The App's run budget — the daily limit and the circuit breaker — counts autonomous runs and failures, whereas the plan quota is a physical limit, the same for every run.

## Decision

**The default profile for all App-triggered modes:** the model `claude-opus-5-5`, `effort: high`, `thinking: adaptive`. The per-run limits — the turn ceiling `maxTurns` and the per-run cost safeguard `maxBudgetUsd` — and the remaining values live in [`contracts/canonical.yaml`](../../contracts/canonical.yaml), key `run_profile`. Reviews have their own turn ceiling (ADR 0036).

**An exhausted plan quota is an external state, not a failure.** A run that hits the quota or starts spending overage is aborted and ends as deferred (`deferred`):

- the origin row's attempt is given back, the reason is recorded in `last_error`, and the row's due time and status stay as they are; a run that reached Notion also releases the Notion hold (ADR 0045);
- the circuit breaker and the daily limit do not see such a run;
- the run ledger records the time to wait until (`deferred_until`): the reset time the run reported, or one hour when that time is unknown or has already passed. A time beyond the longest plan window (seven days) is clipped to that window.

Until that time the scheduler's run gates let no run through (ADR 0016), a budget-exempt run included, because the plan quota is physical, not a matter of policy.

## Consequences

- The SDK is pinned exactly, and a version bump is an explicit change to the manifest (GAP-15): the CLI version the SDK carries decides which models are available, so the profile's model is not raised without an SDK bump.
- The model check (`INV-033`) requires the profile's model to have done the main work; auxiliary CLI entries in `modelUsage` are not a fallback.
- The reason runs are stalled is visible in the run-gate transition log (`plan_quota` and the time), not in the origin rows (`INV-084`).

## Cost

- While the quota is exhausted, change evaluations, continuations and reviews wait instead of happening (risk `S7`).
- An unknown reset time costs an hour of waiting, even when the quota reset earlier.
- Under a subscription, `maxBudgetUsd` is the CLI's estimate, not a bill: it is a per-run cost safeguard, not a spending ceiling.
