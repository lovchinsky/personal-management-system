import type { Standing, Trial } from './gate-attempts';
import type { Claim, Evidence } from './gate-claims';
import type { ScenarioId } from './m5-scenarios';

/**
 * Counts the model runs a scenario needs at best; a person (`--manual`) adds the closure steps.
 */
export function runsOf(id: ScenarioId, manual: boolean): number {
  switch (id) {
    case 'S1_dependency_slice':
      return manual ? 4 : 3;

    case 'S4_terminal_project':
      return 2;

    case 'S6_closure_decision':
      return manual ? 1 : 0;

    default:
      return 1;
  }
}

/** A run that a scenario conducted: it can be read in the trace by its id. */
export interface RunNote {
  readonly step: string;
  readonly id: string;
  readonly status: string;
  readonly reason: string | null;
}

/**
 * One attempt at a scenario and how it ended: the claim was judged, a step needs the person and
 * the person was not there, or no conclusion was reached. Runs conducted before a failure stay in
 * all three.
 */
export type Attempt =
  | { readonly kind: 'judged'; readonly claim: Claim; readonly runs: readonly RunNote[] }
  | {
      readonly kind: 'waiting';
      readonly unobserved: readonly string[];
      readonly runs: readonly RunNote[];
    }
  | { readonly kind: 'error'; readonly error: string; readonly runs: readonly RunNote[] };

export interface Verdict {
  readonly tier: 1 | 2;
  readonly proves: readonly string[];
  readonly status: Standing;
  /**
   * All the attempts, not only the last: an infrastructure failure followed by a retry shows in
   * the verdict.
   */
  readonly attempts: readonly Attempt[];
}

export const noteOf = (step: string, evidence: Evidence): RunNote => ({
  step,
  id: evidence.trace.id,
  status: evidence.trace.status,
  reason: evidence.trace.reason,
});

export function trialOf(attempt: Attempt): Trial {
  switch (attempt.kind) {
    case 'error':
      return 'errored';

    case 'waiting':
      return 'incomplete';

    case 'judged':
      if (!attempt.claim.ok) return 'broke';

      return attempt.claim.unobserved.length > 0 ? 'incomplete' : 'held';
  }
}
