import { RunProvenance } from './provenance';
import { RunOutcome } from './run-outcome';
import { TriggerEnvelope } from './trigger-envelope';

/**
 * The address of the run's MCP server and the bearer for it. The bearer is a secret: it does not
 * reach logs, errors or the trace.
 */
export interface McpEndpoint {
  readonly url: string;
  readonly bearer: string;
}

/**
 * How a run is composed beyond what its mode provides: a system prompt and, when needed, another
 * model.
 *
 * An ordinary run has none of this: the Skill in the plugin directory defines its behavior, and
 * the profile is taken from the mode (ADR 0012). The gate command supplies it: its runs have
 * their own instructions, and one goes to a model that does not exist, to prove there is no
 * fallback (`INV-032`).
 */
export interface RunShape {
  readonly instructions: string;
  readonly model?: string;
}

/**
 * A run that has passed admission: the ledger row and the slot already belong to it.
 *
 * `id` is the identifier of that row. The runner takes it as the run's `sessionId`, so the session,
 * the origin and the trace are matched by construction, not by search.
 *
 * `provenance` is the run's origin. From it and `id` the `RunActor` is composed, the one on whose
 * behalf the run invokes the capabilities: the ledger does not store the continuation's reason, so
 * the origin would otherwise have no source.
 *
 * `expiresAt` is the expiry of the ticket: the tokens of the run's servers must live until then.
 *
 * `signal` fires before the ticket expires. The run's process has no timeout of its own, and
 * an expired ticket hands the slot to the next run: a run that outlived the ticket would work
 * alongside that next one. The runner is required to heed the signal.
 *
 * `app` is the run's App MCP: the address and bearer issued by the run's effects session
 * (`RunEffects`). The bearer lives exactly as long as the run and is a secret: it does not reach
 * logs, errors or the trace.
 *
 * `shape` is what the run has beyond its mode, if it has anything. The value belonging to one run
 * travels with it, rather than standing beside it as a state that someone must set before launch.
 */
export interface AdmittedRun {
  readonly id: string;
  readonly envelope: TriggerEnvelope;
  readonly provenance: RunProvenance;
  readonly expiresAt: Date;
  readonly signal: AbortSignal;
  readonly app: McpEndpoint;
  readonly shape?: RunShape;
}

/**
 * Why a run that did not fit within its ticket is aborted: the reason for the run's signal and for
 * the conclusion of that run. Both sides of the port give it as the reason: the dispatcher in the
 * signal and in the conclusion of a run whose outcome arrived in time when the ticket had already
 * run out; the runner in the conclusion of the aborted run.
 */
export const DEADLINE_REACHED = 'run reached its ticket deadline';

/** Whether the runner can currently execute a run, and if not, why. */
export type Readiness =
  { readonly ready: true } | { readonly ready: false; readonly reason: string };

/**
 * The port for a model run. The implementation is a runner on the Agent SDK in `claude/`
 * (ADR 0009), available only behind a switch (ADR 0013).
 *
 * `available` exists because “absent by construction” and “tried and failed” are different states,
 * and confusing them is costly: the first must neither spend the budget, nor conclude the origin
 * as processed, nor open the circuit breaker.
 *
 * A runner that is present can still be not ready: without a live Notion MCP grant a run has
 * nothing to work with. `readiness` reports that before admission, instead of a failure after it
 * (`INV-309`).
 *
 * The runner does not see the ledger row: it returns the outcome here, and the dispatcher writes
 * it.
 */
export interface RunLauncher {
  readonly available: boolean;
  readiness(): Promise<Readiness>;
  launch(run: AdmittedRun): Promise<RunOutcome>;
}

export const RUN_LAUNCHER = Symbol('RunLauncher');

/**
 * The token under which the launch adapter substitutes itself from outside `runs/`.
 *
 * `runs/` does not import the adapter: the adapter's module is global and exports this token, and
 * the port picks it up if it exists. Without an adapter the port is `AbsentRunLauncher`.
 */
export const RUN_LAUNCHER_ADAPTER = Symbol('RunLauncherAdapter');

/** Why a run has nothing to run on. */
export const NO_RUNNER = 'no runner is wired';

/**
 * The port for a wiring without a runner. It says so directly instead of reporting success
 * (`docs/2-system.md` § “Observability and cost”): otherwise windows and continuations would be
 * concluded as processed, the daily limit would be spent on nothing, and the circuit breaker would
 * never open.
 */
export class AbsentRunLauncher implements RunLauncher {
  readonly available = false;

  readiness(): Promise<Readiness> {
    return Promise.resolve({ ready: false, reason: NO_RUNNER });
  }

  /** Is unreachable while `available` is false: the dispatcher's run gates do not let a run in. */
  launch(run: AdmittedRun): Promise<RunOutcome> {
    return Promise.reject(new Error(`${run.id}: ${NO_RUNNER}`));
  }
}
