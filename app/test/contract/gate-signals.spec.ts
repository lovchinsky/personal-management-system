import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STOP_SIGNALS } from '../gate/abort-guard';
import { NEEDS_PERSON, needsPersonLine, PERSON_DONE, personDoneLine } from '../gate/gate-signals';
import { repoFile } from './contracts';

/**
 * The protocol between the gate and the wrapper `infra/bin/gate` (ADR 0041): the gate asks the
 * person with a stderr line that starts with a marker, and the wrapper on the host announces it
 * aloud until the all-clear arrives. The wrapper is bash and does not import markers from
 * TypeScript, so the test runs the real script against stubs (without Docker, Notion or voice) and
 * feeds it lines built by the same functions the gate uses.
 */

const REMINDER = 'say: Gate needs you. Resolve the thread in Notion.';
const FINISHED = 'say: Gate m5 finished with code 0.';

/** How many reminders have already sounded: the `say` stub appends a line to the log. */
const COUNT = `count() { if [ -f "$LOG" ]; then grep -c '^${REMINDER}' "$LOG" || true; else echo 0; fi; }`;

interface Outcome {
  readonly code: number | null;
  /** Everything the `say` stub said, in order. */
  readonly said: string[];
  /** How many reminders the log held at two readings after the all-clear. */
  readonly afterDone: readonly string[];
}

/**
 * Runs the wrapper against stubs: `dc` (the gate runs inside it as `gateBody`), `say` and a
 * separate `TMPDIR`, so that the lock does not touch the operator's real gate.
 */
async function runWrapper(gateBody: string, env: Record<string, string> = {}): Promise<Outcome> {
  const root = mkdtempSync(join(tmpdir(), 'gate-signals-'));
  const bin = join(root, 'infra', 'bin');
  const stubs = join(root, 'stubs');
  const log = join(root, 'said.log');
  const out = join(root, 'out');

  try {
    for (const dir of [bin, stubs, join(root, 'tmp'), out]) mkdirSync(dir, { recursive: true });

    writeFileSync(join(bin, 'gate'), repoFile('infra/bin/gate'), { mode: 0o755 });
    writeFileSync(join(root, 'infra', '.env.gate'), 'GATE_NOTION_API_TOKEN=stub\n');
    writeFileSync(
      join(bin, 'dc'),
      [
        '#!/usr/bin/env bash',
        COUNT,
        'case "$*" in',
        '  *"workspace/prepare.js --check"*) exit 0 ;;',
        `  *"node dist-gate/test/gate/"*) ${gateBody} ;;`,
        '  *) exit 0 ;;',
        'esac',
      ].join('\n'),
    );
    writeFileSync(join(stubs, 'say'), '#!/usr/bin/env bash\necho "say: $*" >> "$LOG"\n');
    for (const file of [join(bin, 'dc'), join(stubs, 'say')]) chmodSync(file, 0o755);

    const code = await new Promise<number | null>((done) => {
      const child = spawn('bash', [join(bin, 'gate'), 'm5'], {
        env: {
          ...process.env,
          ...env,
          PATH: `${stubs}:${process.env.PATH ?? ''}`,
          TMPDIR: join(root, 'tmp'),
          GATE_REMIND_SECONDS: '0.2',
          LOG: log,
          OUT: out,
          NEEDS: needsPersonLine('m5 gate: resolve the thread on https://x now').trimEnd(),
          DONE: personDoneLine('m5 gate: the thread is resolved, going on').trimEnd(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.resume();
      child.stderr.resume();
      child.on('close', done);
    });
    const read = (file: string): string =>
      existsSync(join(out, file)) ? readFileSync(join(out, file), 'utf8').trim() : 'missing';

    return {
      code,
      said: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [],
      afterDone: [read('after-done-1'), read('after-done-2')],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('gate signals and the wrapper', () => {
  /** A signal that the wrapper traps but the gate does not would kill the gate mid-cleanup. */
  it('the wrapper traps exactly the stop signals the gate cleans up on', () => {
    const trapped = [
      ...repoFile('infra/bin/gate').matchAll(/^trap 'on_signal ([A-Z]+)' ([A-Z]+)$/gm),
    ];

    // The handler knows which signal arrived: HUP means the terminal is already gone.
    expect(trapped.every(([, named, caught]) => named === caught)).toBe(true);
    expect(trapped.map(([, name]) => `SIG${name}`).sort()).toEqual([...STOP_SIGNALS].sort());
  });

  /** A marker in the protocol header comment does not count: the parsing line itself is needed. */
  it.each([NEEDS_PERSON, PERSON_DONE])(
    'the wrapper parses marker %s at the start of a line',
    (marker) => {
      expect(repoFile('infra/bin/gate')).toMatch(new RegExp(`^\\s*${marker}\\*\\)`, 'm'));
    },
  );

  /**
   * The request calls the operator, the all-clear stops it, and at the end the wrapper announces
   * the exit code.
   */
  it('the request sounds, the all-clear stops it, the exit code comes last', async () => {
    const outcome = await runWrapper(
      [
        'printf "%s\\n" "$NEEDS" >&2',
        'for _ in $(seq 1 100); do [ "$(count)" -ge 1 ] && break; sleep 0.05; done',
        'printf "%s\\n" "$DONE" >&2',
        'sleep 0.6; count > "$OUT/after-done-1"',
        'sleep 0.6; count > "$OUT/after-done-2"',
        "echo '{}'",
      ].join('; '),
    );
    const [first, second] = outcome.afterDone;

    expect(outcome.code).toBe(0);
    expect(Number(first)).toBeGreaterThanOrEqual(1);
    // After the all-clear there are no more reminders: the window is twice as long as the pause
    // between them.
    expect(second).toBe(first);
    expect(outcome.said.at(-1)).toBe(FINISHED);
  }, 20_000);

  /** The same text without a marker at the start of a line switches nothing on. */
  it.each([
    ['prose without a marker', 'm5 gate: resolve the thread on https://x now'],
    ['a marker not at the start', `note: ${NEEDS_PERSON} is quoted here`],
  ])(
    '%s is not a signal',
    async (_, line) => {
      const outcome = await runWrapper(`printf "%s\\n" '${line}' >&2; sleep 0.8; echo '{}'`);

      expect(outcome.said).toEqual([FINISHED]);
    },
    20_000,
  );

  it('GATE_QUIET turns the voice off completely', async () => {
    const outcome = await runWrapper('printf "%s\\n" "$NEEDS" >&2; sleep 0.8; echo \'{}\'', {
      GATE_QUIET: '1',
    });

    expect(outcome.said).toEqual([]);
  }, 20_000);
});

interface Stopped {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The requests the wrapper made to `docker kill`, in order. */
  readonly kills: readonly string[];
}

/**
 * Runs the wrapper against stubs. The operator sends it `signals` signals (Ctrl+C). The `docker`
 * stub records the `kill` requests and tells the gate about them through a file. The gate handles
 * TERM as a stop with cleanup (a verdict stub, code 143), and KILL aborts it at once.
 */
async function stopWrapper(signals: number): Promise<Stopped> {
  const root = mkdtempSync(join(tmpdir(), 'gate-stop-'));
  const bin = join(root, 'infra', 'bin');
  const stubs = join(root, 'stubs');
  const out = join(root, 'out');

  try {
    for (const dir of [bin, stubs, join(root, 'tmp'), out]) mkdirSync(dir, { recursive: true });

    writeFileSync(join(bin, 'gate'), repoFile('infra/bin/gate'), { mode: 0o755 });
    writeFileSync(join(root, 'infra', '.env.gate'), 'GATE_NOTION_API_TOKEN=stub\n');
    writeFileSync(
      join(bin, 'dc'),
      [
        '#!/usr/bin/env bash',
        'case "$*" in',
        '  *"workspace/prepare.js --check"*) exit 0 ;;',
        '  *"node dist-gate/test/gate/"*)',
        '    echo ready >&2',
        '    for _ in $(seq 1 200); do',
        '      [ -f "$OUT/KILL" ] && exit 137',
        '      if [ -f "$OUT/TERM" ]; then echo \'{"aborted":"SIGTERM"}\'; exit 143; fi',
        '      sleep 0.05',
        '    done ;;',
        '  *) exit 0 ;;',
        'esac',
      ].join('\n'),
    );
    writeFileSync(
      join(stubs, 'docker'),
      [
        '#!/usr/bin/env bash',
        '[ "$1" = kill ] || exit 0',
        'echo "$*" >> "$OUT/kills"',
        // The gate does not act on the TERM request at once: cleanup takes time, so the second
        // signal has time to arrive.
        '[ "$2" = "--signal" ] && [ "$3" = TERM ] && (sleep 0.6; touch "$OUT/TERM") &',
        '[ "$2" = "--signal" ] && [ "$3" = KILL ] && touch "$OUT/KILL"',
        'exit 0',
      ].join('\n'),
    );
    for (const file of [join(bin, 'dc'), join(stubs, 'docker')]) chmodSync(file, 0o755);

    let stdout = '';
    let stderr = '';
    const code = await new Promise<number | null>((done) => {
      const child = spawn('bash', [join(bin, 'gate'), 'm5'], {
        env: {
          ...process.env,
          PATH: `${stubs}:${process.env.PATH ?? ''}`,
          TMPDIR: join(root, 'tmp'),
          GATE_QUIET: '1',
          OUT: out,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let sent = 0;

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();

        if (sent === 0 && stderr.includes('ready')) {
          for (; sent < signals; sent += 1) {
            setTimeout(() => child.kill('SIGINT'), 100 + sent * 200);
          }
        }
      });
      child.on('close', done);
    });
    const kills = existsSync(join(out, 'kills'))
      ? readFileSync(join(out, 'kills'), 'utf8').split('\n').filter(Boolean)
      : [];

    return { code, stdout, stderr, kills };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the operator stopping the gate', () => {
  it('Ctrl+C asks the gate to stop: it cleans up, writes a stub, and the exit code is its own', async () => {
    const stopped = await stopWrapper(1);

    expect(stopped.kills).toEqual(['kill --signal TERM personal-management-system-gate-run']);
    expect(stopped.stdout.trim()).toBe('{"aborted":"SIGTERM"}');
    expect(stopped.code).toBe(143);
    expect(stopped.stderr).toContain('signal again to stop it at once');
  }, 20_000);

  it('a second Ctrl+C stops the container at once', async () => {
    const stopped = await stopWrapper(2);

    expect(stopped.kills).toEqual([
      'kill --signal TERM personal-management-system-gate-run',
      'kill --signal KILL personal-management-system-gate-run',
    ]);
    expect(stopped.stderr).toContain('stopping the gate at once');
  }, 20_000);
});
