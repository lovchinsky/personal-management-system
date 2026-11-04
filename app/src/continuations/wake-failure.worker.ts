import { Inject, Injectable } from '@nestjs/common';
import { secondsToMilliseconds } from 'date-fns';
import { ScheduledCheck } from '../generated/prisma/client';
import { messageOf, stackOf } from '../platform/error/message-of';
import { PollingWorker } from '../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../platform/worker/workers.config';
import { isRequestedByPerson } from '../runs/provenance';
import { continuationsConfig, type ContinuationsConfig } from './continuations.config';
import { ScheduledCheckRepository } from './scheduled-check.repository';
import { causeOf } from './scheduled-check.rows';
import { WAKE_FAILURE_NOTICE, type WakeFailureNotice } from './wake-failure-notice';

/**
 * The App tells the person about a wake whose time the person named and that did not take place
 * (`INV-108`).
 *
 * The run of that wake would have told the person, but there was no such run: the attempts are
 * exhausted and the row is retired. Silence here is the worst kind of failure: the person asked
 * for a reminder and is waiting. The row is marked only after the notice, so a failure between
 * the notice and the mark repeats the notice with the same delivery key, and no second message
 * results.
 *
 * A wake is a unit of work: a failure of one does not stop the rest, and that wake is retried on
 * the next tick.
 */
@Injectable()
export class WakeFailureWorker extends PollingWorker {
  constructor(
    private readonly checks: ScheduledCheckRepository,
    @Inject(WAKE_FAILURE_NOTICE) private readonly notice: WakeFailureNotice,
    @Inject(continuationsConfig.KEY) private readonly config: ContinuationsConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return secondsToMilliseconds(this.config.noticeTickSeconds);
  }

  protected async tick(): Promise<number> {
    const failures = await this.checks.unnoticedFailures();

    for (const check of failures) {
      try {
        await this.tell(check);
      } catch (error) {
        this.logger.error(`failed wake ${check.id} not told: ${messageOf(error)}`, stackOf(error));
      }
    }

    return failures.length;
  }

  private async tell(check: ScheduledCheck): Promise<void> {
    const { reasonCode } = check;

    if (!isRequestedByPerson(reasonCode)) {
      throw new Error(`wake ${check.id}: the person did not name the time of ${reasonCode}`);
    }

    await this.notice.failed({
      cause: causeOf(check),
      reasonCode,
      pageId: check.notionPageId,
      discussionId: check.discussionId,
      runAt: check.runAt,
    });
    await this.checks.markFailureNoticed(check.id);
  }
}
