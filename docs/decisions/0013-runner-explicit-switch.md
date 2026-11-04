# ADR 0013 — Runner — an explicit switch, off by default; the gate starts runs itself

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D13` |
| **Related** | ADR 0009 · ADR 0012 · ADR 0016 · ADR 0041 · `INV-309` |

## Context

With the runner enabled, every run origin — an evaluation window, a due continuation, a scheduled review, the person's reply — becomes a real call to the model, drawn from the plan quota that the owner shares with interactive work. Whether to spend that quota on App-triggered runs is decided by the installation owner, not by how the App is wired: capture, delivery and the App MCP for the chat work without runs.

A runner that is absent and a runner that tried and failed are different states. The first must not spend budget, conclude an origin as handled or open the circuit breaker.

## Decision

**The runner adapter is always wired in but available only behind the explicit switch `RUNNER_ENABLED`, `false` by default.** While the switch is off, the scheduler's run gates see the runner as absent (`runner_absent`) and let no run through (ADR 0016).

**The gate starts runs itself, through the same adapter.** The gate command brings up, in the gate environment (ADR 0041), a second App instance on a loopback port with the runner enabled and the background workers off (`WORKERS_ENABLED=false`). Gate runs have their own origin, `operator`: the scheduler does not claim it, and it is exempt from the budget.

**Rejected:** an App that is wired without a runner and reports success. Evaluation windows and continuations would be concluded as handled, the daily limit would be spent on nothing, and the circuit breaker would never open.

## Consequences

- An absent runner is neither a cost nor a failure: the origin waits without spending any budget, attempt or ledger row. As soon as the switch is on, the scheduler's first tick claims the due origins in run-priority order.
- Scheduled reviews are not placed without a runner: an occurrence that no run would conduct does not appear.
- Connector credentials are refreshed regardless of the switch. The provider kills the Notion MCP grant after thirty days without a refresh, and there may be no runs for weeks, so a keepalive worker keeps the grant alive.
- With the runner enabled, the App does not start without what a run needs: the subscription token, the plugin directory, the Notion MCP and GBrain addresses, and the GBrain client.

## Cost

- While the switch is off, evaluation windows and continuations only accumulate, and nothing tells the person so: a disabled runner is visible only in the run-gate transition log.
