import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canHaveModifiers,
  getModifiers,
  isArrowFunction,
  isDecorator,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isNamedImports,
  isStringLiteral,
  isVariableStatement,
  SyntaxKind,
  type ImportDeclaration,
  type Node,
} from 'typescript';
import { MATRIX } from '../fixtures/reading-matrix';
import { isImpureExpression } from './pure-layer';
import { appFileOf, importsOf, nodesIn, shippedSources, SRC, within } from './sources';

const METHODOLOGY = resolve(SRC, 'methodology');
const SEMANTICS = resolve(SRC, 'notion/semantics');

/**
 * The types of the read record are all the methodology rules need from outside: `Reading`,
 * `DecodedRecord` and the canonical status names.
 */
const RECORD_TYPES: ReadonlySet<string> = new Set(
  ['reading.ts', 'decoded-record.ts', 'canonical-status.ts'].map((file) =>
    resolve(SEMANTICS, file),
  ),
);

/**
 * Checks whether an import from a read-record file lacks `import type`. A value from there is
 * already a runtime dependency.
 */
function isValueImportOfRecordTypes(file: string, node: ImportDeclaration): boolean {
  if (!isStringLiteral(node.moduleSpecifier)) return false;

  const target = appFileOf(node.moduleSpecifier.text, file);

  if (target === null || !RECORD_TYPES.has(target)) return false;

  const clause = node.importClause;

  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;

  const bindings = clause.namedBindings;
  const onlyTypeSpecifiers =
    clause.name === undefined &&
    bindings !== undefined &&
    isNamedImports(bindings) &&
    bindings.elements.every((element) => isImportSpecifier(element) && element.isTypeOnly);

  return !onlyTypeSpecifiers;
}

const isExported = (node: Node): boolean =>
  (canHaveModifiers(node) ? (getModifiers(node) ?? []) : []).some(
    (modifier) => modifier.kind === SyntaxKind.ExportKeyword,
  );

/**
 * Returns the names of the file's exported functions: `export function` and
 * `export const f = () => …`. It reads the syntax tree instead of loading the module, so a new rule
 * in a new file of the layer is picked up by the check automatically.
 */
function exportedFunctions(file: string): string[] {
  const found = nodesIn(file, readFileSync(file, 'utf8'), (node): node is Node => isExported(node));

  return found.flatMap(({ node }) => {
    if (isFunctionDeclaration(node)) return node.name ? [node.name.text] : [];
    if (!isVariableStatement(node)) return [];

    return node.declarationList.declarations.flatMap((declaration) =>
      isIdentifier(declaration.name) &&
      declaration.initializer !== undefined &&
      (isArrowFunction(declaration.initializer) || isFunctionExpression(declaration.initializer))
        ? [declaration.name.text]
        : [],
    );
  });
}

/**
 * Exports of the layer that are not rules: the constructor and the recognizer of the “don't know”
 * answer.
 */
const NOT_RULES: ReadonlySet<string> = new Set(['undetermined', 'isUndetermined']);

/**
 * `INV-094` The rules of the methodology are pure functions over the records that were read:
 * `methodology/` has no Nest providers, does not access Notion, `app_db` or the network, and
 * imports only the types of the read record and itself. For an unread, absent or unknown field a
 * rule answers `undetermined` instead of guessing.
 *
 * The layer is a selection over the canonical readings, not a second domain model: it stores
 * nothing and reads nothing itself, so it can answer only from the current state of Notion.
 *
 * The second half of the invariant (the reading states) is covered by the matrix in
 * `reading-matrix.ts`; this file checks that every rule is in it.
 */
describe('INV-094', () => {
  const files = shippedSources(METHODOLOGY);
  const imports = files.flatMap(importsOf);

  it('imports only itself and the types of the read record: no packages, no client, no database', () => {
    const foreign = imports
      .filter(
        ({ target }) =>
          target === null || (!within(METHODOLOGY, target) && !RECORD_TYPES.has(target)),
      )
      .map(({ edge }) => edge);

    expect(foreign).toEqual([]);
  });

  it('imports no values from the read-record files: only `import type`', () => {
    const offending = files.flatMap((file) =>
      nodesIn(file, readFileSync(file, 'utf8'), isImportDeclaration)
        .filter(({ node }) => isValueImportOfRecordTypes(file, node))
        .map(({ at }) => at),
    );

    expect(offending).toEqual([]);
  });

  it('pure: no network, no process environment, no clock, no randomness', () => {
    const impure = files.flatMap((file) =>
      nodesIn(file, readFileSync(file, 'utf8'), isImpureExpression).map(({ at }) => at),
    );

    expect(impure).toEqual([]);
  });

  /**
   * A new rule with no row in the reading-state matrix would pass silently, so the test below
   * compares the layer's exports with the matrix's rules in both directions.
   */
  it('every rule of the layer is in the reading-state matrix, and the matrix lists no extra rules', () => {
    const rules = files.flatMap(exportedFunctions).filter((name) => !NOT_RULES.has(name));

    expect([...new Set(rules)].sort()).toEqual([...new Set(MATRIX.map((row) => row.rule))].sort());
  });

  it('declares no Nest providers: the layer has no decorators', () => {
    const decorated = files.flatMap((file) =>
      nodesIn(file, readFileSync(file, 'utf8'), isDecorator).map(({ at }) => at),
    );

    expect(decorated).toEqual([]);
  });

  /** Otherwise an empty walk of the directory would pass the checks above silently. */
  it('finds the code and the imports it checks', () => {
    expect(files.map((file) => file.slice(METHODOLOGY.length + 1))).toEqual(
      expect.arrayContaining(['lifecycle.ts', 'dependency.ts', 'project-closure.ts']),
    );
    expect(imports.some(({ target }) => target !== null && RECORD_TYPES.has(target))).toBe(true);
  });
});
