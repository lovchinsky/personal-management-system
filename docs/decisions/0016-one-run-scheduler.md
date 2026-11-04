# ADR 0016 — One run scheduler

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D16` |
| **Related** | ADR 0012 · ADR 0013 · ADR 0018 · `INV-080` · `INV-084` · `INV-085` · `INV-304` · `INV-309` |

## Context

Runs come from several queues — evaluation windows, continuations, review occurrences — and share one concurrency limit, one plan quota and one daily limit. Four requirements follow:

- **Run priority is decided in one place.** A snooze the person named does not wait for another queue to go through its autonomous evaluations, and the queues do not compete for a slot.
- **A denial does not rewrite the row.** The time in a continuation is often one the person named: a “remind me on Monday” that finds the run gates closed must stay Monday.
- **`running` means the run has started.** A row whose run has not started yet is not under a lease.
- **A dead Notion MCP grant is visible before the run.** A run without a grant would fail after spending the daily limit and the row's attempt.

## Decision

**One scheduler per process manages the runs. The run gates are its state, not the state of the rows. A row is claimed just before its run.**

- **Run sources.** Each run queue is a source behind a single port. A source retires rows that will do no more of their work, lists the due candidates, claims one row and disposes of it after the run.
- **Run gates.** Before claiming a row, the scheduler checks the gates:
  - the presence of the runner (ADR 0013) and its readiness, together with the Notion MCP grant;
  - the plan quota (ADR 0012);
  - the breaker and the daily limit, for autonomous work only;
  - a free slot.

  Closed gates write nothing to the rows: a row waits as it was. The App writes a change in the gates' state to the log once.
- **Run priority.** The scheduler takes a candidate by class ([`contracts/canonical.yaml`](../../contracts/canonical.yaml), key `run_priority`). Within a class a fresh row goes before a retried one, and among equals the earlier due time goes first. The classes, from the highest: the person is speaking; a time the person named; an item the person put in the Inbox; a scheduled review; autonomous work. Autonomous work is exactly the budgeted origins.
- **Claiming before the run.** A row is claimed by id once it has been decided that a run will happen for it. A denial that finds the row claimed (a race for a slot) releases it unchanged. The run's outcome is recorded on the row by the run-row rules (ADR 0018).

## Consequences

- No row is postponed by the gates: as soon as the gates open, the next tick claims the due origins.
- `INV-080`: a capability module exports a service and at most one run source.
- The invariants of the decision:
  - a run denial does not change the origin row (`INV-084`);
  - the contract sets the run priority (`INV-085`);
  - a dead grant is a denial that comes before budget and admission (`INV-309`).
- An origin row with the status `running` means that its run has started.

## Cost

- On every tick the scheduler checks the gates again: that is a few queries to the ledger and to the grant.
- The scheduler waits for the runs of one tick together. A slot that frees up earlier than the others is filled by the next tick.
- The reason a row waits is visible in the run-gate transition log, not in the row itself.
