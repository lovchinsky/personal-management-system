# ADR 0008 — `RunProfile` per mode; model and effort shared until calibration

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D8` |
| **Related** | ADR 0012 · ADR 0036 · `S7` · `S8` · `INV-031` · `INV-032` · `INV-033` |

## Context

Several values configure an App-triggered run: the model, the reasoning effort, the turn ceiling and the per-run cost safeguard. Set in different places, they give a mode a combination nobody chose.

A cheaper model for a frequent mode would cut the cost, but choosing a model per mode has no basis without an eval dataset: a personal workspace is too small for statistics (risk `S8`). When the model and effort are the same in every mode, a failed run has only one explanation: a flaw in the Skill's instructions, not a lack of ability in the model.

## Decision

**A `RunProfile` is one configuration record per mode: the model, the effort and the run's limits make up one axis, not two.**

| Component | What it sets |
|---|---|
| `model` | the run's model |
| `effort` | the reasoning effort |
| `thinking` | the thinking mode |
| `maxTurns` | the ceiling on the number of turns in one run |
| `maxBudgetUsd` | the per-run cost safeguard |

The values live in [`contracts/canonical.yaml`](../../contracts/canonical.yaml), key `run_profile`: `default` is the profile of all modes, and `per_mode` is how a mode's profile differs from it (ADR 0012). The model, the effort and `maxBudgetUsd` are shared by all modes: per-mode differentiation is an output of calibration against evals (M10), not an input to it. Reviews have their own turn ceiling: it is derived from their reads budget (ADR 0036).

Reads budgets per domain (`retrieval_budgets`) belong to the same mode axis but are not an SDK option: the Skill and the run trace keep them.

## Consequences

- `model` and `effort` are passed explicitly on every run, not left on the CLI default (`INV-031`).
- There is no fallback to another model (`INV-032`): when the model is unavailable, the run fails with no partial effects.
- The run trace confirms that the profile's model did the main work (`INV-033`).
- `effort` is the only axis of depth: the profile carries no separate budget for reasoning.
- `maxTurns` and `maxBudgetUsd` are limits of a **single** run. The daily limit, the circuit breaker and the concurrency limit lie outside the profile: they are the App's run budget (`run_budget`).
- The frequency of a mode's runs is not a ground for a cheaper model: the cost is held down by the relevance gate, debounce and the run budget.
- A change of model is accepted only after eval results are compared.

## Cost

- Every relevant change is a call to the profile's shared model, even in a mode for which a cheaper model would be enough. The call counts against the plan quota, which the owner shares with interactive work (risk `S7`), and the cost is bounded by the run budget, not by the profile.
