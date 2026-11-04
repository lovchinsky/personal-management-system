import { rmSync, writeFileSync } from 'node:fs';
import { shapesByTitle, type DatabaseShape, type Workspace } from './workspace-schema';

/** A formula the person must enter in the Notion interface. */
export interface FormulaToEnter {
  readonly database: string;
  readonly property: string;
  readonly expression: string;
}

/**
 * Returns the target's formulas whose expression differs in the live workspace. Whitespace outside
 * string literals does not change a formula's value, so the check does not see it. The pasted text
 * need not match the indentation.
 */
export function formulasToEnter(
  target: readonly DatabaseShape[],
  live: Workspace,
): FormulaToEnter[] {
  const liveByTitle = shapesByTitle(live);

  return target.flatMap(({ title: database, properties }) =>
    [...properties].flatMap(([property, expected]) => {
      const actual = liveByTitle.get(database)?.properties.get(property);

      if (expected.type !== 'formula' || actual?.type !== 'formula') return [];
      if (meaningOf(expected.expression) === meaningOf(actual.expression)) return [];

      return [{ database, property, expression: expected.expression }];
    }),
  );
}

/** Returns the expression without whitespace outside string literals. */
function meaningOf(expression: string): string {
  let text = '';
  let quoted = false;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (quoted && char === '\\') {
      text += char + (expression[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (char === '"') quoted = !quoted;
    if (quoted || !/\s/.test(char)) text += char;
  }

  return text;
}

/**
 * Writes the file of formulas to enter by hand. REST does not accept a formula that reads a
 * related database, so the column is created empty and the person pastes the expression. `notes`
 * are the paragraphs added by whoever writes the file: whether the formulas are required and what
 * to do next. Without formulas the file is removed.
 */
export function writeFormulas(
  file: string,
  formulas: readonly FormulaToEnter[],
  notes: readonly string[],
): void {
  if (formulas.length === 0) {
    rmSync(file, { force: true });

    return;
  }

  writeFileSync(
    file,
    [
      '# Formulas to enter by hand',
      '',
      "Notion's REST API refuses a formula that reads a related database, so every formula column",
      "is created empty. For each formula below: open the database, open the property's formula",
      'editor, paste the text, save.',
      ...notes.flatMap((note) => ['', note]),
      ...formulas.flatMap(({ database, property, expression }) => [
        '',
        `## ${database} → ${property}`,
        '',
        '```',
        expression,
        '```',
      ]),
      '',
    ].join('\n'),
  );
}
