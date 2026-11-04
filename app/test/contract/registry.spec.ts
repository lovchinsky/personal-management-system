import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { Invariant, invariants, REPO_ROOT, repoFile } from './contracts';
import { describedElsewhere, Files, misnamed, misplaced, silent, SpecFile } from './registry';

/**
 * The invariant registry keeps its word.
 *
 * The `test` field says where the check lives, and it drifts silently: a path to someone else's
 * file, a file that does not name its ID, an acceptance row that points to a different test.
 * That is why the rules for the field are here, and why the census is in the `describe` title: a
 * number that has to be kept by hand goes stale at the first change.
 */
const entries = invariants();
const registryText = repoFile('contracts/invariants.yaml');

const exists = (path: string): boolean => existsSync(resolve(REPO_ROOT, path));
const repository: Files = { exists, read: repoFile };
const checked = entries.filter((entry) => entry.test !== null && exists(entry.test));
const lanes = ['ci-contract', 'eval', 'integration', 'manual'] as const;

const number = (entry: Invariant): number => Number(entry.id.slice(4));
const isCriterion = (entry: Invariant): boolean => number(entry) >= 201 && number(entry) <= 299;
const criteria = entries.filter(isCriterion);

const census = (subset: readonly Invariant[]): string =>
  lanes
    .map((lane) => `${lane} ${subset.filter((entry) => entry.verifiable_by === lane).length}`)
    .join(', ');

function specFiles(dir: string): string[] {
  const root = resolve(REPO_ROOT, dir);

  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => /(?:[.-]spec|\.eval)\.ts$/.test(name) && !name.includes('generated'))
    .map((name) => relative(REPO_ROOT, resolve(root, name)));
}

describe(`registry — entries: ${entries.length} (${census(entries)}); criteria: ${criteria.length} (${census(criteria)}); with an existing check: ${checked.length}`, () => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  it('identifiers are unique, and the header bands bound them exactly', () => {
    const bands = [...registryText.matchAll(/^#\s+INV-(\d{3})\.\.INV-(\d{3})\s/gm)].map(
      (match): [number, number] => [Number(match[1]), Number(match[2])],
    );
    const numbers = entries.map(number);
    const repeated = entries.filter((entry, index) => byId.get(entry.id) !== entries[index]);
    const outside = entries.filter(
      (entry) => !bands.some(([low, high]) => number(entry) >= low && number(entry) <= high),
    );
    const stale = bands.filter(([low, high]) => {
      const inBand = numbers.filter((n) => n >= low && n <= high);

      return Math.min(...inBand) !== low || Math.max(...inBand) !== high;
    });

    expect(bands.length).toBeGreaterThan(0);
    expect(repeated.map((entry) => entry.id)).toEqual([]);
    expect(outside.map((entry) => entry.id)).toEqual([]);
    expect(stale).toEqual([]);
  });

  /**
   * `INV-2NN` is the `NN`th criterion: the mapping to `SCEN-20-NN` rests on that, with no lookup
   * table.
   */
  it('a criterion has its own number and no origin; the rest have an origin', () => {
    const broken = entries.flatMap((entry) => {
      if (isCriterion(entry)) {
        return entry.mvp20_ordinal === number(entry) - 200 && entry.origin === undefined
          ? []
          : [entry.id];
      }

      return entry.mvp20_ordinal === undefined && entry.origin !== undefined ? [] : [entry.id];
    });

    expect(broken).toEqual([]);
  });

  it('related and same_as point to existing entries', () => {
    const dangling = entries.flatMap((entry) =>
      [...(entry.related ?? []), ...(entry.same_as ?? [])]
        .filter((id) => !byId.has(id))
        .map((id) => `${entry.id} → ${id}`),
    );

    expect(dangling).toEqual([]);
  });

  /** A path must not be invented for `manual`, and a restatement is tested on its original. */
  it('a path is absent exactly for manual entries and for restatements', () => {
    const mismatched = entries.filter(
      (entry) =>
        (entry.test === null) !== (entry.verifiable_by === 'manual' || entry.same_as !== undefined),
    );

    expect(mismatched.map((entry) => entry.id)).toEqual([]);
  });

  it('the check lives in the lane of its verifiable_by', () => {
    expect(misplaced(entries)).toEqual([]);
  });

  /** Otherwise the path would point to someone else's check, and coverage would be an illusion. */
  it('an existing check file names its invariant', () => {
    expect(silent(entries, repository)).toEqual([]);
  });

  it('the planned location is named after its invariant', () => {
    expect(misnamed(entries, repository)).toEqual([]);
  });

  it('the describe of an invariant is where the registry points', () => {
    const specs: SpecFile[] = [...specFiles('app/src'), ...specFiles('app/test')].map((path) => ({
      path,
      text: repoFile(path),
    }));

    expect(describedElsewhere(entries, specs)).toEqual([]);
  });

  /**
   * Without this, a rule that catches nothing would pass the checks above silently: the real
   * registry has no violations. The identifiers and calls are assembled from parts so that the
   * sample does not itself become a reference or a `describe` in the corpus.
   */
  it('the rules for the test field catch every violation', () => {
    const id = (n: number): string => `INV-${n}`;
    const call = (modifier: string, title: string): string =>
      `describe${modifier}('${title}', () => {});`;
    const probe = (n: number, lane: Invariant['verifiable_by'], test: string): Invariant => ({
      id: id(n),
      statement: 'проба',
      verifiable_by: lane,
      test,
    });
    const onDisk: ReadonlyMap<string, string> = new Map([
      ['app/test/contract/named.spec.ts', call('', id(902))],
      ['app/test/contract/silent.spec.ts', call('', 'щось інше')],
    ]);
    const files: Files = {
      exists: (path) => onDisk.has(path),
      read: (path) => onDisk.get(path) ?? '',
    };
    const probes: Invariant[] = [
      probe(901, 'eval', `app/test/contract/inv-${901}.spec.ts`),
      probe(902, 'ci-contract', 'app/test/contract/named.spec.ts'),
      probe(903, 'ci-contract', 'app/test/contract/silent.spec.ts'),
      probe(904, 'ci-contract', 'app/test/contract/elsewhere.spec.ts'),
    ];
    const specs: SpecFile[] = [
      { path: 'app/test/contract/named.spec.ts', text: call('', id(902)) },
      { path: 'app/test/contract/stray.spec.ts', text: call('.skip', `${id(902)} не тут`) },
    ];

    expect(misplaced(probes)).toEqual([`${id(901)} eval app/test/contract/inv-${901}.spec.ts`]);
    expect(silent(probes, files)).toEqual([`${id(903)} app/test/contract/silent.spec.ts`]);
    expect(misnamed(probes, files)).toEqual([`${id(904)} app/test/contract/elsewhere.spec.ts`]);
    expect(describedElsewhere(probes, specs)).toEqual([
      `${id(902)} у app/test/contract/stray.spec.ts, а реєстр каже app/test/contract/named.spec.ts`,
    ]);
  });

  /**
   * The `Test` column of the acceptance table follows the registry
   * (`docs/4-acceptance.md` § “Acceptance criteria — `SCEN-20-xx`”).
   */
  it('a SCEN-20-NN row points to INV-2NN and the same test', () => {
    // The rows of the main table have five columns; the restatement table below has four.
    const rows = [
      ...repoFile('docs/4-acceptance.md').matchAll(/^\| SCEN-20-(\d{2}) \|(.*)\|\s*$/gm),
    ]
      .map((row) => ({ nn: row[1], cells: row[2].split('|').map((cell) => cell.trim()) }))
      .filter((row) => row.cells.length === 4);
    const drift = rows.flatMap(({ nn, cells }) => {
      const id = `INV-2${nn}`;
      const entry = byId.get(id);
      const [, source, test] = cells;

      if (entry === undefined) return [`SCEN-20-${nn}: ${id} немає`];
      if (source !== `contracts/invariants.yaml#${id}`) return [`SCEN-20-${nn}: джерело ${source}`];
      if (entry.test === null) return test.includes('app/') ? [`SCEN-20-${nn}: тест ${test}`] : [];

      return test === entry.test ? [] : [`SCEN-20-${nn}: ${test}, а реєстр каже ${entry.test}`];
    });

    expect(rows).toHaveLength(criteria.length);
    expect(new Set(rows.map((row) => row.nn)).size).toBe(rows.length);
    expect(drift).toEqual([]);
  });
});
