import { FakeGbrain } from '../fixtures/fake-gbrain.fixture';
import { worldThat } from '../fixtures/m6-probe-world.fixture';
import { optionsOf, trialsFor } from '../gate/m6-options';
import { scenariosOf, shortOf } from '../gate/m6-scenarios';
import { runsOf } from '../gate/m6-verdict';
import { lifecycleChecks } from '../gate/m7-preflight';
import { describeCatalog, sectionOf } from './gate-docs';

/**
 * The prose of gate M7 in `infra/GATE.md` and the plan agrees with the scenario catalog: ids,
 * tiers, held-out, the number of checks and cost (`gate-docs.ts`).
 */

/**
 * Returns the section of `infra/GATE.md` about gate M7, from its heading to the section of the
 * next gate.
 */
const gate = (): string =>
  sectionOf('infra/GATE.md', '## Gate M7', '\n## Gate M8', 'section on gate M7');

/** Returns the block of the plan about gate M7, from its heading to the blockers. */
const plan = (): string =>
  sectionOf('docs/5-plan.md', '**Gate M7 check.**', '**Blockers:**', 'block on gate M7');

const M7_SCENARIOS = scenariosOf('m7');

describeCatalog(M7_SCENARIOS, {
  gate,
  plan,
  rowPattern: /^\| H\d+\b/,
  gateName: 'infra/GATE.md § “Gate M7”',
  planName: 'docs/5-plan.md (gate M7)',
});

describe('infra/GATE.md § “Gate M7” on tiers, held-out, checks and cost', () => {
  it("--without-held-out removes exactly the scenarios named in the flag's description", () => {
    const bullet = /`--without-held-out` removes ([^.]*)\./.exec(gate());
    const named = [...(bullet?.[1] ?? '').matchAll(/`(\w+)`/g)].map((match) => match[1]);
    const heldOut = M7_SCENARIOS.filter((info) => info.heldOut).map((info) => shortOf(info.id));

    expect(bullet).not.toBeNull();
    expect(named.sort()).toEqual([...heldOut].sort());
  });

  /**
   * How many runs a full gate run with three trials takes is what the operator plans the quota
   * from.
   */
  it('“about 29 runs” really is a full gate run with three trials', () => {
    const options = optionsOf(['--trials=3'], 'm7');
    const runs = M7_SCENARIOS.reduce(
      (sum, info) => sum + runsOf(info) * trialsFor(info, options),
      0,
    );

    expect(runs).toBe(29);
    expect(gate()).toMatch(/about 29 runs/);
  });

  it('the table of model-free checks has a row for every check in the code', async () => {
    const checks = await lifecycleChecksNames();
    const table = gate().split('| Check | What it proves |')[1] ?? '';
    const block = table.trim().split('\n\n')[0] ?? '';
    const rows = block.split('\n').slice(1);

    expect(rows).toHaveLength(checks.length);
  });
});

/**
 * Returns the names of the code checks, which run without Notion and the model against the probe
 * world.
 */
async function lifecycleChecksNames(): Promise<string[]> {
  const world = await worldThat({ gbrain: new FakeGbrain() });
  const quick = { attempts: 1, pauseMs: 0, sleep: () => Promise.resolve() };

  return (await lifecycleChecks(world, M7_SCENARIOS, '4821', quick)).map((check) => check.check);
}
