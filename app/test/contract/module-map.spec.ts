import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { repoFile } from './contracts';
import { SRC } from './sources';

/** A map entry: the path relative to `src/`. */
interface Entry {
  readonly path: string;
}

/** Each level of the tree in the map is indented by four characters. */
const LEVEL = 4;

/** Parses the tree from the block in `docs/2-system.md` § “Module map”. */
function mapEntries(): Entry[] {
  const block = /### Module map\n+```text\n([\s\S]*?)\n```/.exec(repoFile('docs/2-system.md'))?.[1];
  const stack: string[] = [];
  const entries: Entry[] = [];

  for (const line of (block ?? '').split('\n')) {
    const match = /^((?:│ {3}| {4})*)(?:├──|└──) (\S+)(?:\s+— .*)?$/.exec(line);
    if (!match) {
      continue;
    }

    const depth = match[1].length / LEVEL;

    stack.length = depth;
    stack[depth] = match[2].replace(/\/$/, '');
    entries.push({ path: stack.join('/') });
  }

  return entries;
}

/** Returns a path and all its prefixes: `a/b/c` names both `a` and `a/b`. */
function withPrefixes(path: string): string[] {
  const parts = path.split('/');

  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/**
 * Lists the first- and second-level directories of `src`. The contents of the generated Prisma
 * client are not part of the App.
 */
function sourceDirectories(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => relative(SRC, resolve(entry.parentPath, entry.name)))
    .filter((dir) => dir.split('/').length <= 2 && !dir.startsWith('generated/'));
}

/**
 * The module map is normative (ADR 0011): every code directory is named in it, and the map names
 * no directory that does not exist.
 */
describe('the module map', () => {
  const entries = mapEntries();
  const named = new Set(entries.flatMap(({ path }) => withPrefixes(path)));

  it('names every first- and second-level directory of src', () => {
    expect(sourceDirectories().filter((dir) => !named.has(dir))).toEqual([]);
  });

  it('names no directory that does not exist', () => {
    const missing = entries.filter(({ path }) => !existsSync(resolve(SRC, path)));

    expect(missing.map(({ path }) => path)).toEqual([]);
  });

  /** Otherwise a parse that found nothing would pass the checks above silently. */
  it('is found by the parser', () => {
    expect(entries.length).toBeGreaterThan(40);
    expect(entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['runs', 'platform/queue', 'notion/client', 'credentials/gbrain']),
    );
  });
});
