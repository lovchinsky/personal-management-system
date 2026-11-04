import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
  forEachChild,
  isCallExpression,
  isExportSpecifier,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportSpecifier,
  isNamespaceImport,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
  Node,
  SourceFile,
  SymbolFlags,
  SyntaxKind,
  Symbol as TsSymbol,
  TypeChecker,
} from 'typescript';
import { z } from 'zod';
import { APP, appFileOf, CODE_DIRS, codeProgram, GENERATED, within } from './sources';

/**
 * Returns the modules loaded by a tool rather than imported: the global setup of the jest lanes.
 * They are read from the lane configs, so a new module of this kind is not added here by hand.
 */
function toolingEntries(): ReadonlySet<string> {
  const config = z.object({ globalSetup: z.string().optional() });

  return new Set(
    ['test/jest-integration.json', 'test/jest-e2e.json'].flatMap((path) => {
      const { globalSetup } = config.parse(JSON.parse(readFileSync(resolve(APP, path), 'utf8')));

      return globalSetup === undefined
        ? []
        : [resolve(APP, dirname(path), globalSetup.replace('<rootDir>/', ''))];
    }),
  );
}

/**
 * Checks whether a symbol is a type-level assertion (`Assert<…>`). Such an assertion is exported
 * so that the compiler does not flag it as unused. Nobody imports it, and it works by merely
 * existing.
 */
function isTypeAssertion(symbol: TsSymbol): boolean {
  return (symbol.declarations ?? []).some(
    (declaration) =>
      isTypeAliasDeclaration(declaration) &&
      isTypeReferenceNode(declaration.type) &&
      isIdentifier(declaration.type.typeName) &&
      declaration.type.typeName.text === 'Assert',
  );
}

interface Usage {
  /** The declarations that an import or re-export points to. */
  readonly symbols: Set<TsSymbol>;
  /** Exports that someone imports through the export itself, not the declaration it points to. */
  readonly through: Set<TsSymbol>;
  /** Modules that someone imports whole: `import * as` or a dynamic `import()`. */
  readonly whole: Set<string>;
}

function usageIn(files: readonly SourceFile[], checker: TypeChecker): Usage {
  const usage: Usage = { symbols: new Set(), through: new Set(), whole: new Set() };
  const original = (symbol: TsSymbol): TsSymbol =>
    symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

  for (const file of files) {
    const visit = (node: Node): void => {
      const named =
        isImportSpecifier(node) || isExportSpecifier(node)
          ? (node.propertyName ?? node.name)
          : isImportClause(node)
            ? node.name
            : undefined;
      const symbol = named && checker.getSymbolAtLocation(named);

      if (symbol) {
        usage.symbols.add(original(symbol));

        const next = symbol.flags & SymbolFlags.Alias && checker.getImmediateAliasedSymbol(symbol);
        if (next) {
          usage.through.add(next);
        }
      }

      if (isNamespaceImport(node) && isImportDeclaration(node.parent.parent)) {
        const { moduleSpecifier } = node.parent.parent;

        if (isStringLiteral(moduleSpecifier)) {
          usage.whole.add(appFileOf(moduleSpecifier.text, file.fileName) ?? '');
        }
      }

      if (
        isCallExpression(node) &&
        node.expression.kind === SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        isStringLiteral(node.arguments[0])
      ) {
        usage.whole.add(appFileOf(node.arguments[0].text, file.fileName) ?? '');
      }

      forEachChild(node, visit);
    };

    visit(file);
  }

  return usage;
}

interface ExportAudit {
  /** The number of exports checked. */
  readonly checked: number;
  /** Exports that no other file imports, as `file:line name`. */
  readonly unimported: readonly string[];
}

function auditExports(): ExportAudit {
  const program = codeProgram();
  const checker = program.getTypeChecker();
  const files = program
    .getSourceFiles()
    .filter(
      (file) =>
        CODE_DIRS.some((dir) => within(dir, file.fileName)) && !within(GENERATED, file.fileName),
    );
  const usage = usageIn(files, checker);
  const tooling = toolingEntries();
  const exportsOf = (file: SourceFile): TsSymbol[] => {
    const symbol = checker.getSymbolAtLocation(file);

    return symbol === undefined ? [] : checker.getExportsOfModule(symbol);
  };

  const unimported = files.flatMap((file) => {
    if (usage.whole.has(file.fileName)) return [];

    return exportsOf(file)
      .filter((exported) => {
        const target =
          exported.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;

        // A re-export (`export { X }`) must have an importer of its own: otherwise whoever
        // imports `X` from the declaration would not catch it.
        const imported =
          usage.symbols.has(target) && (target === exported || usage.through.has(exported));

        return (
          !imported &&
          !isTypeAssertion(target) &&
          !(exported.name === 'default' && tooling.has(file.fileName))
        );
      })
      .map((exported) => {
        const [declaration] = exported.declarations ?? [];
        const line = declaration
          ? file.getLineAndCharacterOfPosition(declaration.getStart()).line + 1
          : 0;

        return `${relative(APP, file.fileName)}:${line} ${exported.name}`;
      });
  });

  return { checked: files.flatMap(exportsOf).length, unimported };
}

/**
 * Every export of App code has an importer in `src`, `test` or `tools`.
 *
 * An export with no importer is either dead code or a declaration that can simply stay local: the
 * declaration build accepts a type that names the input or output of an exported function even
 * when it is not exported.
 */
describe('exports of App code', () => {
  const audit = auditExports();

  it('every export has an importer', () => {
    expect(audit.unimported).toEqual([]);
  });

  /** Without this, a blind walk that sees no export at all would pass silently. */
  it('finds the exports of App code', () => {
    expect(audit.checked).toBeGreaterThan(500);
  });
});
