import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainProperty } from '../../../test/fixtures/notion-data-source.fixture';
import { formulaOf, titledDataSource } from '../../../test/fixtures/notion-workspace.fixture';
import { formulasToEnter, writeFormulas } from './workspace-formulas';
import { workspaceOf, type DatabaseShape } from './workspace-schema';

const EXPRESSION = 'prop("Project").length()';

/** The target: Tasks with one formula. */
const TARGET: readonly DatabaseShape[] = [
  {
    title: 'Tasks',
    icon: null,
    description: '',
    properties: new Map([
      ['Name', { description: null, type: 'title' }],
      ['Count', { description: null, type: 'formula', expression: EXPRESSION }],
    ]),
  },
];

/** Builds a live workspace whose formula has the expression passed in. */
const liveWith = (expression: string) =>
  workspaceOf(
    new Map([
      [
        'live',
        titledDataSource('live', 'Tasks', [
          plainProperty('live-title', 'Name', 'title'),
          formulaOf('live-count', 'Count', expression),
        ]),
      ],
    ]),
  );

describe('formulas entered by the person', () => {
  it("an empty formula waits to be entered, with the target's text", () => {
    expect(formulasToEnter(TARGET, liveWith(''))).toEqual([
      { database: 'Tasks', property: 'Count', expression: EXPRESSION },
    ]);
  });

  it('an entered formula is not waiting', () => {
    expect(formulasToEnter(TARGET, liveWith(EXPRESSION))).toEqual([]);
  });

  it('whitespace and line breaks outside strings do not matter', () => {
    expect(formulasToEnter(TARGET, liveWith('prop( "Project" )\n  .length()'))).toEqual([]);
  });

  it('a space inside a string makes a different formula', () => {
    expect(formulasToEnter(TARGET, liveWith('prop("Pro ject").length()'))).toHaveLength(1);
  });

  it('does not count a database or property missing from the live workspace as a formula to enter', () => {
    expect(formulasToEnter(TARGET, workspaceOf(new Map()))).toEqual([]);
  });
});

describe('the formulas file', () => {
  const folder = mkdtempSync(join(tmpdir(), 'workspace-formulas-'));
  const file = join(folder, 'formulas.md');

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('contains each formula with its database and property, plus the notes added by whoever writes the file', () => {
    writeFormulas(
      file,
      [{ database: 'Tasks', property: 'Count', expression: EXPRESSION }],
      ['A note from the caller.'],
    );

    const text = readFileSync(file, 'utf8');

    expect(text).toContain('## Tasks → Count');
    expect(text).toContain(`\`\`\`\n${EXPRESSION}\n\`\`\``);
    expect(text).toContain('A note from the caller.');
  });

  it('does not exist without formulas', () => {
    writeFormulas(file, [{ database: 'Tasks', property: 'Count', expression: EXPRESSION }], []);
    writeFormulas(file, [], []);

    expect(existsSync(file)).toBe(false);
  });
});
