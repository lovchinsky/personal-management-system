import { readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { isClassDeclaration } from 'typescript';
import { appSources, nodesIn, SRC } from './sources';

/**
 * File roles a reader uses to find a class: `x.repository.ts` contains `XRepository`.
 * The `.service` suffix is only for the facade of a capability (`INV-080` reads it too), because a
 * service that goes by another name would mislead whoever searches by file name.
 */
const ROLES: readonly string[] = [
  'service',
  'repository',
  'worker',
  'module',
  'controller',
  'guard',
  'policy',
  'dispatcher',
  'scheduler',
  'reader',
  'writer',
  'adapter',
  'parser',
  'evaluator',
  'executor',
  'auditor',
  'router',
];

/** Returns the role from a file name `a.b.role.ts`, or `undefined` if the name has no role. */
function roleOf(file: string): string | undefined {
  const parts = basename(file, '.ts').split('.');

  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

/** Returns the classes a file declares. */
function classesIn(file: string): string[] {
  return nodesIn(file, readFileSync(file, 'utf8'), isClassDeclaration).flatMap(({ node }) =>
    node.name ? [node.name.text] : [],
  );
}

function pascal(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

describe('file names', () => {
  const files = appSources();

  it('the role suffix of a file matches the ending of its class', () => {
    const lying = files
      .filter((file) => {
        const role = roleOf(file);

        return (
          role !== undefined &&
          ROLES.includes(role) &&
          !classesIn(file).some((name) => name.endsWith(pascal(role)))
        );
      })
      .map((file) => relative(SRC, file));

    expect(lying).toEqual([]);
  });

  it('file names in src are unique', () => {
    const seen = new Map<string, string[]>();

    for (const file of files) {
      seen.set(basename(file), [...(seen.get(basename(file)) ?? []), relative(SRC, file)]);
    }

    const repeated = [...seen.values()].filter((paths) => paths.length > 1);

    expect(repeated).toEqual([]);
  });

  /** Without this, a walk that finds no files with roles would pass the check silently. */
  it('finds the files with roles', () => {
    const withRole = files.filter((file) => ROLES.includes(roleOf(file) ?? ''));

    expect(withRole.length).toBeGreaterThan(40);
    expect(withRole.map((file) => basename(file))).toContain('approvals.service.ts');
  });
});
