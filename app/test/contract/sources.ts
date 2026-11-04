import { readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { relative, resolve } from 'node:path';
import {
  createProgram,
  createSourceFile,
  forEachChild,
  Node,
  parseJsonConfigFileContent,
  preProcessFile,
  Program,
  readConfigFile,
  resolveModuleName,
  ScriptTarget,
  sys,
} from 'typescript';
import { REPO_ROOT } from './contracts';

/**
 * The App code under check: which files go into the image and where their imports lead. The
 * invariants about module boundaries share it.
 */
export const APP = resolve(REPO_ROOT, 'app');
export const SRC = resolve(APP, 'src');
export const GENERATED = resolve(SRC, 'generated');

/**
 * The compiler options of the App: an import resolves the same way as in the build, so a
 * specifier relative to `baseUrl` or through `paths` does not slip through as a “package”.
 */
const { options } = parseJsonConfigFileContent(
  readConfigFile(resolve(APP, 'tsconfig.json'), (path) => sys.readFile(path)).config,
  sys,
  APP,
);

export function within(dir: string, path: string): boolean {
  return !relative(dir, path).startsWith('..');
}

/** Lists the `.ts` files that go into the image; specs are not among them. */
export function shippedSources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => resolve(dir, file));
}

/** Lists the App code that goes into the image, without the generated Prisma client. */
export function appSources(): string[] {
  return shippedSources(SRC).filter((file) => !within(GENERATED, file));
}

/** The directories of the App code: what goes into the image, its tests and its tools. */
export const CODE_DIRS: readonly string[] = ['src', 'test', 'tools'].map((dir) =>
  resolve(APP, dir),
);

/** Lists all of the App code, specs included, without the generated Prisma client. */
export function allSources(): string[] {
  return CODE_DIRS.flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .map((file) => resolve(dir, file)),
  ).filter((file) => !within(GENERATED, file));
}

/**
 * Creates a compiler program over the App code, in which imports between files resolve as in the
 * build.
 */
export function codeProgram(): Program {
  return createProgram(allSources(), options);
}

/** A syntax tree node that satisfies the condition, and its location. */
interface Found<T extends Node> {
  /** `file:line` relative to `src/`. */
  readonly at: string;
  readonly node: T;
}

/**
 * Finds the syntax tree nodes of the code that satisfy `matches`. The tree is traversed, not the
 * text, so a comment that mentions the same thing is not a match.
 */
export function nodesIn<T extends Node>(
  file: string,
  code: string,
  matches: (node: Node) => node is T,
): Found<T>[] {
  const source = createSourceFile(file, code, ScriptTarget.Latest, true);
  const found: Found<T>[] = [];

  const visit = (node: Node): void => {
    if (matches(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));

      found.push({ at: `${relative(SRC, file)}:${line + 1}`, node });
    }

    forEachChild(node, visit);
  };

  visit(source);

  return found;
}

/**
 * Lists the places in the code where a node satisfies `matches`, as `file:line` relative to
 * `src/`.
 */
export function locationsIn(
  file: string,
  code: string,
  matches: (node: Node) => boolean,
): string[] {
  return nodesIn(file, code, (node): node is Node => matches(node)).map(({ at }) => at);
}

/** Does the same for a file on disk. */
export function locations(file: string, matches: (node: Node) => boolean): string[] {
  return locationsIn(file, readFileSync(file, 'utf8'), matches);
}

/**
 * Returns the App code file that an import leads to, or `null` for a package or a Node module.
 *
 * Node modules are declared in `@types/node` without a file of their own, and the resolver does
 * not find them — which is why `isBuiltin` filters them out. An import that does not resolve at
 * all fails the check: an unknown target is not an allowed one.
 */
export function appFileOf(specifier: string, from: string): string | null {
  if (isBuiltin(specifier)) return null;

  const resolved = resolveModuleName(specifier, from, options, sys).resolvedModule;
  if (resolved === undefined) {
    throw new Error(`${specifier} does not resolve from ${from}`);
  }

  return resolved.isExternalLibraryImport ? null : resolved.resolvedFileName;
}

interface Import {
  /** `file → specifier`, relative to `src/`, so a violation is clear at a glance. */
  readonly edge: string;
  readonly target: string | null;
}

export function importsOf(file: string): Import[] {
  return preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map(
    ({ fileName }) => ({
      edge: `${relative(SRC, file)} → ${fileName}`,
      target: appFileOf(fileName, file),
    }),
  );
}
