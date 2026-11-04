import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  isExportAssignment,
  isExportDeclaration,
  isExportSpecifier,
  isIdentifier,
  isStringLiteral,
  isStringLiteralLike,
  isTemplateHead,
  isTemplateMiddle,
  isTemplateTail,
  Node,
} from 'typescript';
import { Prisma } from '../../src/generated/prisma/client';
import { APP, appSources, locations, shippedSources, SRC, within } from './sources';

const RUNS = resolve(SRC, 'runs');
const LEDGER = resolve(RUNS, 'run-trace.repository.ts');

/** A trace model and the table it is mapped to. */
interface TraceModel {
  readonly model: string;
  readonly table: string;
}

/**
 * Derives the trace tables from the schema: the `Run*` models together with their `@@map`s.
 *
 * The list is derived, not written: otherwise a trace table added later would stay outside the
 * check, and a path to it from outside `runs/` would pass silently.
 */
function traceModels(): TraceModel[] {
  const schema = readFileSync(resolve(APP, 'prisma/schema.prisma'), 'utf8');

  return [...schema.matchAll(/^model (Run\w*) \{\n([\s\S]*?)^\}$/gm)].map(([, model, body]) => {
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1];
    if (table === undefined) {
      throw new Error(`${model} names no table: @@map is missing`);
    }

    return { model, table };
  });
}

const TRACE = traceModels();

/**
 * Tables are matched by their name in SQL. Postgres folds an unquoted name to lower case, so
 * `RUN_TRACES` is the same table.
 */
const TABLES = new RegExp(`\\b(?:${TRACE.map((entry) => entry.table).join('|')})\\b`, 'i');

/** The Prisma delegates and the ledger repository — in code or as a string like `['runTrace']`. */
const NAMES: ReadonlySet<string> = new Set([
  ...TRACE.map((entry) => `${entry.model[0].toLowerCase()}${entry.model.slice(1)}`),
  'RunTraceRepository',
]);

/**
 * Checks whether a node is a path to a table: a Prisma delegate (including through an index or a
 * destructuring), the ledger repository (whether by a direct import or by a re-export) or SQL
 * naming a table.
 */
function leadsToTable(node: Node): boolean {
  const text =
    isStringLiteralLike(node) ||
    isTemplateHead(node) ||
    isTemplateMiddle(node) ||
    isTemplateTail(node)
      ? node.text
      : undefined;

  return (
    (isIdentifier(node) && NAMES.has(node.text)) ||
    (text !== undefined && (NAMES.has(text) || TABLES.test(text)))
  );
}

function pathsToTable(file: string): string[] {
  return locations(file, leadsToTable);
}

/**
 * Checks whether a node re-exports the ledger from the file `file`: by name, by alias, by
 * `export *` or by `export default`.
 */
function reexportsLedger(node: Node, file: string): boolean {
  const named =
    isExportSpecifier(node) && (node.propertyName ?? node.name).text === 'RunTraceRepository';
  const star =
    isExportDeclaration(node) &&
    node.exportClause === undefined &&
    node.moduleSpecifier !== undefined &&
    isStringLiteral(node.moduleSpecifier) &&
    `${resolve(dirname(file), node.moduleSpecifier.text)}.ts` === LEDGER;
  const asDefault =
    isExportAssignment(node) &&
    isIdentifier(node.expression) &&
    node.expression.text === 'RunTraceRepository';

  return named || star || asDefault;
}

/**
 * Finds the re-exports of the ledger in a file. Re-exports are forbidden even inside `runs/`,
 * because a re-export under another name would take the repository out of `runs/` in a way that
 * the name check outside `runs/` would not recognize.
 */
function reexportsOfLedger(file: string): string[] {
  return locations(file, (node) => reexportsLedger(node, file));
}

/**
 * `INV-079` The run trace — the `run_traces` ledger, the snapshot and the lists — is read and
 * written only by `runs/`: the runner hands the run's outcome over through a port, and the
 * dispatcher writes it into the trace.
 */
describe('INV-079', () => {
  const outside = appSources().filter((file) => !within(RUNS, file));

  it('outside runs/ there is no path to the trace tables: not by delegate, SQL or the ledger', () => {
    expect(outside.flatMap(pathsToTable)).toEqual([]);
  });

  it('the ledger is not re-exported, so it cannot get out under another name', () => {
    const others = shippedSources(RUNS).filter((file) => file !== LEDGER);

    expect(others.flatMap(reexportsOfLedger)).toEqual([]);
  });

  /**
   * The list read from the schema is the same one the generated client knows: a regex that missed
   * a model would narrow the check silently.
   */
  it('the trace tables are all the Run* models of the schema', () => {
    const generated = Object.values(Prisma.ModelName).filter((name) => name.startsWith('Run'));

    expect(TRACE.map((entry) => entry.model).sort()).toEqual([...generated].sort());
    expect(TRACE.map((entry) => entry.table)).toContain('run_traces');
  });

  /** Without this, an empty walk or a blind scanner would pass the check above silently. */
  it('finds the code and the accesses it checks', () => {
    expect(outside).toContain(resolve(SRC, 'continuations/scheduled-check.run-source.ts'));
    expect(pathsToTable(LEDGER)).not.toHaveLength(0);
    expect(pathsToTable(resolve(RUNS, 'run-budget.ts'))).not.toHaveLength(0);
    expect(pathsToTable(resolve(RUNS, 'run-traces.ts'))).not.toHaveLength(0);
  });
});
