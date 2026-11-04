import { Inject, Injectable } from '@nestjs/common';
import { minutesToMilliseconds } from 'date-fns';
import { PollingWorker } from '../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../platform/worker/workers.config';
import { SafetySweep } from './safety-sweep';
import { sweepConfig, type SweepConfig } from './sweep.config';

/** Periodic safety sweep at the contract's pace (`contracts/canonical.yaml`, key `sweep`). */
@Injectable()
export class SweepWorker extends PollingWorker {
  constructor(
    private readonly sweep: SafetySweep,
    @Inject(sweepConfig.KEY) private readonly config: SweepConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return minutesToMilliseconds(this.config.tickMinutes);
  }

  /**
   * Does not run right at startup: otherwise a restart loop turns an hourly pass into a constant
   * one.
   */
  protected override initialDelayMs(): number {
    return minutesToMilliseconds(this.config.firstDelayMinutes);
  }

  protected tick(): Promise<number> {
    return this.sweep.sweep();
  }
}
