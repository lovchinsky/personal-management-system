import { Inject, Injectable } from '@nestjs/common';
import { minutesToMilliseconds } from 'date-fns';
import { PollingWorker } from '../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../platform/worker/workers.config';
import { ResolutionReconciler } from './resolution.reconciler';
import { sweepConfig, type SweepConfig } from './sweep.config';

/**
 * Resolved-thread reconciliation at the contract's pace (`contracts/canonical.yaml`, key `sweep`).
 */
@Injectable()
export class ReconciliationWorker extends PollingWorker {
  constructor(
    private readonly reconciler: ResolutionReconciler,
    @Inject(sweepConfig.KEY) private readonly config: SweepConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return minutesToMilliseconds(this.config.reconciliation.tickMinutes);
  }

  /**
   * Does not run right at startup: otherwise a restart loop turns the reconciliation into constant
   * polling of Notion.
   */
  protected override initialDelayMs(): number {
    return minutesToMilliseconds(this.config.reconciliation.firstDelayMinutes);
  }

  protected tick(): Promise<number> {
    return this.reconciler.reconcile();
  }
}
