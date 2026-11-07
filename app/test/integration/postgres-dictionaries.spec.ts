import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { composeFile, REPO_ROOT } from '../contract/contracts';

/**
 * The search dictionary in the database container (ADR 0050), with the image, entry point and
 * mounts that Compose gives the `postgres` service: the installer copies the dictionary into
 * Postgres, and `init.sql` builds the search configuration that GBrain uses. The test runs its own
 * container next to the test database and removes it, with its volume, at the end.
 */

const CONTAINER = 'personal-management-system-test-dictionaries';

/** A password of the shape `init.sql` accepts: the container is local and lives for one run. */
const PASSWORD = '0'.repeat(64);

const LANGUAGE = 'xx_xx';

/**
 * A dictionary written for this test in the hunspell format: a Cyrillic noun with three suffix
 * rules and a Latin noun with two, so that both scripts go through the dictionary, a stop word,
 * and a file that is not part of a dictionary.
 */
const DICTIONARY: Readonly<Record<string, readonly string[]>> = {
  'xx_XX.aff': [
    'SET UTF-8',
    '',
    'SFX A Y 3',
    'SFX A а і а',
    'SFX A а у а',
    'SFX A а ами а',
    '',
    'SFX B Y 2',
    'SFX B 0 y .',
    'SFX B 0 ów .',
  ],
  'xx_XX.dic': ['2', 'задача/A', 'kot/B'],
  'xx_XX.stop': ['з'],
  'LICENSE.txt': ['The license of the dictionary.'],
};

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function docker(args: readonly string[]): Run {
  const run = spawnSync('docker', args, { encoding: 'utf8' });
  if (run.error) throw run.error;

  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

const compose = composeFile('infra/compose.yaml');
const postgres = compose.services.postgres;
const initTarget =
  postgres?.configs?.find(({ source }) => source === 'postgres_init')?.target ?? '';

/** The image, entry point and mounts of the `postgres` service, with a given dictionary directory. */
function service(dictionaries: string): string[] {
  const configs = (postgres?.configs ?? []).flatMap(({ source, target }) => [
    '-v',
    `${resolve(REPO_ROOT, 'infra', compose.configs?.[source]?.file ?? '')}:${target}:ro`,
  ]);
  const directory = (postgres?.volumes ?? []).find(
    (volume) =>
      typeof volume !== 'string' && posix.normalize(volume.source) === 'postgres/dictionaries',
  );
  if (directory === undefined || typeof directory === 'string') {
    throw new Error('Compose mounts no dictionary directory into postgres');
  }
  const [shell = '', installer = ''] = postgres?.entrypoint ?? [];

  return [
    ...configs,
    '-v',
    `${dictionaries}:${directory.target}:ro`,
    '--entrypoint',
    shell,
    postgres?.image ?? '',
    installer,
  ];
}

const directories: string[] = [];

/** A dictionary directory as an owner may keep it: files readable by their owner only. */
function dictionaryDirectory(files: Readonly<Record<string, readonly string[]>>): string {
  const directory = mkdtempSync(join(tmpdir(), 'pms-dictionaries-'));
  directories.push(directory);

  for (const [name, lines] of Object.entries(files)) {
    const path = join(directory, name);
    writeFileSync(path, `${lines.join('\n')}\n`);
    chmodSync(path, 0o600);
  }

  return directory;
}

/** Runs only the installer and lists what it installed, with the permissions. */
function install(files: Readonly<Record<string, readonly string[]>>): Run {
  return docker([
    'run',
    '--rm',
    ...service(dictionaryDirectory(files)),
    'sh',
    '-c',
    'cd "$(pg_config --sharedir)/tsearch_data" && for file in $(cat .installed-dictionaries 2>/dev/null); do stat -c "%n %a" "$file"; done',
  ]);
}

function query(sql: string): string {
  const run = docker([
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-d',
    'gbrain_db',
    '-v',
    'ON_ERROR_STOP=1',
    '-Atq',
    '-c',
    sql,
  ]);
  if (run.status !== 0) throw new Error(run.stderr);

  return run.stdout.trim();
}

function rerunInit(language: string): Run {
  return docker([
    'exec',
    '-e',
    `GBRAIN_FTS_LANGUAGE=${language}`,
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-f',
    initTarget,
  ]);
}

/** The dictionaries and configurations that `init.sql` created in `gbrain_db`. */
function searchObjects(): string {
  return query(
    `SELECT (SELECT string_agg(dictname, ' ' ORDER BY dictname) FROM pg_ts_dict WHERE dictnamespace = 'public'::regnamespace)
      || ' / ' || (SELECT string_agg(cfgname, ' ' ORDER BY cfgname) FROM pg_ts_config WHERE cfgnamespace = 'public'::regnamespace)`,
  );
}

async function untilReady(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    // Over TCP, as the Compose health check: during `init.sql` the server listens only on the socket.
    if (
      docker(['exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0
    ) {
      return;
    }
    if (docker(['inspect', '-f', '{{.State.Running}}', CONTAINER]).stdout.trim() !== 'true') {
      const logs = docker(['logs', CONTAINER]);
      throw new Error(`the database container stopped:\n${logs.stdout}${logs.stderr}`);
    }
    await new Promise((settle) => setTimeout(settle, 500));
  }

  throw new Error('the database container did not become ready');
}

/** The dictionary directory of the test container. */
let mounted = '';

beforeAll(async () => {
  docker(['rm', '-f', '-v', CONTAINER]);
  mounted = dictionaryDirectory(DICTIONARY);
  const started = docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    `POSTGRES_PASSWORD=${PASSWORD}`,
    '-e',
    `APP_DB_PASSWORD=${PASSWORD}`,
    '-e',
    `GBRAIN_DB_PASSWORD=${PASSWORD}`,
    '-e',
    `GBRAIN_FTS_LANGUAGE=${LANGUAGE}`,
    ...service(mounted),
    ...(postgres?.command ?? []),
  ]);
  if (started.status !== 0) throw new Error(started.stderr);

  await untilReady();
}, 120_000);

afterAll(() => {
  docker(['rm', '-f', '-v', CONTAINER]);
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe('search dictionaries in the database container', () => {
  it('installs the hunspell files under the lowercase name, readable by the server, and skips the rest', () => {
    const run = install(DICTIONARY);
    const listed = run.stdout.split('\n').filter((line) => /^\w+\.\w+ \d+$/.test(line));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      'install-dictionaries: installed xx_xx.dict xx_xx.affix xx_xx.stop',
    );
    expect(listed).toEqual(['xx_xx.dict 644', 'xx_xx.affix 644', 'xx_xx.stop 644']);
  });

  it('refuses a file of the image and a name Postgres cannot read', () => {
    const image = install({ 'english.stop': ['the'] });
    const name = install({ 'xx-XX.dic': ['1', 'word'] });

    expect([image.status, name.status]).toEqual([1, 1]);
    expect(image.stderr).toContain('english.stop is a file of the Postgres image');
    expect(name.stderr).toContain('xx-XX.dic: a dictionary name is');
  });

  it('init.sql builds the configuration: every word goes through the stop list and the dictionary', () => {
    expect(
      query(
        `SELECT cfgnamespace::regnamespace || '.' || cfgname FROM pg_ts_config WHERE cfgname = '${LANGUAGE}'`,
      ),
    ).toBe(`public.${LANGUAGE}`);
    expect(
      query(`SELECT to_tsvector('${LANGUAGE}', 'Задачі задачами kotów koty з невідоме 42')::text`),
    ).toBe("'42':7 'kot':3,4 'задача':1,2 'невідоме':6");
    expect(
      query(
        `SET ROLE gbrain_user; SELECT to_tsvector('${LANGUAGE}', 'задачу') @@ websearch_to_tsquery('${LANGUAGE}', 'задача')`,
      ),
    ).toBe('t');
  });

  it('running init.sql again keeps the search objects as they are', () => {
    const before = searchObjects();

    expect(rerunInit(LANGUAGE).status).toBe(0);
    expect(searchObjects()).toBe(before);
    expect(before).toBe(`${LANGUAGE} ${LANGUAGE}_stopwords / ${LANGUAGE}`);
  });

  it('a built-in language needs no dictionary', () => {
    const before = searchObjects();

    expect(rerunInit('german').status).toBe(0);
    expect(searchObjects()).toBe(before);
  });

  it('stops on a language without a dictionary, on a name GBrain ignores and on a dictionary named like a built-in language', () => {
    const tsearch = 'cd "$(pg_config --sharedir)/tsearch_data"';
    const missing = rerunInit('yy_yy');
    const invalid = rerunInit('Uk-UA');
    docker([
      'exec',
      '-u',
      'root',
      CONTAINER,
      'sh',
      '-c',
      `${tsearch} && cp xx_xx.dict russian.dict && cp xx_xx.affix russian.affix`,
    ]);
    const shadowed = rerunInit('russian');
    docker([
      'exec',
      '-u',
      'root',
      CONTAINER,
      'sh',
      '-c',
      `${tsearch} && rm russian.dict russian.affix`,
    ]);

    expect([missing.status, invalid.status, shadowed.status]).toEqual([3, 3, 3]);
    expect(missing.stderr).toContain(
      'GBRAIN_FTS_LANGUAGE "yy_yy" is neither a built-in configuration nor an installed dictionary',
    );
    expect(invalid.stderr).toContain('GBRAIN_FTS_LANGUAGE "Uk-UA" is not a configuration name');
    expect(shadowed.stderr).toContain('GBRAIN_FTS_LANGUAGE "russian" is a built-in configuration');
  });

  // Last: it changes the dictionary of the test container.
  it('follows the directory: a stop-word list taken out of it leaves Postgres and the configuration', async () => {
    rmSync(join(mounted, 'xx_XX.stop'));
    expect(docker(['restart', CONTAINER]).status).toBe(0);
    await untilReady();

    expect(
      docker([
        'exec',
        CONTAINER,
        'sh',
        '-c',
        'cd "$(pg_config --sharedir)/tsearch_data" && ls xx_xx.*',
      ]).stdout.split('\n'),
    ).toEqual(['xx_xx.affix', 'xx_xx.dict', '']);
    expect(rerunInit(LANGUAGE).status).toBe(0);
    expect(searchObjects()).toBe(`${LANGUAGE} / ${LANGUAGE}`);
    expect(query(`SELECT to_tsvector('${LANGUAGE}', 'з задачу')::text`)).toBe("'з':1 'задача':2");
  }, 60_000);
});
