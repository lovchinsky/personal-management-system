import { GATE_LABEL, scenariosOf, shortOf, type ScenarioInfo, type Suite } from './m6-scenarios';

/** Lists the names of the suite's scenarios as written in `--only`: `U1` for `U1_commitment`. */
const namesOf = (suite: Suite): string[] => scenariosOf(suite).map((info) => shortOf(info.id));

/** The most trials the gate conducts per scenario: more would spend quota without a new answer. */
const MAX_TRIALS = 9;

/** How the gate is launched: which scenarios, how many trials and whether to read held-out. */
export interface GateOptions {
  /** The suite of scenarios the command conducts: each suite has its own gate command. */
  readonly suite: Suite;
  /** Only these scenarios (`U1`, `W1`…); `null` means all. */
  readonly only: readonly string[] | null;
  /** How many times each blocking scenario is conducted. */
  readonly trials: number;
  /**
   * How many times each recorded scenario is conducted: once by default, because it is only
   * recorded.
   */
  readonly recordedTrials: number;
  /** A model-free check only: no scenario is launched and no quota is spent. */
  readonly preflight: boolean;
  /** Without the scenarios that are not read while the Skill text is iterated on. */
  readonly withoutHeldOut: boolean;
  /**
   * The operator is present: they resolve threads in Notion when the gate asks. Only the M8 suite
   * has such a step.
   */
  readonly manual: boolean;
}

/** Suites whose scenarios have a step for the person. */
const MANUAL_SUITES: readonly Suite[] = ['m8'];

/**
 * Parses the names from `--only`: at least one, and each known. Otherwise the launch would select
 * zero scenarios and call it a run.
 */
function onlyOf(suite: Suite, list: string): readonly string[] {
  const names = list.split(',').filter((name) => name.length > 0);

  if (names.length === 0) throw new Error(`gate ${GATE_LABEL[suite]}: --only names no scenario`);

  const known = namesOf(suite);

  for (const name of names) {
    if (!known.includes(name)) {
      throw new Error(`gate ${GATE_LABEL[suite]}: unknown scenario ${name}`);
    }
  }

  return names;
}

/**
 * Returns the scenarios of the launch: all of the suite or those named in `--only`, minus held-out
 * under `--without-held-out`.
 */
export function selectionOf(
  options: Pick<GateOptions, 'suite' | 'only' | 'withoutHeldOut'>,
): readonly ScenarioInfo[] {
  return scenariosOf(options.suite).filter(
    (info) =>
      (options.only === null || options.only.includes(shortOf(info.id))) &&
      !(options.withoutHeldOut && info.heldOut),
  );
}

/**
 * Parses the number of trials from the `--trials` or `--recorded-trials` argument: an integer from
 * one to the limit.
 */
function trialsOf(suite: Suite, flag: string, value: string): number {
  const trials = Number(value);

  if (!Number.isInteger(trials) || trials < 1 || trials > MAX_TRIALS) {
    throw new Error(
      `gate ${GATE_LABEL[suite]}: ${flag} takes a whole number from 1 to ${MAX_TRIALS}`,
    );
  }

  return trials;
}

/**
 * Parses the arguments of the suite's gate command (M6 by default): `--only=U1,W1`, `--trials=3`,
 * `--recorded-trials=3`, `--preflight`, `--without-held-out`, and for M8 also `--manual`.
 *
 * Arguments, not environment: they are a choice of this launch, not a setting of the App, and a
 * launch with an error in a name must fail rather than silently run all scenarios.
 */
export function optionsOf(args: readonly string[], suite: Suite = 'm6'): GateOptions {
  let only: readonly string[] | null = null;
  let trials = 1;
  let recordedTrials = 1;
  let preflight = false;
  let withoutHeldOut = false;
  let manual = false;

  for (const arg of args) {
    if (arg === '--manual' && MANUAL_SUITES.includes(suite)) {
      manual = true;
    } else if (arg === '--preflight') {
      preflight = true;
    } else if (arg === '--without-held-out') {
      withoutHeldOut = true;
    } else if (arg.startsWith('--only=')) {
      only = onlyOf(suite, arg.slice('--only='.length));
    } else if (arg.startsWith('--trials=')) {
      trials = trialsOf(suite, '--trials', arg.slice('--trials='.length));
    } else if (arg.startsWith('--recorded-trials=')) {
      recordedTrials = trialsOf(suite, '--recorded-trials', arg.slice('--recorded-trials='.length));
    } else {
      throw new Error(`gate ${GATE_LABEL[suite]}: unknown argument ${arg}`);
    }
  }

  if (preflight && only !== null) {
    throw new Error(`gate ${GATE_LABEL[suite]}: --preflight and --only exclude each other`);
  }

  const options = { suite, only, trials, recordedTrials, preflight, withoutHeldOut, manual };

  // An empty selection is not a run: a verdict with no scenario proves nothing, yet is called a
  // success.
  if (selectionOf(options).length === 0) {
    throw new Error(
      `gate ${GATE_LABEL[suite]}: --only names only held-out scenarios, and --without-held-out drops them`,
    );
  }

  return options;
}

/**
 * Returns how many times a scenario is conducted: blocking, as many as requested; recorded, as many
 * as requested for them; and a model-free scenario once, because repeating a deterministic step
 * adds nothing.
 */
export function trialsFor(info: ScenarioInfo, options: GateOptions): number {
  if (info.models === 0) return 1;

  return info.tier === 'blocking' ? options.trials : options.recordedTrials;
}
