import { Inject, Injectable } from '@nestjs/common';
import { hoursToMilliseconds, minutesToMilliseconds } from 'date-fns';
import { PollingWorker } from '../../../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../../../platform/worker/workers.config';
import { bindingAuditConfig, type BindingAuditConfig } from './audit.config';
import { BindingDriftAuditor } from './binding-drift.auditor';

/** The binding check against the live workspace, at the pace its config namespace sets. */
@Injectable()
export class BindingDriftWorker extends PollingWorker {
  constructor(
    private readonly auditor: BindingDriftAuditor,
    @Inject(bindingAuditConfig.KEY) private readonly config: BindingAuditConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return hoursToMilliseconds(this.config.intervalHours);
  }

  /**
   * Delays the first tick so that it does not fire at startup: otherwise a restart loop turns the
   * daily check into a continuous one, and Notion sees a flood of requests from us instead of one
   * a day.
   */
  protected override initialDelayMs(): number {
    return minutesToMilliseconds(this.config.firstDelayMinutes);
  }

  protected async tick(): Promise<number> {
    const report = await this.auditor.audit();

    return report.drifts.length;
  }
}
