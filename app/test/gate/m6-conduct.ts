import { messageOf } from '../../src/platform/error/message-of';
import type { RunProvenance } from '../../src/runs/provenance';
import {
  conducted,
  errorCauseOf,
  HarnessError,
  INFRASTRUCTURE_RETRIES,
  UnreachedRunError,
} from './gate-attempts';
import type { Claim } from './gate-claims';
import type { Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import {
  artifactOf,
  artifactOfTrace,
  dependencyChainClaim,
  SINGLE_CLAIMS,
  type Artifact,
} from './m6-claims';
import type { Evidence6 } from './m6-evidence';
import {
  CHAIN_SLOTS,
  memoryOf,
  remembers,
  repliesInChannel,
  SINGLE_RUNS,
  tagOf,
  variantNumber,
  worldOf,
  type AttemptId,
  type ScenarioId,
  type ScenarioInfo,
} from './m6-scenarios';
import type { Attempt6, Repetition } from './m6-verdict';
import type { EditTrigger, MemoryPage, ReplyTrigger, SingleRun } from './scenario-kit';
import { pageOf, type Ids } from './scenario-world';

/**
 * What the gate can do with the world for one scenario: exactly what the scenario needs. The live
 * world does it in Notion and `app_db`, a fake in a test does it without them, so the conduct
 * (attempts, retries, steps, stopping, artifacts) is checked without touching Notion or the model.
 */
export interface ScenarioPort {
  /** Returns the cleanup registry of a new attempt. */
  begin(): Residue;
  /** Builds the world and makes sure it reads the way it was meant. */
  build(pages: World, info: ScenarioInfo, residue: Residue): Promise<Ids>;
  /** Puts the scenario's memory pages into GBrain. */
  plant(pages: readonly MemoryPage[], ids: Ids, residue: Residue): Promise<void>;
  /** Waits until the Notion search for this query returns the world page with this key. */
  awaitFindable(ids: Ids, key: string, query: string): Promise<void>;
  /** The person changed page properties: the run proceeds the way the scheduler would take it. */
  edit(ids: Ids, trigger: EditTrigger, step: string, residue: Residue): Promise<Evidence6>;
  /** The person replied in the channel to a system message in its thread. */
  reply(ids: Ids, trigger: ReplyTrigger, id: AttemptId, residue: Residue): Promise<Evidence6>;
  /**
   * Runs a recheck with the deadline moved; it wakes the continuation the first run wrote. `null`
   * means there is no such continuation and nothing to wake.
   */
  recheck(
    ids: Ids,
    task: string,
    detection: Evidence6,
    residue: Residue,
  ): Promise<Evidence6 | null>;
  /** Cleans up after the attempt; does not throw, leaves the residue in the report. */
  clean(residue: Residue): Promise<readonly string[]>;
}

/** What the gate asks the session before each trial: whether a run can start at the moment. */
export interface Runnable {
  assertRunnable(provenance?: RunProvenance): Promise<void>;
}

/** How many consecutive trials may end in an infrastructure failure before the gate stops. */
const MAX_ENVIRONMENT_FAILURES = 2;

/**
 * The conductor of a procedure (`PROCEDURES`): the steps of one attempt over its own port, and the
 * claims from them. It builds the attempt's world itself because, before the world, the procedure
 * may need to check something else. The evidence of each model run is passed to `record`, so the
 * artifacts stay even if the attempt breaks down.
 */
export type Conductor = (
  info: ScenarioInfo,
  id: AttemptId,
  residue: Residue,
  record: (evidence: Evidence6) => Evidence6,
) => Promise<Claim>;

/** Procedure conductors already bound to their ports. */
export type Conductors = Readonly<Partial<Record<ScenarioId, Conductor>>>;

/** Conducts a single-run scenario: world, memory, event, and the claim about what the run left. */
async function conductSingle(
  info: ScenarioInfo,
  spec: SingleRun,
  port: ScenarioPort,
  id: AttemptId,
  residue: Residue,
  record: (evidence: Evidence6) => Evidence6,
): Promise<Claim> {
  const claim = SINGLE_CLAIMS[info.id];

  if (claim === undefined) throw new Error(`the scenario ${info.id} has no claim`);

  const tag = tagOf(id);
  const ids = await port.build(spec.world(tag), info, residue);

  await port.plant(memoryOf(info.id, tag, variantNumber(id)), ids, residue);

  if (spec.findable !== undefined) {
    await port.awaitFindable(ids, spec.findable.key, spec.findable.query(tag));
  }

  const evidence =
    spec.trigger.kind === 'edit'
      ? await port.edit(ids, spec.trigger, 'run', residue)
      : await port.reply(ids, spec.trigger, id, residue);

  return claim(record(evidence));
}

/**
 * Builds the conductors for the W1 chain: an event, the same event with a new id, and a recheck
 * with the deadline moved. The recheck is conducted only when the first step wrote a continuation
 * that can be woken.
 */
export function chainConductors(port: ScenarioPort): Conductors {
  return { W1_dependency_chain: chainConductor(port) };
}

function chainConductor(port: ScenarioPort): Conductor {
  return async (info, id, residue, record) => {
    const ids = await port.build(worldOf(info.id, tagOf(id)), info, residue);
    const trigger: EditTrigger = { kind: 'edit', page: 'waiting', slots: CHAIN_SLOTS };
    const detection = record(await port.edit(ids, trigger, 'W1', residue));
    const repeated = record(await port.edit(ids, trigger, 'R1', residue));
    const woken = await port.recheck(ids, pageOf(ids, 'waiting'), detection, residue);

    return dependencyChainClaim(detection, repeated, woken === null ? null : record(woken));
  };
}

/**
 * Returns the conductor of a scenario's procedure. A scenario with neither a single-run
 * description nor a conductor is a catalog fault.
 */
function conductorOf(info: ScenarioInfo, conductors: Conductors): Conductor {
  const conductor = conductors[info.id];

  if (conductor === undefined) {
    throw new HarnessError(`the scenario ${info.id} has neither a single run nor a conductor`);
  }

  return conductor;
}

/**
 * Conducts one attempt at a scenario and cleans up after itself. Everything collected before a
 * failure stays in the artifacts, because a failure in the middle of the chain must not erase the
 * runs that already happened.
 */
export async function conductAttempt(
  info: ScenarioInfo,
  port: ScenarioPort,
  conductors: Conductors,
  id: AttemptId,
): Promise<Attempt6> {
  const residue = port.begin();
  const artifacts: Artifact[] = [];
  const record = (evidence: Evidence6): Evidence6 => {
    artifacts.push(artifactOf(evidence));

    return evidence;
  };

  try {
    const spec = SINGLE_RUNS[info.id];
    const claim =
      spec === undefined
        ? await conductorOf(info, conductors)(info, id, residue, record)
        : await conductSingle(info, spec, port, id, residue, record);

    return { kind: 'judged', tag: tagOf(id), claim, artifacts };
  } catch (error) {
    // A run that did not reach a conclusion gave no evidence but had a cost, so its artifact stays.
    if (error instanceof UnreachedRunError) {
      artifacts.push(artifactOfTrace(error.step, error.trace, error.seen, error.reads));
    }

    return {
      kind: 'error',
      tag: tagOf(id),
      cause: errorCauseOf(error),
      error: messageOf(error),
      artifacts,
    };
  } finally {
    await port.clean(residue);
  }
}

/**
 * Conducts one trial: an attempt, and after an infrastructure failure another one under a new tag.
 * A harness fault in a scenario description is not retried, because a retry would not fix it and
 * would only spend one more model run.
 */
async function conductRepetition(
  info: ScenarioInfo,
  port: ScenarioPort,
  conductors: Conductors,
  run: string,
  trial: number,
): Promise<Repetition> {
  let attempt = 0;
  const next = (): Promise<Attempt6> => {
    const id: AttemptId = { run, scenario: info.id, trial, attempt };

    attempt += 1;

    return conductAttempt(info, port, conductors, id);
  };
  const { attempts } = await conducted(
    next,
    (result) => (result.kind === 'error' ? 'errored' : 'held'),
    INFRASTRUCTURE_RETRIES,
    (result) => result.kind === 'error' && result.cause !== 'harness',
  );

  return { number: trial, attempts };
}

/**
 * Describes the attempts of a trial that did not reach a conclusion: the tag, the cause and the
 * failure text, one line each. The log is all the operator sees during a gate run, and the verdict
 * stub of a stopped gate contains nothing that was conducted, so the cause of a failure is visible
 * as soon as the attempt fails.
 */
function failuresOf(repetition: Repetition): readonly string[] {
  return repetition.attempts.flatMap((attempt) =>
    attempt.kind === 'error'
      ? [`${attempt.tag} ${attempt.cause} error: ${attempt.error.replace(/\s+/g, ' ')}`]
      : [],
  );
}

/**
 * Returns why a run is impossible at the moment; `null` means it is possible. The run gates are
 * checked for the origin of the scenario's runs.
 */
async function refusalOf(gate: Runnable, info: ScenarioInfo): Promise<string | null> {
  try {
    await gate.assertRunnable(info.provenance);

    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * What a scenario depends on apart from the rest: GBrain memory or the channel. A failure of that
 * dependency alone does not mean the other scenarios fail too.
 */
type Dependency = 'GBrain' | 'channel';

function dependencyOf(info: ScenarioInfo): Dependency | null {
  if (remembers(info.id)) return 'GBrain';

  return repliesInChannel(info.id) ? 'channel' : null;
}

/**
 * Consecutive trials without a conclusion because of the environment, each with the dependency of
 * its scenario.
 */
type Streak = readonly (Dependency | null)[];

/**
 * Computes the streak after a trial. A conclusion about behavior breaks it; a harness fault in the
 * description of one scenario leaves it unchanged, because the other scenarios do not depend on
 * that fault.
 */
function streakAfter(
  streak: Streak,
  repetition: Repetition,
  dependency: Dependency | null,
): Streak {
  const final = repetition.attempts.at(-1);

  if (final === undefined || final.kind === 'judged') return [];

  return final.cause === 'harness' ? streak : [...streak, dependency];
}

/**
 * Decides what to do with the streak. Two consecutive trials without a conclusion because of the
 * environment stop the gate, because the rest would fail the same way. The exception is when both
 * depend on one and the same thing that could break separately (GBrain or the channel). Then the
 * scenarios with that dependency are blocked and the rest continue.
 */
function actionOn(streak: Streak): 'continue' | 'stop' | Dependency {
  const [first, second] = streak.slice(-MAX_ENVIRONMENT_FAILURES);

  if (streak.length < MAX_ENVIRONMENT_FAILURES) return 'continue';

  return first !== null && first !== undefined && first === second ? first : 'stop';
}

/** A scenario of the gate run and how many times to conduct it. */
export interface Planned {
  readonly info: ScenarioInfo;
  readonly trials: number;
}

/**
 * What was conducted, what was skipped because of a dependency that broke, and why the gate
 * stopped, if it did.
 */
export interface Conducted {
  readonly repetitions: Readonly<Partial<Record<ScenarioId, readonly Repetition[]>>>;
  readonly skipped: Readonly<Partial<Record<ScenarioId, string>>>;
  readonly stopped: string | null;
}

/**
 * Conducts the scenarios trial by trial: first the first trial of all scenarios, then the second.
 * A failure or a limit in the middle of a gate run leaves one or two complete trials of all
 * scenarios, not three for the first ones and none for the last; late effects (MCP drift, quota)
 * are spread evenly. The run gates are asked before each trial: a refusal stops the gate, because
 * every failure would cost an attempt, scenario after scenario. Two consecutive trials without a
 * conclusion because of the environment stop the gate too, except when both depend on the same one
 * of GBrain and the channel. Then only the scenarios with that dependency are skipped.
 */
export async function conductAll(
  plan: readonly Planned[],
  port: ScenarioPort,
  conductors: Conductors,
  gate: Runnable,
  run: string,
  log: (line: string) => void,
): Promise<Conducted> {
  const repetitions: Partial<Record<ScenarioId, Repetition[]>> = {};
  const skipped: Partial<Record<ScenarioId, string>> = {};
  const blocked = new Map<Dependency, string>();
  const most = Math.max(0, ...plan.map(({ trials }) => trials));
  let streak: Streak = [];

  for (let trial = 1; trial <= most; trial += 1) {
    for (const { info, trials } of plan) {
      if (trial > trials) continue;

      const dependency = dependencyOf(info);
      const reason = dependency === null ? undefined : blocked.get(dependency);

      if (reason !== undefined) {
        skipped[info.id] = reason;

        continue;
      }

      const refusal = await refusalOf(gate, info);

      if (refusal !== null) {
        log(`stopped before ${info.id} trial ${trial}: ${refusal}`);

        return { repetitions, skipped, stopped: refusal };
      }

      const repetition = await conductRepetition(info, port, conductors, run, trial);

      (repetitions[info.id] ??= []).push(repetition);
      streak = streakAfter(streak, repetition, dependency);

      for (const line of failuresOf(repetition)) log(`${info.id} trial ${trial}: ${line}`);

      log(`${info.id} trial ${trial}: ${repetition.attempts.at(-1)?.kind ?? 'none'}`);

      const action = actionOn(streak);

      if (action === 'stop') {
        const stopped = `${MAX_ENVIRONMENT_FAILURES} trials in a row ended without a verdict because of the environment`;

        log(`stopped after ${info.id} trial ${trial}: ${stopped}`);

        return { repetitions, skipped, stopped };
      }

      if (action !== 'continue') {
        blocked.set(action, `${action} failed in ${MAX_ENVIRONMENT_FAILURES} trials in a row`);
        streak = [];
        log(`${action} is out: the scenarios that need it are skipped`);
      }
    }
  }

  return { repetitions, skipped, stopped: null };
}
