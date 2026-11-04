import { EventEmitter } from 'node:events';
import { AbortGuard, STOP_SIGNALS } from './abort-guard';

/**
 * Builds a guard on an emitter: signals “arrive” through `emit`, and the effects stay in a log.
 */
function guard(): {
  source: EventEmitter;
  guard: AbortGuard;
  events: string[];
  stdout: string[];
  exited: Promise<number>;
} {
  const source = new EventEmitter();
  const events: string[] = [];
  const stdout: string[] = [];
  let exit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    exit = resolve;
  });

  return {
    source,
    events,
    stdout,
    exited,
    guard: new AbortGuard('m5', {
      signals: {
        on: (signal, listener) => source.on(signal, listener),
        off: (signal, listener) => source.off(signal, listener),
      },
      close: () => {
        events.push('close');

        return Promise.resolve();
      },
      stdout: (text) => stdout.push(text),
      stderr: () => undefined,
      exit,
    }),
  };
}

describe('AbortGuard', () => {
  it('runs nothing before a signal', () => {
    const { guard: abort, events } = guard();

    abort.hold(() => {
      events.push('cleanup');

      return Promise.resolve([]);
    });
    abort.arm();

    expect(events).toEqual([]);
  });

  it('on SIGTERM cleans up, then closes the application, writes the stub and exits with 143', async () => {
    const { source, guard: abort, events, stdout, exited } = guard();

    abort.hold(() => {
      events.push('cleanup');

      return Promise.resolve(['page p1: Notion is down']);
    });
    abort.arm();
    source.emit('SIGTERM');

    expect(await exited).toBe(143);
    expect(events).toEqual(['cleanup', 'close']);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      gate: 'M5',
      ok: false,
      aborted: 'SIGTERM',
      cleanup: { clean: false, left: ['page p1: Notion is down'] },
    });
  });

  it('SIGINT yields 130', async () => {
    const { source, guard: abort, exited } = guard();

    abort.arm();
    source.emit('SIGINT');

    expect(await exited).toBe(130);
  });

  it('a failure of one cleanup does not stop the rest and ends up in the residue', async () => {
    const { source, guard: abort, events, stdout, exited } = guard();

    abort.hold(() => Promise.reject(new Error('boom')));
    abort.hold(() => {
      events.push('second');

      return Promise.resolve([]);
    });
    abort.arm();
    source.emit('SIGTERM');
    await exited;

    expect(events).toEqual(['second', 'close']);
    expect(JSON.parse(stdout.join(''))).toMatchObject({ cleanup: { left: ['cleanup: boom'] } });
  });

  it('SIGHUP, a closed terminal, cleans up the same way and yields 129', async () => {
    const { source, guard: abort, events, exited } = guard();

    abort.hold(() => {
      events.push('cleanup');

      return Promise.resolve([]);
    });
    abort.arm();
    source.emit('SIGHUP');

    expect(await exited).toBe(129);
    expect(events).toEqual(['cleanup', 'close']);
  });

  /**
   * Compose passes the operator's signal to the container, and the wrapper also asks for TERM, so
   * the two signals are one stop.
   */
  it('a signal during cleanup neither interrupts it nor starts it a second time', async () => {
    const { source, guard: abort, events, stdout, exited } = guard();
    let release: () => void = () => undefined;

    abort.hold(async () => {
      events.push('cleanup');
      await new Promise<void>((resolve) => {
        release = resolve;
      });

      return [];
    });
    abort.arm();
    source.emit('SIGINT');
    source.emit('SIGTERM');
    source.emit('SIGINT');
    release();

    expect(await exited).toBe(130);
    expect(events).toEqual(['cleanup', 'close']);
    expect(stdout).toHaveLength(1);
  });

  /** `> gate-mN.json` stays a single JSON document whenever the signal arrives. */
  it('a verdict before the signal is the only document: there is no stub after it', async () => {
    const { source, guard: abort, stdout, exited } = guard();

    abort.arm();
    abort.report({ gate: 'M5', ok: true });
    source.emit('SIGTERM');
    await exited;

    expect(stdout.map((text): unknown => JSON.parse(text))).toEqual([{ gate: 'M5', ok: true }]);
  });

  it('a verdict is not written during a stop: the document is the stub', async () => {
    const { source, guard: abort, stdout, exited } = guard();

    abort.arm();
    source.emit('SIGINT');
    abort.report({ gate: 'M5', ok: true });
    await exited;

    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0] ?? '')).toMatchObject({ aborted: 'SIGINT' });
  });

  it('disarm removes the listeners of all stop signals', () => {
    const { source, guard: abort } = guard();

    abort.arm();
    abort.disarm();

    expect(STOP_SIGNALS.map((signal) => source.listenerCount(signal))).toEqual([0, 0, 0]);
  });
});

describe('AbortGuard: the stop is visible alongside the work', () => {
  it('is not stopping before the signal and is stopping from the signal on, while cleanup is still running', async () => {
    const { source, guard: abort, exited } = guard();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    abort.hold(async () => {
      await held;

      return [];
    });
    abort.arm();

    expect(abort.stopping).toBe(false);

    source.emit('SIGTERM');

    expect(abort.stopping).toBe(true);

    release();
    await exited;

    expect(abort.stopping).toBe(true);
  });
});
