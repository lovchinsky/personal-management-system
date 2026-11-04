import { Inject, Injectable } from '@nestjs/common';
import { secondsToMilliseconds } from 'date-fns';
import { messageOf } from '../platform/error/message-of';
import { PollingWorker } from '../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../platform/worker/workers.config';
import { deniedBy, RunGates } from './run-gates';
import { byPriority } from './run-priority';
import { ClaimedRun, RUN_SOURCES, RunCandidate, RunSource } from './run-source';
import { DispatchResult, RunDispatcher } from './run.dispatcher';
import { runsConfig, type RunsConfig } from './runs.config';

/**
 * The run scheduler, one per process (ADR 0016).
 *
 * On each tick the sources retire rows that will do no more of their work, and the run gates say
 * what is currently allowed. From the candidates the gates let through, the best by run priority
 * is taken (`INV-085`), and only then is its row claimed, by id, right before the run. A tick
 * takes no more rows than there are free slots, and waits for their runs: two ticks do not
 * overlap.
 *
 * Closed gates leave rows untouched: a row waits as it was, and the scheduler waits on its behalf
 * (`INV-084`).
 */
@Injectable()
export class RunScheduler extends PollingWorker {
  /**
   * When the release of the Notion hold last let any row go (ADR 0045): a row that was waiting
   * then too is not released a second time.
   */
  private notionReleasedAt?: Date;

  constructor(
    @Inject(RUN_SOURCES) private readonly sources: readonly RunSource[],
    private readonly gates: RunGates,
    private readonly dispatcher: RunDispatcher,
    @Inject(runsConfig.KEY) private readonly runs: RunsConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return secondsToMilliseconds(this.runs.tickSeconds);
  }

  protected async tick(): Promise<number> {
    for (const source of this.sources) await source.retire();

    const gates = await this.gates.state();
    if (gates.all || gates.freeSlots === 0) {
      return 0;
    }

    const candidates = (await Promise.all(this.sources.map((source) => source.candidates())))
      .flat()
      .filter((candidate) => deniedBy(gates, candidate.provenance) === undefined)
      .sort(byPriority);

    const claimed = await this.claim(candidates, gates.freeSlots);

    // A tick waits for all of its runs, even when the disposition of one of them failed: otherwise
    // the next tick would take rows alongside runs that are still running.
    const settled = await Promise.allSettled(claimed.map((run) => this.run(run)));
    const failed = settled.find((outcome) => outcome.status === 'rejected');

    if (failed) {
      throw failed.reason;
    }

    return claimed.length;
  }

  /**
   * Claims candidates in run-priority order until the free slots are filled. A candidate that can
   * no longer be taken is skipped: its row was concluded, changed or went to another claimant.
   *
   * If a claim fails, the rows this tick has already claimed are released unchanged, and the error
   * propagates: their runs have not started, and they have no reason to stay under a lease until
   * the ticket expires (`docs/2-system.md` § “Run priority”).
   */
  private async claim(candidates: readonly RunCandidate[], slots: number): Promise<ClaimedRun[]> {
    const claimed: ClaimedRun[] = [];

    for (const candidate of candidates) {
      if (claimed.length === slots) break;

      let run: ClaimedRun | null;

      try {
        run = await candidate.claim();
      } catch (error) {
        for (const taken of claimed) await taken.release();

        throw error;
      }

      if (run) claimed.push(run);
    }

    return claimed;
  }

  /**
   * Runs the row, then applies the disposition that the run's outcome calls for.
   */
  private async run(run: ClaimedRun): Promise<void> {
    let result: DispatchResult;

    try {
      result = await this.dispatcher.dispatch({
        ...run.request,
        recordAttempt: async () => {
          await run.recordAttempt();
        },
      });
    } catch (error) {
      // The row goes back with a reason, and the error itself propagates to the worker loop, which
      // logs it with the stack. Whether the run reached Notion is unknown.
      await run.fail(messageOf(error), false);

      throw error;
    }

    // The disposition of the row is outside the `try`. Otherwise a failure in concluding the row
    // itself would read as a failure of the run, and a row whose run has already happened would go
    // back into the queue.
    await this.dispose(run, result);

    // The pauses are released only after the disposition: a failure to release them must not leave
    // a row whose run has already happened under a lease.
    if (result.started && result.notionReached) {
      await this.releaseNotionHolds();
    }
  }

  /**
   * How a run's outcome is applied to the row is decided here, once for all sources
   * (`docs/2-system.md` § “Scheduler and outbox”).
   */
  private async dispose(run: ClaimedRun, result: DispatchResult): Promise<void> {
    if (!result.started) {
      // The run gates closed after the state was read and before admission, or a run that
      // bypassed the scheduler took the slot: there was no run, and the row goes back as it was
      // claimed (`INV-084`).
      await run.release();

      return;
    }

    const { notionReached } = result;

    switch (result.verdict) {
      case 'completed':
        await this.settle(run, notionReached);
        return;

      // The run took place and reported a failure: the reason to look at the page has not gone
      // away, and an unavailable model or Notion is retried with the same profile (`INV-032`). The
      // retry limit is enforced by `attempt_count`, which is incremented before launch.
      case 'failed':
        await run.fail('run reported failure', notionReached);
        return;

      // The plan quota is not a failure of the row: the attempt is refunded, and until the quota
      // resets the run gates let no run through (ADR 0012).
      case 'plan_quota':
        await run.refund('run deferred: plan_quota', notionReached);
        return;

      // A run that did not reach Notion is not a failure either: the attempt is refunded, and only
      // this row waits; the others proceed as usual (ADR 0045).
      case 'notion':
        await run.waitForNotion('run deferred: Notion was not reached');
        return;
    }
  }

  /**
   * Releases the Notion hold after a run has just reached Notion, so the rows that were waiting
   * for Notion can be tried right away instead of after their own pause. Each row is released at
   * most once per consecutive wait. A row that was waiting at the prior release too again did not
   * reach Notion while Notion was answering others, so its failure most likely comes from the row
   * itself, and an immediate retry on every success of another row would bypass its pause.
   */
  private async releaseNotionHolds(): Promise<void> {
    const now = new Date();
    let released = 0;

    for (const source of this.sources) {
      released += await source.releaseNotionHolds(this.notionReleasedAt);
    }

    if (released === 0) return;

    this.notionReleasedAt = now;
    this.logger.log(`Notion answers again — ${released} waiting row(s) released`);
  }

  /**
   * Records the conclusion that the run reached.
   *
   * `superseded` is not a loss and is not worth a warning: the row changed during the run, went
   * back into the queue and will run together with what was folded into it. It must not be silent
   * either, because a hot page keeps cycling through this path. The queue reports the loss of a
   * lease.
   */
  private async settle(run: ClaimedRun, notionReached: boolean): Promise<void> {
    if ((await run.conclude(notionReached)) === 'superseded') {
      this.logger.log(`${run.id}: changed while the run was in flight — back in the queue`);
    }
  }
}
