import { SCENARIOS } from './m5-scenarios';

/** Scenario names as they are written in `--only`: `S1` for `S1_dependency_slice`. */
const NAMES: readonly string[] = SCENARIOS.map((scenario) => scenario.id.split('_')[0] ?? '');

/** How the gate is launched: which scenarios, and whether a person is present. */
export interface GateOptions {
  /** Only these scenarios (`S1`, `S4`, `T2b`…); `null` means all. */
  readonly only: readonly string[] | null;
  /** Only a model-free check: no scenario is launched and no quota is spent. */
  readonly preflight: boolean;
  /** An operator is present: they resolve the threads in Notion when the gate asks. */
  readonly manual: boolean;
}

/**
 * Checks and returns the names from `--only`: at least one, and every one known; otherwise the
 * gate run would select zero scenarios and call that a run.
 */
function scenariosOf(list: string): readonly string[] {
  const names = list.split(',').filter((name) => name.length > 0);

  if (names.length === 0) throw new Error('gate M5: --only names no scenario');

  for (const name of names) {
    if (!NAMES.includes(name)) {
      throw new Error(`gate M5: unknown scenario ${name}`);
    }
  }

  return names;
}

/**
 * Reads the arguments of the gate M5 command: `--only=S1,S4`, `--preflight`, `--manual`.
 *
 * The options come from arguments, not the environment, because they are a choice for this gate
 * run, not an App setting. A gate run with a mistake in a name must fail, not silently run through
 * all the scenarios.
 */
export function optionsOf(args: readonly string[]): GateOptions {
  let only: readonly string[] | null = null;
  let preflight = false;
  let manual = false;

  for (const arg of args) {
    if (arg === '--manual') {
      manual = true;
    } else if (arg === '--preflight') {
      preflight = true;
    } else if (arg.startsWith('--only=')) {
      only = scenariosOf(arg.slice('--only='.length));
    } else {
      throw new Error(`gate M5: unknown argument ${arg}`);
    }
  }

  if (preflight && only !== null) {
    throw new Error('gate M5: --preflight and --only exclude each other');
  }

  return { only, preflight, manual };
}
