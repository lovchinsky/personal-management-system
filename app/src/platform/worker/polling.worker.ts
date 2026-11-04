import { Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { messageOf, stackOf } from '../error/message-of';
import { type WorkersConfig } from './workers.config';

/**
 * A worker that periodically takes a batch of work from a queue in Postgres.
 *
 * A tick is rescheduled **after** the preceding tick finishes, not on an interval: this way two
 * ticks cannot overlap, by construction, and the concurrency limit does not have to be proven
 * separately. `setInterval` would start a second tick on top of the first every time the work takes
 * longer than the pause.
 *
 * A tick error is swallowed deliberately. Here catching an error adds value instead of hiding it,
 * because a loop that dies from one bad row stops all of the application's work until the next
 * restart. The error is logged, and the row is left with an expired lease and comes back on its
 * own.
 */
export abstract class PollingWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  protected readonly logger = new Logger(this.constructor.name);
  protected abstract readonly workers: WorkersConfig;

  /**
   * Returns the pause between ticks. It is a separate method because the value comes from
   * configuration.
   */
  protected abstract tickMs(): number;

  /**
   * Returns the pause before the **first** tick.
   *
   * It is zero for queues, because a row that came due during downtime must be processed right
   * away. It is not zero for periodic reconciliations: otherwise a restart loop turns a daily check
   * into a constant one, and the external system sees a barrage from us instead of one query a day.
   */
  protected initialDelayMs(): number {
    return 0;
  }

  /** Processes one batch of work. Returns how many rows were processed. */
  protected abstract tick(): Promise<number>;

  private timer?: NodeJS.Timeout;
  private stopped = false;

  /**
   * The queue of ticks. An empty `Promise` while nothing is running.
   *
   * The class promises that two ticks do not overlap, and rescheduling after completion guarantees
   * that promise only for the loop. So `runOnce` joins the same queue: otherwise it would meet the
   * next tick on the same rows.
   */
  private ticks: Promise<unknown> = Promise.resolve();

  /**
   * Starts the loop, unless background work is switched off.
   *
   * The gate instance switches it off: it conducts runs and ticks itself (ADR 0013, ADR 0041).
   * `runOnce` works then too.
   */
  onApplicationBootstrap(): void {
    if (!this.workers.enabled) {
      this.logger.warn('loop not started: WORKERS_ENABLED=false');
      return;
    }

    this.schedule(this.initialDelayMs());
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;

    if (this.timer) clearTimeout(this.timer);

    await this.ticks;
  }

  /**
   * Runs a tick immediately, in the same queue as the loop.
   *
   * Specs that drive time themselves tick through it. Alongside the loop it is a second driver of
   * the queue, so the integration lane switches the loops off (`WORKERS_ENABLED=false`) and the
   * specs tick by hand.
   */
  runOnce(): Promise<number> {
    return this.serialize(() => this.tick());
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => void this.cycle(), delayMs);

    this.timer.unref();
  }

  private async cycle(): Promise<void> {
    try {
      await this.serialize(() => this.tick());
    } catch (error) {
      this.logger.error(`tick failed: ${messageOf(error)}`, stackOf(error));
    } finally {
      this.schedule(this.tickMs());
    }
  }

  /** Runs the work after everything already in the queue, however that ends. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.ticks.then(work, work);

    this.ticks = next.catch(() => undefined);

    return next;
  }
}
