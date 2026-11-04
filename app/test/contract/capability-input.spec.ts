import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canHaveModifiers,
  createSourceFile,
  getModifiers,
  isFunctionDeclaration,
  isTypeAliasDeclaration,
  isVariableStatement,
  ScriptTarget,
  SyntaxKind,
} from 'typescript';
import { SRC } from './sources';

/** Capability modules: each manages its own kinds of run and chat writes (ADR 0015). */
const CAPABILITIES: readonly string[] = [
  'approvals',
  'attention',
  'capture',
  'continuations',
  'delivery',
];

/** Returns the names a file exports: values, functions and types. */
function exportedNames(file: string): string[] {
  const source = createSourceFile(file, readFileSync(file, 'utf8'), ScriptTarget.Latest, true);

  return source.statements.flatMap((statement) => {
    const exported =
      canHaveModifiers(statement) &&
      (getModifiers(statement) ?? []).some(({ kind }) => kind === SyntaxKind.ExportKeyword);

    if (!exported) {
      return [];
    }

    if (isVariableStatement(statement)) {
      return statement.declarationList.declarations.map(({ name }) => name.getText(source));
    }

    if (isFunctionDeclaration(statement) || isTypeAliasDeclaration(statement)) {
      return statement.name ? [statement.name.text] : [];
    }

    return [];
  });
}

/** `inbox-conversion` → `inboxConversion`. */
function camel(stem: string): string {
  return stem.replace(/-(\w)/g, (_match, letter: string) => letter.toUpperCase());
}

function pascal(stem: string): string {
  const name = camel(stem);

  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Returns the files of a module that end in `suffix`, without directories and specs. */
function filesOf(module: string, suffix: string): string[] {
  return readdirSync(resolve(SRC, module)).filter(
    (name) => name.endsWith(suffix) && !name.endsWith('.spec.ts'),
  );
}

/**
 * Returns the kinds of write of a module, which are the names of its schemas without the suffix:
 * `inbox-conversion`, `inbox-parking`.
 */
function kindsOf(module: string): string[] {
  return filesOf(module, '.schema.ts').map((name) => name.replace(/\.schema\.ts$/, ''));
}

/**
 * The input of every capability is laid out the same way (ADR 0015): in the module root, for each
 * kind of write, a `<name>.schema.ts` with the schema, the request type and the validated type,
 * and a `<name>.wire.ts` that translates the wire into the request. Whoever adds a kind of write
 * knows where everything lives, and a reader of five capabilities sees one shape.
 */
describe('capability input', () => {
  it.each(CAPABILITIES)(
    '%s has an input schema and a wire module for every kind of write',
    (module) => {
      const wires = filesOf(module, '.wire.ts').map((name) => name.replace(/\.wire\.ts$/, ''));

      expect(kindsOf(module).length).toBeGreaterThan(0);
      expect(wires.sort()).toEqual(kindsOf(module).sort());
    },
  );

  it.each(CAPABILITIES)(
    '%s names the schema, the request and the validated type after the file name',
    (module) => {
      for (const stem of kindsOf(module)) {
        const exported = exportedNames(resolve(SRC, module, `${stem}.schema.ts`));

        expect(exported).toEqual(
          expect.arrayContaining([`${camel(stem)}Schema`, pascal(stem), `${pascal(stem)}Request`]),
        );
      }
    },
  );

  it.each(CAPABILITIES)(
    '%s translates the wire into the request with a function named after the schema',
    (module) => {
      for (const stem of kindsOf(module)) {
        const exported = exportedNames(resolve(SRC, module, `${stem}.wire.ts`));

        expect(exported).toContain(`${camel(stem)}RequestOf`);
      }
    },
  );

  /** Without this, a walk that finds no exports would pass the checks above silently. */
  it('finds the exports', () => {
    expect(exportedNames(resolve(SRC, 'attention', 'comment.schema.ts'))).toEqual(
      expect.arrayContaining(['commentSchema', 'Comment', 'CommentRequest', 'MAX_COMMENT_CHARS']),
    );
  });
});
