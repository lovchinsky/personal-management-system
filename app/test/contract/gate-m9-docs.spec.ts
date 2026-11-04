import { optionsOf, trialsFor } from '../gate/m6-options';
import { scenariosOf } from '../gate/m6-scenarios';
import { runsOf } from '../gate/m6-verdict';
import { M9_CHECK_COUNT } from '../gate/m9-preflight';
import { repoFile } from './contracts';
import { describeCatalog, sectionOf } from './gate-docs';

/**
 * The prose of gate M9 in `infra/GATE.md` and the plan agrees with the scenario catalog and the
 * model-free checks (`gate-docs.ts`).
 */

/**
 * Returns the section of `infra/GATE.md` about gate M9, from its heading to the end of the file,
 * because it is the last section.
 */
const gate = (): string => sectionOf('infra/GATE.md', '## Gate M9', null, 'section on gate M9');

/**
 * Returns the criteria of gate M9: the last “Gate. It is proven that” list before the block of its
 * check.
 */
const criteriaOf = (): string => {
  const text = repoFile('docs/5-plan.md');
  const check = text.indexOf('**Gate M9 check.**');
  const from = text.lastIndexOf('**Gate.** It is proven that:', check);

  if (check < 0 || from < 0) throw new Error('docs/5-plan.md has no criteria of gate M9');

  return text.slice(from, check);
};

/** Returns the block of the plan about gate M9, from its heading to the blockers. */
const plan = (): string =>
  sectionOf('docs/5-plan.md', '**Gate M9 check.**', '**Blockers:**', 'block on gate M9');

const M9_SCENARIOS = scenariosOf('m9');

describeCatalog(M9_SCENARIOS, {
  gate,
  plan,
  rowPattern: /^\| AP\d\b/,
  gateName: 'infra/GATE.md § “Gate M9”',
  planName: 'docs/5-plan.md (gate M9)',
});

describe('infra/GATE.md § “Gate M9” and the plan on the checks and numbers of gate M9', () => {
  /**
   * How many runs an acceptance run takes is what the operator plans the quota and the daily
   * limit from.
   */
  it('“19 model runs” really is a full gate run with three trials', () => {
    const options = optionsOf(['--trials=3'], 'm9');
    const runs = M9_SCENARIOS.reduce(
      (sum, info) => sum + runsOf(info) * trialsFor(info, options),
      0,
    );

    expect(runs).toBe(19);
    expect(gate()).toMatch(/19\s+model runs/);
  });

  it('the table of model-free checks has a row for every check in the code', () => {
    const table = gate().split('| Check | What it proves | Blocks |')[1] ?? '';
    const block = table.trim().split('\n\n')[0] ?? '';

    expect(block.split('\n').slice(1)).toHaveLength(M9_CHECK_COUNT);
  });

  /**
   * The map “criterion → proven by” must name every criterion of the milestone gate and no others.
   */
  it('the evidence map names every criterion of gate M9 exactly once', () => {
    const criteria = (criteriaOf().split('**Gate.** It is proven that:')[1] ?? '')
      .split('\n\n')[1]
      ?.split('\n')
      .flatMap((line) => /^(\d+)\. /.exec(line)?.[1] ?? []);
    const mapped = plan()
      .split('\n')
      .flatMap((line) => /^\| (\d+) /.exec(line)?.[1] ?? []);

    expect(criteria?.length).toBeGreaterThan(0);
    expect(mapped).toEqual(criteria);
  });
});
