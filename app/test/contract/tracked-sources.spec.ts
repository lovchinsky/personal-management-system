import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { composeFile, REPO_ROOT, repoFile } from './contracts';
import { loadCorpus } from './corpus';
import { referencesIn } from './references';

/** Installation files that Compose reads but that git by design does not carry. */
const INSTALLATION_FILES: ReadonlySet<string> = new Set(['infra/notion/mapping.yaml']);

/**
 * Lists the paths that git ignores: `git check-ignore` answers with exit code 1 when there are
 * none.
 */
function ignored(paths: readonly string[]): string[] {
  try {
    return execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: REPO_ROOT,
      input: paths.join('\n'),
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.length > 0);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 1) {
      return [];
    }

    throw error;
  }
}

/** Lists the sources of the App image's `COPY` lines, except copies from other build stages. */
function dockerfileSources(): string[] {
  return repoFile('app/Dockerfile')
    .split('\n')
    .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))
    .flatMap((line) => {
      const parts = line
        .split(/\s+/)
        .slice(1)
        .filter((part) => !part.startsWith('--'));

      return parts.slice(0, -1);
    });
}

/**
 * A fresh clone gets only what git carries. A file that a document refers to, that Compose mounts
 * or that the image copies, but that git ignores, would be left dangling in the clone, and disk
 * checks do not see the problem.
 */
describe('git carries the sources the repository relies on', () => {
  it('document links lead to files that git does not ignore', () => {
    const targets = loadCorpus()
      .flatMap(referencesIn)
      .filter((reference) => reference.form === 'markdown')
      .map((reference) => reference.target.split('#', 1)[0] ?? '')
      .filter((path) => path.length > 0 && !path.startsWith('..'));

    expect(targets.length).toBeGreaterThan(0);
    expect(ignored([...new Set(targets)])).toEqual([]);
  });

  it('git does not ignore the files of the Compose configs or the App image sources', () => {
    const configs = Object.values(composeFile('infra/compose.yaml').configs ?? {})
      .map(({ file }) => posix.join('infra', file))
      .filter((path) => !INSTALLATION_FILES.has(path));
    const copies = dockerfileSources();

    expect(configs).toContain('infra/postgres/init.sql');
    expect(copies).toContain('contracts/canonical.yaml');
    expect(ignored([...configs, ...copies])).toEqual([]);
  });
});
