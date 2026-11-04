import {
  INFRASTRUCTURE_RETRIES,
  runCeilingUsd,
  summaryOf,
  type ErrorCause,
  type Standing,
} from './gate-attempts';
import type { GateResult } from './gate-boot';
import type { Claim, Kind, Polarity } from './gate-claims';
import type { cleanupVerdict } from './gate-cleanup';
import type { Artifact } from './m6-claims';
import { trialsFor, type GateOptions } from './m6-options';
import type { Check } from './m6-preflight';
import { GATE_LABEL, type ScenarioId, type ScenarioInfo, type Suite } from './m6-scenarios';

/** How many trials per blocking scenario the verdict needs to be accepted, not just received. */
const ACCEPTANCE_TRIALS = 3;

/**
 * Returns how many judged trials a scenario needs for acceptance: one without a model, because
 * repeating deterministic code over the same Notion yields no new answer.
 */
const acceptanceTrialsOf = (info: ScenarioInfo): number =>
  info.models === 0 ? 1 : ACCEPTANCE_TRIALS;

/** How many judged trials are needed for a scenario to be considered proven at all. */
const MIN_JUDGED = 2;

/** One attempt: its claim was judged, or it did not reach a conclusion about behavior. */
export type Attempt6 =
  | {
      readonly kind: 'judged';
      /** The attempt tag: the residue in Notion is found by it when the cleanup left something. */
      readonly tag: string;
      readonly claim: Claim;
      readonly artifacts: readonly Artifact[];
    }
  | {
      readonly kind: 'error';
      readonly tag: string;
      readonly cause: ErrorCause;
      readonly error: string;
      readonly artifacts: readonly Artifact[];
    };

/**
 * One trial of a scenario (`--trials`) together with the attempts that infrastructure failures
 * added; the last attempt is the conclusion of the trial.
 */
export interface Repetition {
  readonly number: number;
  readonly attempts: readonly Attempt6[];
}

/**
 * Returns the conclusion of a trial, which is its last attempt. A failure followed by a retry stays
 * visible but proves nothing.
 */
export function finalOf(trial: Repetition): Attempt6 {
  const last = trial.attempts.at(-1);

  if (last === undefined) throw new Error(`trial ${trial.number} has no attempt`);

  return last;
}

/** How many times an observation held among the judged attempts where it was present. */
interface ObservationShare {
  readonly item: string;
  readonly kind: Kind;
  /** Only for recognition: the polarity pools are compared separately. */
  readonly polarity?: Polarity;
  readonly held: number;
  readonly of: number;
  readonly ok: boolean;
}

/** How many trials of a scenario were requested, judged, errored and not run. */
interface TrialCount {
  readonly requested: number;
  readonly judged: number;
  readonly errored: number;
  readonly notRun: number;
}

/**
 * How many judged trials had all recognitions hold together, which the shares of single
 * observations do not show.
 */
interface WholeTrials {
  readonly held: number;
  readonly of: number;
  readonly ok: boolean;
}

interface Shares {
  readonly status: Standing;
  readonly trials: TrialCount;
  readonly observations: readonly ObservationShare[];
  readonly wholeTrials: WholeTrials;
  readonly unobserved: readonly string[];
}

/**
 * Checks whether an observation holds. An effect or perimeter observation holds when it holds in
 * every judged attempt; a recognition holds when it holds in at least two thirds (rounded up).
 */
function holdsOver(kind: Kind, held: number, of: number): boolean {
  return kind === 'recognition' ? held >= Math.ceil((2 * of) / 3) : held === of;
}

/** Returns the shares by observation, in the order in which they were first seen. */
function sharesOf(claims: readonly Claim[]): ObservationShare[] {
  const tally = new Map<string, { kind: Kind; polarity?: Polarity; held: number; of: number }>();

  for (const claim of claims) {
    for (const observation of claim.observations) {
      const seen = tally.get(observation.item) ?? {
        kind: observation.kind,
        ...(observation.kind === 'recognition' ? { polarity: observation.polarity } : {}),
        held: 0,
        of: 0,
      };

      tally.set(observation.item, {
        ...seen,
        held: seen.held + (observation.ok ? 1 : 0),
        of: seen.of + 1,
      });
    }
  }

  return [...tally].map(([item, { held, of, ...rest }]) => ({
    item,
    ...rest,
    held,
    of,
    ok: holdsOver(rest.kind, held, of),
  }));
}

/**
 * Computes the standing of a scenario from its trials. An infrastructure failure after a retry is
 * noise: the attempt is not judged but stays in the verdict. A violated effect or perimeter always
 * prevails: `proven` is impossible if the violation has happened even once. Recognition is judged
 * twice. Each observation holds in at least two thirds of the judged trials, and all recognitions
 * hold together in at least two thirds of the trials. Three trials that each miss something
 * different prove nothing, even though each observation alone has its two out of three. Trials that
 * were not conducted, steps that were not conducted and fewer than two judged trials (when more
 * than one was requested) result in `not_proven`, because one attempt does not prove a share and a
 * recognition failure on it is not yet a verdict.
 */
export function shareOf(trials: readonly Repetition[], requested: number): Shares {
  const finals = trials.map(finalOf);
  const claims = finals.flatMap((attempt) => (attempt.kind === 'judged' ? [attempt.claim] : []));
  const count: TrialCount = {
    requested,
    judged: claims.length,
    errored: finals.length - claims.length,
    notRun: Math.max(0, requested - finals.length),
  };
  const observations = sharesOf(claims);
  const unobserved = [...new Set(claims.flatMap((claim) => claim.unobserved))];
  const whole = wholeOf(claims);

  if (claims.length === 0) {
    return {
      status: finals.length === 0 ? 'not_proven' : 'error',
      trials: count,
      observations,
      wholeTrials: whole,
      unobserved,
    };
  }

  const enough = claims.length >= Math.min(requested, MIN_JUDGED);
  const hard = observations.some((share) => share.kind !== 'recognition' && !share.ok);
  const soft = observations.some((share) => share.kind === 'recognition' && !share.ok) || !whole.ok;
  const incomplete = unobserved.length > 0 || count.notRun > 0 || !enough;
  const status: Standing =
    hard || (soft && enough) ? 'failed' : incomplete || soft ? 'not_proven' : 'proven';

  return { status, trials: count, observations, wholeTrials: whole, unobserved };
}

/**
 * Counts the trials in which all recognitions hold together. Two thirds of the judged ones are
 * needed.
 */
function wholeOf(claims: readonly Claim[]): WholeTrials {
  const held = claims.filter((claim) =>
    claim.observations.every((observation) => observation.kind !== 'recognition' || observation.ok),
  ).length;

  return { held, of: claims.length, ok: held >= Math.ceil((2 * claims.length) / 3) };
}

/** An attempt for reading: what failed in it and what the runs left. */
interface AttemptRecord {
  readonly attempt: number;
  readonly tag: string;
  readonly outcome: 'judged' | 'error';
  readonly cause?: ErrorCause;
  readonly error?: string;
  readonly artifacts: readonly Artifact[];
}

/** A trial for reading: all its attempts, because a retry does not hide runs that used up quota. */
interface TrialRecord {
  readonly trial: number;
  readonly outcome: 'judged' | 'error';
  readonly failed: readonly string[];
  readonly attempts: readonly AttemptRecord[];
}

function attemptRecordOf(attempt: Attempt6, index: number): AttemptRecord {
  return attempt.kind === 'judged'
    ? { attempt: index, tag: attempt.tag, outcome: 'judged', artifacts: attempt.artifacts }
    : {
        attempt: index,
        tag: attempt.tag,
        outcome: 'error',
        cause: attempt.cause,
        error: attempt.error,
        artifacts: attempt.artifacts,
      };
}

export function recordOf(trial: Repetition): TrialRecord {
  const final = finalOf(trial);

  return {
    trial: trial.number,
    outcome: final.kind,
    failed:
      final.kind === 'judged'
        ? final.claim.observations
            .filter((observation) => !observation.ok)
            .map((observation) => observation.item)
        : [],
    attempts: trial.attempts.map(attemptRecordOf),
  };
}

/**
 * Efficiency: duration and calls come from completed runs, because a failed run is cut off
 * halfway.
 */
interface Efficiency {
  readonly runs: number;
  readonly failedRuns: number;
  readonly meanDurationSeconds: number | null;
  readonly meanCalls: Readonly<Record<string, number>>;
  readonly rejectedResults: number;
  readonly runsWithRejection: number;
  readonly failedNotionCalls: number;
  /** The highest number of turns in one run: the profile states the turn ceiling of the mode. */
  readonly maxTurns: number | null;
  /**
   * Notion query allowance: the highest and the mean number of calls counted against the allowance
   * per run, and how many queries Notion refused. These figures show whether a run fits into the
   * allowance of the workspace.
   */
  readonly maxMetered: number;
  readonly meanMetered: number | null;
  readonly refusedQueries: number;
  /** The longest notification packet, in characters against the message limit of the channel. */
  readonly maxPacketLength: number;
}

export function efficiencyOf(artifacts: readonly Artifact[]): Efficiency {
  const completed = artifacts.filter((item) => item.status === 'completed');
  const durations = completed.flatMap((item) =>
    item.durationMs === null ? [] : [item.durationMs],
  );
  const totals: Record<string, number> = {};

  for (const item of completed) {
    for (const [name, count] of Object.entries(item.calls)) {
      totals[name] = (totals[name] ?? 0) + count;
    }
  }

  const mean = (sum: number, of: number): number => Math.round((sum / of) * 10) / 10;

  return {
    runs: artifacts.length,
    failedRuns: artifacts.length - completed.length,
    meanDurationSeconds:
      durations.length === 0
        ? null
        : mean(
            durations.reduce((sum, value) => sum + value, 0),
            durations.length * 1_000,
          ),
    meanCalls: Object.fromEntries(
      Object.entries(totals).map(([name, sum]) => [name, mean(sum, completed.length)]),
    ),
    rejectedResults: artifacts.reduce((sum, item) => sum + item.rejectedResults, 0),
    runsWithRejection: artifacts.filter((item) => item.rejectedResults > 0).length,
    failedNotionCalls: artifacts.reduce((sum, item) => sum + item.failedNotionCalls, 0),
    maxTurns: artifacts.reduce<number | null>(
      (most, item) => (item.turns === null ? most : Math.max(most ?? 0, item.turns)),
      null,
    ),
    maxMetered: Math.max(0, ...artifacts.map((item) => item.metered)),
    meanMetered:
      artifacts.length === 0
        ? null
        : mean(
            artifacts.reduce((sum, item) => sum + item.metered, 0),
            artifacts.length,
          ),
    refusedQueries: artifacts.reduce((sum, item) => sum + item.refusedQueries, 0),
    maxPacketLength: Math.max(0, ...artifacts.flatMap((item) => item.packetLengths)),
  };
}

interface ScenarioVerdict extends Shares {
  readonly tier: ScenarioInfo['tier'];
  readonly purpose: ScenarioInfo['purpose'];
  readonly heldOut: boolean;
  readonly proves: readonly string[];
  /** Checks before the launch that stopped the scenario, so it was not conducted. */
  readonly blockedBy: readonly string[];
  /** Diagnostic words in the texts of the runs, how many times each: a person reads them. */
  readonly flags: Readonly<Record<string, number>>;
  readonly efficiency: Efficiency;
  readonly runs: readonly TrialRecord[];
}

/** Returns how many model runs go into one trial of a scenario, as the catalog states. */
export const runsOf = (info: ScenarioInfo): number => info.models;

/** Collects all artifacts of a scenario, from all attempts of all trials. */
function artifactsOf(trials: readonly Repetition[]): Artifact[] {
  return trials.flatMap((trial) => trial.attempts.flatMap((attempt) => attempt.artifacts));
}

/** Counts how many times each diagnostic word occurred in the texts of the runs. */
function flagsOf(artifacts: readonly Artifact[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const word of artifacts.flatMap((item) => item.flags)) {
    counts[word] = (counts[word] ?? 0) + 1;
  }

  return counts;
}

/**
 * Builds the verdict of a scenario from its trials. `blockedBy` lists the checks that stopped it.
 */
function scenarioVerdictOf(
  info: ScenarioInfo,
  trials: readonly Repetition[],
  requested: number,
  blocked: readonly string[],
): ScenarioVerdict {
  const artifacts = artifactsOf(trials);

  return {
    ...shareOf(trials, requested),
    tier: info.tier,
    purpose: info.purpose,
    heldOut: info.heldOut,
    proves: info.proves,
    blockedBy: blocked,
    flags: flagsOf(artifacts),
    efficiency: efficiencyOf(artifacts),
    runs: trials.map(recordOf),
  };
}

/**
 * Lists the checks before the launch that did not let a scenario be conducted: the failed ones
 * whose `blocks` name it.
 */
function blockedBy(checks: readonly Check[], id: ScenarioId): string[] {
  return checks
    .filter((check) => !check.ok && check.blocks.includes(id))
    .map((check) => check.check);
}

type Scenarios = Readonly<Partial<Record<ScenarioId, ScenarioVerdict>>>;

/**
 * Describes the perimeter violations. A violation is a regression of the App, not the Skill, so the
 * verdict lists them separately.
 */
function perimeterFailures(scenarios: Scenarios): string[] {
  return Object.entries(scenarios).flatMap(([id, verdict]) =>
    (verdict?.observations ?? [])
      .filter((share) => share.kind === 'perimeter' && !share.ok)
      .map((share) => `${id}: ${share.item} (${share.held}/${share.of})`),
  );
}

/**
 * Selects the scenarios of one tier, because the summary by status is counted separately for
 * blocking and recorded.
 */
function tierOf(
  scenarios: Scenarios,
  tier: ScenarioInfo['tier'],
): Readonly<Record<string, ScenarioVerdict | undefined>> {
  return Object.fromEntries(
    Object.entries(scenarios).filter(([, verdict]) => verdict?.tier === tier),
  );
}

/**
 * Returns the weekday in the time zone of the App, which “tomorrow” and “on Friday” in the person's
 * words depend on.
 */
function weekdayOf(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(at);
}

/**
 * What the gate knows about itself and its environment, which decides whether two verdicts can be
 * compared.
 */
interface Header {
  readonly at: Date;
  readonly timeZone: string;
  /**
   * The language the App itself writes to the person in: packet lengths depend on it (ADR 0042).
   */
  readonly language: string;
  readonly skill: string | null;
  readonly schema: string;
  readonly gate: string;
  /**
   * The Notion MCP query allowance of the gate workspace per hour: what the runs read depends on
   * it.
   */
  readonly notionQueryAllowance: number | 'unlimited';
}

/** What runGate gathered before the verdict. */
export interface VerdictInput {
  readonly options: GateOptions;
  readonly selected: readonly ScenarioInfo[];
  readonly preflight: readonly Check[];
  readonly conducted: Readonly<Partial<Record<ScenarioId, readonly Repetition[]>>>;
  /**
   * Scenarios that were not conducted because what they depend on broke midway through the launch.
   */
  readonly skipped: Readonly<Partial<Record<ScenarioId, string>>>;
  readonly stopped: string | null;
  readonly cleanup: ReturnType<typeof cleanupVerdict>;
  readonly header: Header;
}

/**
 * Checks whether the model-free check passed: every check passed and there was at least one. An
 * empty list checked nothing.
 */
const checked = (checks: readonly Check[]): boolean =>
  checks.length > 0 && checks.every((check) => check.ok);

/** The gate verdict as it goes to stdout. */
interface VerdictDocument {
  readonly gate: (typeof GATE_LABEL)[Suite];
  readonly at: string;
  readonly weekday: string;
  readonly timeZone: string;
  readonly language: string;
  readonly models: readonly string[];
  readonly skill: string | null;
  readonly schema: string;
  /** The digest of the gate: what it measures. */
  readonly digest: string;
  readonly notionQueryAllowance: number | 'unlimited';
  readonly ok: boolean;
  readonly accepted: boolean;
  readonly partial: boolean;
  readonly trials: number;
  readonly recordedTrials: number;
  readonly withoutHeldOut: boolean;
  /** Whether an operator was present: without one the steps for the person were not conducted. */
  readonly manual: boolean;
  readonly stopped: string | null;
  readonly cleanup: ReturnType<typeof cleanupVerdict>;
  readonly cost: string;
  readonly preflight: readonly Check[];
  readonly summary: {
    readonly blocking: Readonly<Record<Standing, number>>;
    readonly recorded: Readonly<Record<Standing, number>>;
  };
  readonly perimeterFailures: readonly string[];
  /**
   * Diagnostic words in the texts of all runs. They are not a gate, but acceptance is impossible
   * without reading through them.
   */
  readonly flags: Readonly<Record<string, number>>;
  readonly efficiency: Efficiency;
  readonly scenarios: Scenarios;
}

/**
 * Builds the gate verdict and the result for the exit code. Every selected scenario is present in
 * the verdict. One that was not conducted comes with status `not_proven` and the number of trials
 * not conducted, not with the absence of an entry. `ok` means the gate reached the end (not
 * `stopped`) and everything selected as blocking is proven. Under `--preflight`, `ok` means all
 * checks passed and there was at least one: an empty list (the runner is not ready, nothing is
 * selected) proves nothing, although `every` on it is true. `accepted` is `ok` plus the full suite
 * on a sufficient number of judged trials, so running a scenario on its own or a single trial
 * accepts nothing. Flags do not change `ok` (a word without the context of a diagnosis proves
 * nothing), but they revoke `accepted`, because texts for the person with diagnostic words are read
 * by a person.
 */
export function verdictOf(input: VerdictInput): {
  readonly document: VerdictDocument;
  readonly result: GateResult;
} {
  const { options, selected, preflight, conducted, skipped, stopped, cleanup, header } = input;
  const toConduct = options.preflight ? [] : selected;
  const scenarios: Scenarios = Object.fromEntries(
    toConduct.map((info) => [
      info.id,
      scenarioVerdictOf(info, conducted[info.id] ?? [], trialsFor(info, options), [
        ...blockedBy(preflight, info.id),
        ...(skipped[info.id] === undefined ? [] : [skipped[info.id] ?? '']),
      ]),
    ]),
  );
  const blocking = toConduct.filter((info) => info.tier === 'blocking');
  const proven =
    toConduct.length > 0 && blocking.every((info) => scenarios[info.id]?.status === 'proven');
  const ok = stopped === null && (options.preflight ? checked(preflight) : proven);
  const partial = options.only !== null || options.preflight || options.withoutHeldOut;
  const runs = toConduct.reduce((sum, info) => sum + runsOf(info) * trialsFor(info, options), 0);
  const artifacts = Object.values(scenarios).flatMap((verdict) =>
    (verdict?.runs ?? []).flatMap((record) => record.attempts.flatMap((item) => item.artifacts)),
  );
  const flags = flagsOf(artifacts);
  const accepted =
    ok &&
    !partial &&
    Object.keys(flags).length === 0 &&
    blocking.every((info) => (scenarios[info.id]?.trials.judged ?? 0) >= acceptanceTrialsOf(info));

  return {
    result: { ok, clean: cleanup.clean },
    document: {
      gate: GATE_LABEL[options.suite],
      at: header.at.toISOString(),
      weekday: weekdayOf(header.at, header.timeZone),
      timeZone: header.timeZone,
      language: header.language,
      models: [...new Set(artifacts.flatMap((item) => (item.model === null ? [] : [item.model])))],
      skill: header.skill,
      schema: header.schema,
      digest: header.gate,
      notionQueryAllowance: header.notionQueryAllowance,
      ok,
      accepted,
      partial,
      trials: options.trials,
      recordedTrials: options.recordedTrials,
      withoutHeldOut: options.withoutHeldOut,
      manual: options.manual,
      stopped,
      cleanup,
      cost: `up to ${runCeilingUsd()} USD of plan quota per run, ${runs} runs at best, at most ${
        runs * (INFRASTRUCTURE_RETRIES + 1)
      } (a retry follows an infrastructure error only)`,
      preflight,
      summary: {
        blocking: summaryOf(tierOf(scenarios, 'blocking')),
        recorded: summaryOf(tierOf(scenarios, 'recorded')),
      },
      perimeterFailures: perimeterFailures(scenarios),
      flags,
      efficiency: efficiencyOf(artifacts),
      scenarios,
    },
  };
}
