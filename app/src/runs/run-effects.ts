import { AppliedEffectKind, WorkflowMode } from '../generated/prisma/enums';
import { RunActor } from './actor';
import { RunProvenance } from './provenance';
import { McpEndpoint } from './run.launcher';

/** The grant that says on whose behalf and for how long a run talks to the App MCP. */
export interface EffectsGrant {
  readonly runId: string;
  /** The row of the mode → toolset matrix decides which App tools the run sees. */
  readonly mode: WorkflowMode;
  readonly provenance: RunProvenance;
  /**
   * The run's cause, the `event_id` of its trigger envelope: the effect keys are derived from it.
   */
  readonly cause: string;
  /** When the run started; the capabilities measure the run's limits from this time. */
  readonly startedAt: Date;
  /** The expiry of the run's ticket: after it the bearer is not accepted. */
  readonly expiresAt: Date;
  /**
   * The signal that the run must stop and report while the ticket is still valid. The run's
   * writes are applied only before the signal fires, because the conclusion must have time to
   * land in the ledger.
   */
  readonly deadline: AbortSignal;
}

/** Derives the actor on whose behalf the run acts in the capabilities from the run's grant. */
export function actorOf(grant: EffectsGrant): RunActor {
  return {
    kind: 'run',
    runId: grant.runId,
    mode: grant.mode,
    provenance: grant.provenance,
    startedAt: grant.startedAt,
  };
}

/**
 * An applied App effect, with the id of what it created or touched: an `app_db` row, a Notion
 * page or a Notion comment.
 *
 * There are as many kinds as there are traces the run's writes leave: a created page, a comment,
 * a page in the trash, a continuation, a proposal and a delivery.
 */
export interface AppliedEffect {
  readonly kind: AppliedEffectKind;
  readonly id: string;
}

/** An App MCP call that the App refused, and why. */
export interface RefusedCall {
  readonly tool: string;
  readonly reason: string;
}

/** What happened to the run's effects. */
export interface EffectsReport {
  /** What was applied, in the order of application. */
  readonly applied: readonly AppliedEffect[];
  readonly refused: readonly RefusedCall[];
  /** Why applying stopped. Absent means everything the run wrote was applied. */
  readonly failure?: string;
}

/**
 * A run's session in the App MCP: an address with a bearer and the writes waiting for the
 * conclusion.
 *
 * The run's writes are applied only when the run ended with a valid result (ADR 0014), so the
 * session ends with exactly one of two steps. Both close the session first, so a write that
 * arrives afterward is refused, not silently lost or applied without going through the
 * conclusion.
 */
export interface RunEffectsSession extends McpEndpoint {
  /**
   * Applies the run's writes in the order of kinds: conversions → comments → continuations →
   * proposals → deliveries. The first refusal stops applying, and the reason becomes `failure`,
   * not an exception.
   */
  commit(): Promise<EffectsReport>;
  /** Discards the run's writes. It does not throw, because the session only forgets them. */
  discard(): Promise<EffectsReport>;
}

/**
 * Port to the App's side of a run: the run gets its bearer from it, and the dispatcher gets the
 * decision about effects.
 *
 * `runs/` imports neither the App MCP nor the runner, so an adapter plugs itself in under
 * `RUN_EFFECTS_ADAPTER`, and without one `AbsentRunEffects` implements the port.
 */
export interface RunEffects {
  readonly available: boolean;
  open(grant: EffectsGrant): RunEffectsSession;
}

export const RUN_EFFECTS = Symbol('RunEffects');

/** The token under which the App MCP plugs itself in from outside `runs/`. */
export const RUN_EFFECTS_ADAPTER = Symbol('RunEffectsAdapter');

/**
 * There is no App MCP, so the run has nowhere to write.
 *
 * Wiring with a runner but no App MCP does not start (see `RunDispatcher`), so without a runner
 * nobody reaches `open`.
 */
export class AbsentRunEffects implements RunEffects {
  readonly available = false;

  open(grant: EffectsGrant): RunEffectsSession {
    throw new Error(`${grant.runId}: App MCP is absent, the run has nowhere to write`);
  }
}
