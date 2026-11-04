import type { INestApplicationContext } from '@nestjs/common';
import type { Conductors } from './m6-conduct';
import type { GateOptions } from './m6-options';
import type { Check } from './m6-preflight';
import type { ScenarioInfo, Suite } from './m6-scenarios';
import { M6World } from './m6-world';
import { lifecycleChecks } from './m7-preflight';
import { m8Conductors } from './m8-conduct';
import { m8Checks } from './m8-preflight';
import { M8World } from './m8-world';
import { m9Conductors } from './m9-conduct';
import { m9Checks } from './m9-preflight';
import { M9World } from './m9-world';

/**
 * A suite of scenarios as the framework conducts it (`m6-gate.ts`): the world, its own model-free
 * checks, the procedure conductors and what the suite deliberately leaves between runs. The
 * framework knows nothing else about suites: a new suite is a new entry in `SUITES`, not one more
 * condition in every framework step.
 */
interface SuiteSetup {
  readonly world: M6World;
  /**
   * Returns the suite's checks before the shared ones: the M8 environment and the M9 queues must
   * be checked first.
   */
  checksBefore(selected: readonly ScenarioInfo[], run: string): Promise<Check[]>;
  /**
   * Returns the suite's checks after the shared ones, because the M7 memory-lifecycle check
   * examines the built worlds.
   */
  checksAfter(selected: readonly ScenarioInfo[], run: string): Promise<Check[]>;
  /** Returns the suite's procedure conductors; the framework adds the shared W1 chain. */
  conductors(options: GateOptions): Conductors;
  /** What the suite leaves between runs beyond what all suites share. */
  readonly unmanaged: readonly string[];
}

const NONE = (): Promise<Check[]> => Promise.resolve([]);

/** Builds a suite with no checks or procedures of its own: the M6 world and the shared parts. */
function plain(world: M6World): SuiteSetup {
  return {
    world,
    checksBefore: NONE,
    checksAfter: NONE,
    conductors: () => ({}),
    unmanaged: [],
  };
}

/** Receipts of Notion events that the gate fed in on behalf of the person. */
const NOTION_EVENT_RECEIPTS = 'webhook receipts of the simulated Notion events (random event ids)';

/** What the M8 suite leaves between runs: what it planted and the receipts of the events fed in. */
const M8_UNMANAGED: readonly string[] = [
  'the stale Inbox items planted for gate M8 (infra/gate/fixtures.yaml): they stay between runs, and every attempt restores them to their declared state',
  NOTION_EVENT_RECEIPTS,
];

/**
 * Each suite over the gate application: the factory closes over its own world, so the world types
 * do not mix.
 */
export const SUITES: Readonly<Record<Suite, (app: INestApplicationContext) => SuiteSetup>> = {
  m6: (app) => plain(new M6World(app, 'm6')),
  m7: (app) => {
    const world = new M6World(app, 'm7');

    return {
      ...plain(world),
      checksAfter: (selected, run) => lifecycleChecks(world, selected, run),
    };
  },
  m8: (app) => {
    const world = new M8World(app, 'm8');

    return {
      world,
      checksBefore: (selected, run) => m8Checks(world, selected, run),
      checksAfter: NONE,
      conductors: (options) => m8Conductors(world, options.manual),
      unmanaged: M8_UNMANAGED,
    };
  },
  m9: (app) => {
    const world = new M9World(app, 'm9');

    return {
      world,
      checksBefore: (selected, run) => m9Checks(world, selected, run),
      checksAfter: NONE,
      conductors: () => m9Conductors(world),
      unmanaged: [NOTION_EVENT_RECEIPTS],
    };
  },
};
