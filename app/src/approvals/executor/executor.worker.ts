import { Inject, Injectable } from '@nestjs/common';
import { secondsToMilliseconds } from 'date-fns';
import { PollingWorker } from '../../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../../platform/worker/workers.config';
import { PendingActionRepository } from '../contracts/pending-action.repository';
import { ActionExecutor } from './action.executor';
import { executorConfig, type ExecutorConfig } from './executor.config';

/**
 * Approved actions are executed by a worker, not in the button-press handler: the handler
 * records the decision, the worker executes it, and a restart between these steps loses nothing
 * (`docs/2-system.md` § “Preconditions and executor”).
 */
@Injectable()
export class ExecutorWorker extends PollingWorker {
  constructor(
    private readonly actions: PendingActionRepository,
    private readonly executor: ActionExecutor,
    @Inject(executorConfig.KEY) private readonly config: ExecutorConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return secondsToMilliseconds(this.config.tickSeconds);
  }

  protected async tick(): Promise<number> {
    const approved = await this.actions.approved(this.config.batchSize);

    for (const action of approved) {
      await this.executor.execute(action);
    }

    // Proposals that the person's own change to the page may have overtaken (ADR 0044).
    const outpaced = await this.actions.toRecheck(this.config.batchSize);

    for (const action of outpaced) {
      await this.executor.recheck(action);
    }

    return approved.length + outpaced.length;
  }
}
