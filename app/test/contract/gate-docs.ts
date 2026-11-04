import { shortOf, type ScenarioInfo } from '../gate/m6-scenarios';
import { repoFile } from './contracts';

/**
 * The gate scenario catalog is code; its descriptions in `infra/GATE.md` and the plan are prose.
 * The specs that keep the prose from falling behind the code share this module. It holds what is
 * the same for every set: slicing a section, the rows of the scenario table and the checks.
 */

/**
 * Returns the section of a file from the start line to the end line, or to the end of the file
 * when `end = null`. The absence of any named line is an error.
 */
export function sectionOf(file: string, start: string, end: string | null, what: string): string {
  const text = repoFile(file);
  const from = text.indexOf(start);
  const to = end === null ? text.length : text.indexOf(end, from);

  if (from < 0 || to < 0) throw new Error(`${file} has no ${what}`);

  return text.slice(from, to);
}

interface Row {
  readonly ids: readonly string[];
  readonly line: string;
}

/**
 * Reads the rows of the scenario table: the first cell holds comma-separated names (`U1`,
 * `N2, N3`).
 */
function rowsOf(text: string, pattern: RegExp): Row[] {
  return text
    .split('\n')
    .filter((line) => pattern.test(line))
    .map((line) => ({
      ids: (line.split('|')[1] ?? '').split(',').map((name) => name.trim()),
      line,
    }));
}

/** The prose of a set: where it lives and how to find the scenario rows in it. */
interface Prose {
  readonly gate: () => string;
  readonly plan: () => string;
  readonly rowPattern: RegExp;
  /** How the sections are named in test titles. */
  readonly gateName: string;
  readonly planName: string;
}

/**
 * The scenario tables in `infra/GATE.md` and the plan name every scenario of the set exactly once,
 * and the recorded row names exactly the recorded scenarios; the other rows are blocking.
 */
export function describeCatalog(scenarios: readonly ScenarioInfo[], prose: Prose): void {
  const names = scenarios.map((info) => shortOf(info.id));
  const tierOf = (name: string): string | undefined =>
    scenarios.find((info) => shortOf(info.id) === name)?.tier;

  describe.each([
    [prose.gateName, () => rowsOf(prose.gate(), prose.rowPattern)],
    [prose.planName, () => rowsOf(prose.plan(), prose.rowPattern)],
  ])('scenario table: %s', (_, rows) => {
    it('names every scenario of the catalog exactly once and nothing else', () => {
      expect(
        rows()
          .flatMap((row) => row.ids)
          .sort(),
      ).toEqual([...names].sort());
    });
  });

  it('the recorded row names exactly the recorded scenarios, and the other rows are blocking', () => {
    for (const row of rowsOf(prose.gate(), prose.rowPattern)) {
      const tiers = new Set(row.ids.map(tierOf));

      expect(tiers.size).toBe(1);
      expect(row.line.includes('recorded:')).toBe(tiers.has('recorded'));
    }
  });
}
