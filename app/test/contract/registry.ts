import { basename } from 'node:path';
import { Invariant } from './contracts';

/**
 * The rules for the `test` field of the invariant registry, written as pure functions so that
 * each can be checked on a synthetic entry and not only on the real registry, which has no
 * violations.
 */

/** What the rules know about files: whether they exist and what they contain. */
export interface Files {
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string;
}

export interface SpecFile {
  readonly path: string;
  readonly text: string;
}

/** Lane `verifiable_by` → where the check may live (the header of `invariants.yaml`). */
const LANE: Record<Invariant['verifiable_by'], (path: string) => boolean> = {
  'ci-contract': (path) => /^app\/(test\/(contract|integration)\/.+|src\/.+)\.spec\.ts$/.test(path),
  eval: (path) => /^app\/test\/eval\/.+\.eval\.ts$/.test(path),
  integration: (path) => /^app\/test\/integration\/.+\.spec\.ts$/.test(path),
  manual: () => false,
};

/** Lists the entries whose check lives outside the lane of their `verifiable_by`. */
export function misplaced(entries: readonly Invariant[]): string[] {
  return entries
    .filter((entry) => entry.test !== null && !LANE[entry.verifiable_by](entry.test))
    .map((entry) => `${entry.id} ${entry.verifiable_by} ${entry.test}`);
}

/**
 * Lists the entries whose existing check file does not name their invariant, which means the file
 * checks something else.
 */
export function silent(entries: readonly Invariant[], files: Files): string[] {
  return entries
    .filter(
      (entry) =>
        entry.test !== null &&
        files.exists(entry.test) &&
        !files.read(entry.test).includes(entry.id),
    )
    .map((entry) => `${entry.id} ${entry.test}`);
}

/** Lists the entries whose planned location is not named after their invariant (`inv-NNN.*`). */
export function misnamed(entries: readonly Invariant[], files: Files): string[] {
  return entries
    .filter(
      (entry) =>
        entry.test !== null &&
        !files.exists(entry.test) &&
        !basename(entry.test).startsWith(entry.id.toLowerCase()),
    )
    .map((entry) => `${entry.id} ${entry.test}`);
}

/** Lists the invariants whose `describe` is not where the registry points. */
export function describedElsewhere(
  entries: readonly Invariant[],
  specs: readonly SpecFile[],
): string[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  return specs.flatMap(({ path, text }) =>
    [...text.matchAll(/describe(?:\.(?:skip|only))?\(\s*['"`](INV-\d{3})/g)]
      .filter((match) => byId.get(match[1])?.test !== path)
      .map(
        (match) => `${match[1]} у ${path}, а реєстр каже ${byId.get(match[1])?.test ?? 'нічого'}`,
      ),
  );
}
