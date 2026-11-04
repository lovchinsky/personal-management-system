import { Inject, Injectable } from '@nestjs/common';
import { secondsToMilliseconds } from 'date-fns';
import { ApprovalsService } from '../approvals/approvals.service';
import { appConfig, type AppConfig } from '../config/app.config';
import { DeliveryService } from '../delivery/delivery.service';
import {
  occurrenceAt,
  occurrenceBefore,
  type Occurrence,
  type Schedule,
} from '../platform/time/schedule';
import { PollingWorker } from '../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../platform/worker/workers.config';
import { RunGates } from '../runs/run-gates';
import type { ReviewMode } from '../runs/trigger-envelope';
import { isReviewMode, REVIEW_MODES } from './review-modes';
import { ReviewOccurrenceRepository } from './review-occurrence.repository';
import { reviewsConfig, type ReviewsConfig } from './reviews.config';

/**
 * The cause of a daily review without the period key: how the `event_id` of each of its
 * occurrences begins.
 */
const DAILY_REVIEW_CAUSE = 'review:daily_control:';

/**
 * The producer of review occurrences: every minute it places the current occurrence of each
 * enabled review, if it is not already placed and its window has not ended (ADR 0036).
 *
 * The period key identifies an occurrence, so repeated ticks, a restart and a clock change do not
 * produce a second one. A review with no delivery channel or no runner is not placed: the packet
 * could be neither delivered nor produced, and an occurrence that would merely wait for the end of
 * its window would be a failure with nothing broken. The producer reports this in the log once per
 * change of state.
 *
 * Before a new daily occurrence, what the delivered packets of earlier daily reviews showed expires
 * if the person passed it by (ADR 0039): the end of one review is the start of the next.
 *
 * The producer tells the person about an occurrence that did not take place with one message
 * (`INV-105`).
 */
@Injectable()
export class ReviewPlanner extends PollingWorker {
  /**
   * What the producer last said about the channel and the runner, so it logs only on transitions.
   */
  private channelSeen: boolean | undefined;
  private runnerSeen: boolean | undefined;

  constructor(
    private readonly occurrences: ReviewOccurrenceRepository,
    private readonly delivery: DeliveryService,
    private readonly approvals: ApprovalsService,
    private readonly gates: RunGates,
    @Inject(reviewsConfig.KEY) private readonly config: ReviewsConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return secondsToMilliseconds(this.config.tickSeconds);
  }

  protected async tick(): Promise<number> {
    return (await this.plan(new Date())) + (await this.noticeFailures());
  }

  /** Places the occurrences that fall on `now` and returns how many were placed. */
  async plan(now: Date): Promise<number> {
    if (!this.channelReady() || !this.runnerReady()) return 0;

    let placed = 0;

    for (const mode of REVIEW_MODES) {
      const schedule = this.config.schedules[mode];
      const occurrence = occurrenceAt(schedule, this.app.timeZone, now);

      if (!occurrence || now >= occurrence.closesAt) continue;
      if (await this.occurrences.exists(mode, occurrence.key)) continue;
      if (mode === 'daily_control') await this.lapseShown();

      const sinceAt = await this.sinceOf(mode, schedule, occurrence);
      const fresh = await this.occurrences.place({
        mode,
        occurrenceKey: occurrence.key,
        dueAt: occurrence.at,
        closesAt: occurrence.closesAt,
        sinceAt,
      });

      if (fresh) {
        placed += 1;
        this.logger.log(`review ${mode} ${occurrence.key} placed`);
      }
    }

    return placed;
  }

  /**
   * Tells the person about every occurrence that did not take place, both after exhausted attempts
   * and when retired past the window, because there is no catching up on reviews (ADR 0036) and
   * silence without a message would read as “nothing was found”. The mark follows the delivery
   * queue, and a failure between the two only repeats the same delivery key, so no second message
   * is enqueued. Returns how many occurrences the person was told about.
   */
  async noticeFailures(): Promise<number> {
    if (!this.channelReady()) return 0;

    const failures = await this.occurrences.unnoticedFailures();

    for (const occurrence of failures) {
      const { mode } = occurrence;

      if (!isReviewMode(mode)) {
        throw new Error(`review occurrence ${occurrence.id}: ${mode} is not a review`);
      }

      await this.delivery.reviewFailed({
        mode,
        occurrenceKey: occurrence.occurrenceKey,
        reason: occurrence.lastError,
      });
      await this.occurrences.markFailureNoticed(occurrence.id);
    }

    return failures.length;
  }

  /**
   * Returns the point in time from which a review looks at changes: the last carried-out
   * occurrence, but no further back than two periods; with none, one period back. This way a missed
   * occurrence does not lose the changes of its period, and an old review does not drag half a year
   * of history behind it.
   */
  private async sinceOf(
    mode: ReviewMode,
    schedule: Schedule,
    occurrence: Occurrence,
  ): Promise<Date> {
    const zone = this.app.timeZone;
    const previous = occurrenceBefore(schedule, zone, occurrence);
    const horizon = previous && occurrenceBefore(schedule, zone, previous);
    const done = await this.occurrences.lastDone(mode, occurrence.at);

    if (done === null) return previous?.at ?? occurrence.at;

    return horizon && horizon.at > done ? horizon.at : done;
  }

  /** Expires the proposals shown by the delivered packets of daily reviews. */
  private async lapseShown(): Promise<void> {
    const shown = await this.delivery.proposalsShown(DAILY_REVIEW_CAUSE);
    const lapsed = await this.approvals.lapseShown(shown);

    if (lapsed > 0) this.logger.log(`${lapsed} proposal(s) shown by a daily review lapsed`);
  }

  private runnerReady(): boolean {
    const ready = this.gates.runnerWired;

    if (ready !== this.runnerSeen) {
      this.runnerSeen = ready;

      if (!ready) this.logger.warn('reviews are not placed: the installation has no runner');
    }

    return ready;
  }

  private channelReady(): boolean {
    const ready = this.delivery.hasChannel();

    if (ready !== this.channelSeen) {
      this.channelSeen = ready;

      if (!ready) this.logger.warn('reviews are not placed: no delivery channel is configured');
    }

    return ready;
  }
}
