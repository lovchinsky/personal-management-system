import { optionsOf, trialsFor } from '../gate/m6-options';
import { scenariosOf, shortOf } from '../gate/m6-scenarios';
import { runsOf } from '../gate/m6-verdict';
import { describeCatalog, sectionOf } from './gate-docs';

/**
 * The prose of gate M6 in `infra/GATE.md` and the plan agrees with the scenario catalog: ids,
 * tiers, held-out, adoption and cost (`gate-docs.ts`).
 */

/** Returns the section of `infra/GATE.md` about gate M6, from its heading to the next one. */
const gate = (): string =>
  sectionOf('infra/GATE.md', '## Gate M6', '\n## Gate M7', 'section on gate M6');

/**
 * Returns the block of the plan about gate M6, from its heading to the candidate comparison with
 * the baseline.
 */
const plan = (): string =>
  sectionOf(
    'docs/5-plan.md',
    '**Gate M6 check.**',
    '**Candidate comparison with the baseline.**',
    'block on gate M6',
  );

/**
 * The gate M6 scenarios: the catalog is shared with gate M7, and the prose of this section
 * describes only gate M6.
 */
const M6_SCENARIOS = scenariosOf('m6');

describeCatalog(M6_SCENARIOS, {
  gate,
  plan,
  rowPattern: /^\| [A-Z]\d\b/,
  gateName: 'infra/GATE.md § “Gate M6”',
  planName: 'docs/5-plan.md (gate M6)',
});

describe('infra/GATE.md § “Gate M6” on tiers, held-out, adoption and cost', () => {
  it('adoption is named by the same scenarios as in the catalog', () => {
    const named = /([A-Z]\d) and ([A-Z]\d) — `adoption`/.exec(gate());
    const adoption = M6_SCENARIOS.filter((info) => info.purpose === 'adoption').map((info) =>
      shortOf(info.id),
    );

    expect(named).not.toBeNull();
    expect([named?.[1], named?.[2]].sort()).toEqual([...adoption].sort());
  });

  it("--without-held-out removes exactly the scenarios named in the flag's description", () => {
    const bullet = /- `--without-held-out`[^(]*\(([^)]*)\)/s.exec(gate());
    const named = [...(bullet?.[1] ?? '').matchAll(/`(\w+)`/g)].map((match) => match[1]);
    const heldOut = M6_SCENARIOS.filter((info) => info.heldOut).map((info) => shortOf(info.id));

    expect(bullet).not.toBeNull();
    expect(named.sort()).toEqual([...heldOut].sort());
  });

  /**
   * How many runs a full gate run with three trials takes is what the operator plans the quota
   * from.
   */
  it('“about 55 runs” really is a full gate run with three trials', () => {
    const options = optionsOf(['--trials=3']);
    const runs = M6_SCENARIOS.reduce(
      (sum, info) => sum + runsOf(info) * trialsFor(info, options),
      0,
    );

    expect(runs).toBe(55);
    expect(gate()).toMatch(/about 55 runs/);
  });
});
