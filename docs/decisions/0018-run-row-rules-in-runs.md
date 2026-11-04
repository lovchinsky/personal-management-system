# ADR 0018 — Run row rules live in `runs/`

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D18` |
| **Related** | ADR 0011 · ADR 0016 · ADR 0045 · `INV-082` · `INV-084` · `INV-091` |

## Context

A queue row that becomes a run goes through the same steps in every run queue:

- the attempt is recorded before the run, together with the status `running`;
- a completed run concludes the row if it did not change during the run, and returns a changed row to the queue with the attempt refunded;
- if no run took place, the row is released unchanged; after a failure, with a reason; when the plan quota is hit, with the attempt refunded; when Notion is unreachable, with the attempt refunded and a backoff pause (ADR 0045);
- the row's lease lasts as long as the run's ticket, and the attempt limit is a number from the run budget.

There are several run queues — evaluation windows, continuations, review occurrences — and each has the same settings: the status together with the attempt, the lease expiry, the attempt limit, the split into fresh and retried rows. A rule written separately in each queue diverges between the copies, and every new queue adds another one.

## Decision

**The rules of a run row are written once, in `runs/`. A run queue is a description supplied by its owner.**

- **`RunRowSource`** (`runs/run-row-source.ts`) implements the `RunSource` port for lease queues: retirement, candidates, claiming and every disposition after a run. It takes the lease expiry — the run ticket's expiry — and the attempt limit (`run_budget.work_row_max_attempts`) from `RunRowPolicy` (`runs/run-row.policy.ts`).
- **The queue description** (`RunRows`) is supplied by the owner itself: the table and statuses, the due-time column, the columns of the run classes, what “the row has not changed” means and what to write to a superseded row, its own retirement rules, the origin and the trigger envelope. The owner's source class is only a constructor that passes the description on.
- **The queue repository** keeps only the producer's work: evaluation windows absorb events, continuations place and move rows, and the review scheduler places occurrences.
- **The queue platform** (`platform/queue/`) is the lease mechanism for all the queues it serves, runs and delivery alike: claiming, the lease-owner fence, release, postponement, recording the attempt, retirement, pruning. It knows nothing of the rules of runs. The list of queue tables is closed (ADR 0011).
- **Concluded run rows** are pruned by maintenance through their sources: `done` rows are a copy of the run trace, `failed` rows stay as evidence.

## Consequences

- A new run queue is a table with an entry in the platform's list, a description and a source class. It does not repeat the rules of a run row.
- `INV-091`: the SQL that writes `attempt_count` or `last_attempt_at`, and the attempt limit, live only in `runs/` and `platform/queue/`.
- `INV-082`: only `platform/queue/` writes and compares the lease, while `runs/` uses its fence.
- The scheduler knows only the `RunSource` port (ADR 0016).

## Cost

- The source of a lease queue inherits the implementation of `RunRowSource`: it is one base class for all such queues.
- The queue description is one more concept, and its table must have the columns the rules rest on: `attempt_count`, `last_attempt_at`, `last_error`, `updated_at`, `notion_hold_until`, `notion_held_since` and a status with the values `running` and `done`.
