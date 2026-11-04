import { FREE_ALLOWANCE } from '../gate/gate.config';
import { optionsOf, trialsFor } from '../gate/m6-options';
import { scenariosOf } from '../gate/m6-scenarios';
import { runsOf } from '../gate/m6-verdict';
import { STALE_AFTER_DAYS } from '../gate/m8-fixtures';
import { M8_CHECK_COUNT } from '../gate/m8-preflight';
import { canonical } from './contracts';
import { describeCatalog, sectionOf } from './gate-docs';

/**
 * The prose of gate M8 in `infra/GATE.md` and the plan agrees with the scenario catalog:
 * scenarios, tiers, checks, cost and the numbers the gate rests on (`gate-docs.ts`).
 */

/**
 * Returns the section of `infra/GATE.md` about gate M8, from its heading to the section of gate
 * M9.
 */
const gate = (): string =>
  sectionOf('infra/GATE.md', '## Gate M8', '\n## Gate M9', 'section on gate M8');

/**
 * Returns the section of `infra/GATE.md` about the gate environment, where the Notion query
 * allowance is described.
 */
const environment = (): string =>
  sectionOf('infra/GATE.md', '## Gate environment', '## Running the gate', 'gate environment');

/** Returns the block of the plan about gate M8, from its heading to the blockers. */
const plan = (): string =>
  sectionOf('docs/5-plan.md', '**Gate M8 check.**', '**Blockers:**', 'block on gate M8');

const M8_SCENARIOS = scenariosOf('m8');

describeCatalog(M8_SCENARIOS, {
  gate,
  plan,
  rowPattern: /^\| (C|D|W|S|SW|X|DP)\d+\b/,
  gateName: 'infra/GATE.md § “Gate M8”',
  planName: 'docs/5-plan.md (gate M8)',
});

describe('infra/GATE.md § “Gate M8” on checks, cost and gate numbers', () => {
  /**
   * How many runs a full gate run with three trials takes is what the operator plans the quota
   * from.
   */
  it('“17 model runs” really is a full gate run with three trials', () => {
    const options = optionsOf(['--trials=3'], 'm8');
    const runs = M8_SCENARIOS.reduce(
      (sum, info) => sum + runsOf(info) * trialsFor(info, options),
      0,
    );

    expect(runs).toBe(17);
    expect(gate()).toMatch(/17 model runs/);
  });

  it('the table of model-free checks has a row for every check in the code', () => {
    const table = gate().split('| Check | What it proves |')[1] ?? '';
    const block = table.trim().split('\n\n')[0] ?? '';

    expect(block.split('\n').slice(1)).toHaveLength(M8_CHECK_COUNT);
  });

  /**
   * The staleness of Inbox items is a contract number: seeding sets the capture time past its
   * limit, so what is seeded is stale immediately, and `infra/GATE.md` says so.
   */
  it('what is seeded is stale immediately, past the staleness limit of the contract', () => {
    expect(STALE_AFTER_DAYS).toBe(canonical.reviewScope().inbox_stale_after_days);
    expect(gate()).toMatch(/stale immediately/);
    expect(gate()).toMatch(/one day past the\s+staleness limit/);
  });

  it('the Notion query allowance the gate enforces is the one the environment description names', () => {
    expect(environment()).toContain(`${FREE_ALLOWANCE} per hour`);
    expect(environment()).toContain(`no more than ${FREE_ALLOWANCE} such queries`);
  });
});
