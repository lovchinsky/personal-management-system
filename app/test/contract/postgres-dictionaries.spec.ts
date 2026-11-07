import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { composeFile, REPO_ROOT, repoFile } from './contracts';

const INSTALLER = 'infra/postgres/install-dictionaries.sh';
const DICTIONARIES = 'infra/postgres/dictionaries';

/** The search language as every process that reads it gets it from Compose. */
const LANGUAGE = '${GBRAIN_FTS_LANGUAGE:-english}';

/** True when git ignores the path: `git check-ignore` answers with exit code 1 when it does not. */
function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd: REPO_ROOT });

    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 1) {
      return false;
    }

    throw error;
  }
}

/**
 * The search dictionaries of an installation (ADR 0050) pass through Compose, a script and
 * `init.sql`. If any link diverged, the database container would start without the dictionary,
 * and GBrain would fail on a missing search configuration, or search in a language other than the
 * one `init.sql` prepared.
 */
describe('search dictionaries of the installation', () => {
  const compose = composeFile('infra/compose.yaml');
  const postgres = compose.services.postgres;
  const installer = repoFile(INSTALLER);

  it('Postgres starts through the installer, which then runs the image entry point', () => {
    const [shell, target] = postgres?.entrypoint ?? [];
    const mounted = postgres?.configs?.find((config) => config.target === target);

    expect(shell).toBe('sh');
    expect(posix.join('infra', compose.configs?.[mounted?.source ?? '']?.file ?? '')).toBe(
      INSTALLER,
    );
    expect(postgres?.command).toEqual(['postgres']);
    expect(installer).toMatch(/^exec docker-entrypoint\.sh "\$@"$/m);
  });

  it('the installer reads the directory Compose mounts read-only at its source path', () => {
    const mount = (postgres?.volumes ?? []).find(
      (volume) => typeof volume !== 'string' && posix.join('infra', volume.source) === DICTIONARIES,
    );
    if (mount === undefined || typeof mount === 'string') throw new Error('no dictionary mount');

    expect(mount.read_only).toBe(true);
    expect(installer).toMatch(new RegExp(`^SOURCE=${mount.target}$`, 'm'));
  });

  it('init.sql and every GBrain process read the same search language', () => {
    const readers = ['postgres', 'gbrain', 'gbrain-maintenance'].map(
      (name) => compose.services[name]?.environment?.GBRAIN_FTS_LANGUAGE,
    );

    expect(readers).toEqual([LANGUAGE, LANGUAGE, LANGUAGE]);
    expect(repoFile('infra/postgres/init.sql')).toMatch(
      /^\\getenv fts_language GBRAIN_FTS_LANGUAGE$/m,
    );
  });

  it('git carries the directory but not the dictionaries', () => {
    expect(existsSync(resolve(REPO_ROOT, DICTIONARIES, '.gitkeep'))).toBe(true);
    expect(isIgnored(`${DICTIONARIES}/.gitkeep`)).toBe(false);
    expect(
      ['uk_UA.dic', 'uk_UA.aff', 'uk_UA.stop', 'LICENSE'].map((name) =>
        isIgnored(`${DICTIONARIES}/${name}`),
      ),
    ).toEqual([true, true, true, true]);
    expect(isIgnored(INSTALLER)).toBe(false);
  });
});
