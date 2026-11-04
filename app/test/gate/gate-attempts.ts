import { profileFor } from '../../src/claude/run-profile';
import { UNREAD_EVIDENCE } from '../../src/claude/runner/run-classifier';
import type { AttemptView } from '../../src/claude/runner/run-tap';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { AppError } from '../../src/platform/error/app-error';
import type { TraceView } from '../../src/runs/run-traces';
import { DEADLINE_REACHED } from '../../src/runs/run.launcher';
import type { TriggerEnvelope } from '../../src/runs/trigger-envelope';
import type { NotionRead } from './run-reads';

/**
 * How many times a scenario may be retried after an infrastructure failure. A violated claim is
 * not retried, because it is a result, not noise, and rerunning until green would hide the
 * violation.
 */
export const INFRASTRUCTURE_RETRIES = 1;

/**
 * What an attempt said about behavior:
 *
 * - `held` means the claim holds in full;
 * - `incomplete` means nothing contradicts the claim, but a step was not observed (a person is
 *   needed);
 * - `broke` means the claim is violated;
 * - `errored` means no conclusion about behavior was reached: an exception, a world failure, a
 *   run that was deferred or did not report.
 */
export type Trial = 'held' | 'incomplete' | 'broke' | 'errored';

/** The standing of a scenario over all its attempts. */
export type Standing = 'proven' | 'failed' | 'error' | 'not_proven';

/**
 * Returns the standing over the attempts that reached a conclusion. An infrastructure failure
 * before an attempt that reached a conclusion is noise and stays in the verdict, but proves
 * nothing. A violation prevails: `proven` is impossible while even one attempt violated the claim.
 */
export function standingOf(trials: readonly Trial[]): Standing {
  const judged = trials.filter((trial) => trial !== 'errored');

  if (judged.length === 0) return 'error';
  if (judged.includes('broke')) return 'failed';
  if (judged.includes('incomplete')) return 'not_proven';

  return 'proven';
}

/** The attempts of a scenario and the standing over them. */
interface Conducted<A> {
  readonly attempts: readonly A[];
  readonly standing: Standing;
}

/**
 * An infrastructure failure or a conduct failure, not a failure of the Skill's behavior: drift of
 * the Notion toolset, an API error, a denial by the run gates, a world that Notion has not
 * synchronized yet. A retry may help, so the gate retries the attempt once.
 */
export class InfrastructureError extends AppError {}

/**
 * A run that did not reach a conclusion about behavior (deferred, unfinished, deadline, Notion
 * allowance refusal). It is an infrastructure failure, but the run cost something and took time.
 * So the run trace travels with the error, along with what the runner reported, and the gate
 * writes an artifact from them. Otherwise a slow Skill that keeps its runs going until the
 * deadline would look efficient, and allowance refusals would vanish from the measurement.
 */
export class UnreachedRunError extends InfrastructureError {
  constructor(
    message: string,
    readonly step: string,
    readonly trace: TraceView,
    readonly seen?: AttemptView,
    readonly reads: readonly NotionRead[] = [],
  ) {
    super(message);
  }
}

/**
 * A harness fault, not an infrastructure failure. The scenario or world description is wrong: a key
 * the scenario did not create, a mode other than the one the scenario means, or a world that reads
 * differently than intended. A retry would not fix it and would only spend model runs, so the
 * attempt is not retried.
 */
export class HarnessError extends AppError {}

/**
 * Whose failure the attempt recorded: a harness fault (a retry is useless), an infrastructure
 * failure or an exception the gate did not expect. An unknown exception is retried just like an
 * infrastructure failure, but the verdict names it separately, because it is a hint to look for
 * the error in the gate code itself.
 */
export type ErrorCause = 'harness' | 'infrastructure' | 'unexpected';

export function errorCauseOf(error: unknown): ErrorCause {
  if (error instanceof HarnessError) return 'harness';

  return error instanceof InfrastructureError ? 'infrastructure' : 'unexpected';
}

/**
 * Requires the mode the run will use to be the one the scenario means: a run in another mode
 * would check another frame of the Skill. A mismatch is a harness fault, not a violation.
 */
export function expectMode(envelope: TriggerEnvelope, mode: string, step: string): void {
  if (envelope.mode !== mode) {
    throw new HarnessError(
      `${step}: the run would go in ${envelope.mode}, the scenario means ${mode}`,
    );
  }
}

/**
 * Conducts a scenario: retries only after `errored`, at most `retries` times, and only when
 * `retryable` does not say that a retry would fix nothing. `once` does not throw: it turns a world
 * or run failure into an `errored` attempt itself, because the cleanup after an attempt is its
 * job.
 */
export async function conducted<A>(
  once: () => Promise<A>,
  trialOf: (attempt: A) => Trial,
  retries: number = INFRASTRUCTURE_RETRIES,
  retryable: (attempt: A) => boolean = () => true,
): Promise<Conducted<A>> {
  const attempts: A[] = [];

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const latest = await once();

    attempts.push(latest);

    if (trialOf(latest) !== 'errored' || !retryable(latest)) break;
  }

  return { attempts, standing: standingOf(attempts.map(trialOf)) };
}

/** Counts how many scenarios are in each status, which shows that the verdict omitted nothing. */
export function summaryOf(
  scenarios: Readonly<Record<string, { readonly status: Standing } | undefined>>,
): Record<Standing, number> {
  const summary: Record<Standing, number> = { proven: 0, failed: 0, error: 0, not_proven: 0 };

  for (const verdict of Object.values(scenarios)) {
    if (verdict) summary[verdict.status] += 1;
  }

  return summary;
}

/**
 * Returns the largest ceiling of one run across modes. The cost comes from the profile, not from a
 * copy of the number.
 */
export function runCeilingUsd(): number {
  return Math.max(...Object.values(WorkflowMode).map((mode) => profileFor(mode).maxBudgetUsd));
}

/** Whose failure it is: the model's (behavior) or the environment's (infrastructure). */
export type FailureCause = 'behaviour' | 'infrastructure';

/**
 * The failure reasons that the environment reports, not the model. The classifier
 * (`run-classifier.ts`) builds a reason as a string, and the trace has no reason type, so
 * `gate-attempts.spec.ts` keeps this list in agreement with the classifier: it runs every branch of
 * `classify()`. Two reasons do not come from the classifier: the runner records an unavailable
 * Notion MCP before launch (`claude-runner.ts`), and the dispatcher records a write session
 * poisoned by a transient failure (`run.dispatcher.ts`, `staged-writes.ts`). The plan quota and an
 * expired ticket are not needed here: such traces have status `deferred` or `abandoned`, not
 * `failed`. An unknown reason counts as behavior, because a visible failure is better than a
 * hidden retry. So does `App effects not applied`, because the string does not say whether a
 * capability refused the model's request or Notion went down. The person reads the cause in the
 * artifact.
 */
const INFRASTRUCTURE_REASONS: readonly RegExp[] = [
  /^Notion MCP is unavailable to the run/,
  /^App effects not applied: the session was poisoned/,
  /^init check failed/,
  /^the run ended without a result/,
  /^the run reported no init/,
  /^the result belongs to session/,
  /^the run ended with no terminal reason/,
  /^model fell back/,
  /did no work/,
  /did the main work/,
];

/**
 * Returns whose failure the trace recorded: `null` means the run did not fail. A failure with
 * `terminal_reason: api_error`, toolset drift, a model substitution, a missing result or a
 * deadline that was hit is an infrastructure failure, and the Skill cannot be judged by it. An
 * invalid result, unread evidence, the turn or budget limit, a perimeter violation and writes that
 * were not applied are behavior.
 */
export function failureCauseOf(
  trace: Pick<TraceView, 'status' | 'reason' | 'terminalReason'>,
): FailureCause | null {
  if (trace.status !== 'failed') return null;

  const reason = trace.reason ?? '';

  return trace.terminalReason === 'api_error' ||
    reason === DEADLINE_REACHED ||
    INFRASTRUCTURE_REASONS.some((pattern) => pattern.test(reason))
    ? 'infrastructure'
    : 'behaviour';
}

/**
 * Checks whether the run failed specifically because the result cites unread evidence (`INV-036`).
 * The check “an invalid result leaves no effects” proves that only for a failure of this kind: any
 * other `failed` (an infrastructure failure, the turn limit) leaves no effects either, but says
 * nothing about the result.
 */
export function failedOnUnreadEvidence(trace: Pick<TraceView, 'status' | 'reason'>): boolean {
  return trace.status === 'failed' && (trace.reason ?? '').startsWith(`${UNREAD_EVIDENCE}:`);
}

/**
 * Returns `null` when a run reached a conclusion about behavior, and text stating the reason when
 * it did not. A run that did not reach one proves and refutes nothing. Runs that did not reach one
 * are those deferred on the plan quota, those that did not report, those still running and those
 * that failed for an infrastructure reason, along with a run to which Notion refused queries
 * because the workspace allowance was used up (`refusedQueries`): it would judge from what it did
 * not read. A `failed` because of an invalid result, unacceptable evidence or a perimeter
 * violation is a conclusion, because it is a matter of the Skill's conformance.
 */
export function unreached(
  trace: Pick<TraceView, 'id' | 'status' | 'reason' | 'terminalReason'>,
  refusedQueries = 0,
): string | null {
  if (trace.status !== 'completed' && trace.status !== 'failed') {
    return `the run ${trace.id} did not reach a verdict — ${trace.status}${trace.reason === null ? '' : `: ${trace.reason}`}`;
  }

  if (failureCauseOf(trace) === 'infrastructure') {
    return `the run ${trace.id} failed for a reason of the environment, not of the behaviour — ${trace.reason ?? 'no reason'}`;
  }

  return refusedQueries > 0
    ? `the run ${trace.id} was refused ${refusedQueries} Notion queries: the workspace query allowance was spent`
    : null;
}
