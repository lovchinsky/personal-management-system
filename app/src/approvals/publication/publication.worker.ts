import { Inject, Injectable } from '@nestjs/common';
import { secondsToMilliseconds } from 'date-fns';
import { needsAttention, notionFailureOf } from '../../notion/semantics/notion-failure';
import { messageOf, stackOf } from '../../platform/error/message-of';
import { PollingWorker } from '../../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../../platform/worker/workers.config';
import { PendingActionRepository } from '../contracts/pending-action.repository';
import { executorConfig, type ExecutorConfig } from '../executor/executor.config';
import { ProposalPublisher } from './proposal.publisher';

/**
 * A proposal's fate is published by a worker, not by whoever changed it: the button-press handler
 * records the decision and answers at once, the executor concludes the execution, and the trail in
 * the thread and the message in the channel appear on the next tick (ADR 0043). A restart loses
 * nothing, because an unpublished fate is stored in the row.
 *
 * A proposal is a unit of work: the failure of one does not stop the publication of the rest, and
 * the failed one is retried on the next tick.
 */
@Injectable()
export class PublicationWorker extends PollingWorker {
  constructor(
    private readonly actions: PendingActionRepository,
    private readonly publisher: ProposalPublisher,
    @Inject(executorConfig.KEY) private readonly config: ExecutorConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return secondsToMilliseconds(this.config.tickSeconds);
  }

  protected async tick(): Promise<number> {
    const unpublished = await this.actions.unpublished(this.config.batchSize);

    for (const action of unpublished) {
      try {
        await this.publisher.publish(action);
      } catch (error) {
        const line = `fate of ${action.id} not published: ${messageOf(error)}`;

        if (needsAttention(notionFailureOf(error))) this.logger.error(line, stackOf(error));
        else this.logger.warn(line);
      }
    }

    return unpublished.length;
  }
}
