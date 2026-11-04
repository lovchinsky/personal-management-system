import { Logger } from '@nestjs/common';
import { PollingWorker } from './polling.worker';
import { type WorkersConfig } from './workers.config';

class ProbeWorker extends PollingWorker {
  constructor(protected readonly workers: WorkersConfig = { enabled: true }) {
    super();
  }

  readonly started: Date[] = [];

  failNext = false;
  gate?: () => void;

  /** How many ticks are inside at the same time, and the most there ever were. */
  inside = 0;
  peak = 0;

  protected tickMs(): number {
    return 1_000;
  }

  protected async tick(): Promise<number> {
    this.started.push(new Date());
    this.inside += 1;
    this.peak = Math.max(this.peak, this.inside);

    try {
      if (this.failNext) {
        this.failNext = false;
        throw new Error('bad row');
      }

      if (this.gate) {
        await new Promise<void>((resolve) => {
          this.gate = resolve;
        });
      }

      return 1;
    } finally {
      this.inside -= 1;
    }
  }
}

describe('PollingWorker', () => {
  let worker: ProbeWorker;
  let logged: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    worker = new ProbeWorker();
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await worker.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('the first tick runs without a pause', async () => {
    worker.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(0);

    expect(worker.started).toHaveLength(1);
  });

  it('the next tick is scheduled once the one before it has finished', async () => {
    worker.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(999);

    expect(worker.started).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(1);

    expect(worker.started).toHaveLength(2);
  });

  /**
   * The class's most important claim: a loop that dies from one bad row stops all of the
   * application's work until the next restart.
   */
  it('a tick error does not stop the loop and leaves a log entry', async () => {
    worker.failNext = true;
    worker.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(worker.started).toHaveLength(2);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  /**
   * The class's promise — “ticks cannot overlap, by construction” — covers a manual tick too:
   * `runOnce` bypassing the queue would meet the next tick on the same rows, causing either an
   * extra claim or an extra run, depending on who got there first.
   */
  it('a manual tick does not overlap a loop tick', async () => {
    worker.gate = () => undefined;
    worker.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(0);

    expect(worker.started).toHaveLength(1);

    const manual = worker.runOnce();

    await jest.advanceTimersByTimeAsync(0);

    // The manual tick has not even started yet: the queue is busy with the loop's tick.
    expect(worker.started).toHaveLength(1);

    worker.gate?.();
    worker.gate = undefined;
    await manual;

    expect(worker.started).toHaveLength(2);
    expect(worker.peak).toBe(1);
  });

  it('two manual ticks run one after the other, not together', async () => {
    worker.gate = () => undefined;

    const first = worker.runOnce();
    const second = worker.runOnce();

    await jest.advanceTimersByTimeAsync(0);

    worker.gate?.();
    worker.gate = undefined;

    await Promise.all([first, second]);

    expect(worker.peak).toBe(1);
    expect(worker.started).toHaveLength(2);
  });

  /** The failure of one tick must not jam the queue for the next. */
  it('a failed tick does not block the queue', async () => {
    worker.failNext = true;

    await expect(worker.runOnce()).rejects.toThrow('bad row');
    await expect(worker.runOnce()).resolves.toBe(1);
  });

  it('the first tick can be delayed', async () => {
    class DelayedWorker extends ProbeWorker {
      protected override initialDelayMs(): number {
        return 5_000;
      }
    }

    const delayed = new DelayedWorker();

    delayed.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(4_999);

    expect(delayed.started).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(1);

    expect(delayed.started).toHaveLength(1);

    await delayed.onApplicationShutdown();
  });

  /**
   * The gate command starts a second App instance alongside the main one: its loops would claim
   * the same rows, and with the runner enabled would turn them into runs. The manual tick remains
   * because the gate itself would tick through it.
   */
  it('with background work off, the loop does not start and the manual tick remains', async () => {
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const off = new ProbeWorker({ enabled: false });

    off.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(10_000);

    expect(off.started).toHaveLength(0);
    expect(warned).toHaveBeenCalledWith('loop not started: WORKERS_ENABLED=false');

    await expect(off.runOnce()).resolves.toBe(1);

    await off.onApplicationShutdown();
  });

  it('after a stop there are no new ticks', async () => {
    worker.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(0);
    await worker.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(worker.started).toHaveLength(1);
  });

  it('a stop waits for a tick that is already running', async () => {
    worker.gate = () => undefined;
    worker.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(0);

    let finished = false;
    const stopping = worker.onApplicationShutdown().then(() => {
      finished = true;
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(finished).toBe(false);

    worker.gate?.();
    await stopping;

    expect(finished).toBe(true);
  });
});
