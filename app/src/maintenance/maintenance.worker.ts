import { Inject, Injectable } from '@nestjs/common';
import { hoursToMilliseconds, minutesToMilliseconds } from 'date-fns';
import { AttentionService } from '../attention/attention.service';
import { WebhookReceipts } from '../intake/receipts/webhook-receipts';
import { OauthServer } from '../mcp/oauth/oauth-server';
import { PollingWorker } from '../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../platform/worker/workers.config';
import { RUN_SOURCES, RunSource } from '../runs/run-source';
import { maintenanceConfig, type MaintenanceConfig } from './maintenance.config';

/**
 * Pruning of what is garbage by construction: receipts older than the provider's redelivery
 * window, concluded run queue rows (pruned through their sources), threads the system has not
 * written to for a long time, and expired OAuth codes, tokens and clients. `docs/2-system.md`
 * § “`webhook_receipts`” and `docs/2-system.md` § “`system_discussions`” say what is pruned,
 * what is not, and why.
 */
@Injectable()
export class MaintenanceWorker extends PollingWorker {
  constructor(
    private readonly receipts: WebhookReceipts,
    @Inject(RUN_SOURCES) private readonly sources: readonly RunSource[],
    private readonly attention: AttentionService,
    private readonly oauth: OauthServer,
    @Inject(maintenanceConfig.KEY) private readonly config: MaintenanceConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return hoursToMilliseconds(this.config.intervalHours);
  }

  /**
   * Does not prune at startup, because otherwise a restart loop would make daily pruning
   * constant.
   */
  protected override initialDelayMs(): number {
    return minutesToMilliseconds(this.config.firstDelayMinutes);
  }

  protected async tick(): Promise<number> {
    const days = this.config.receiptRetentionDays;
    const receipts = await this.receipts.pruneOlderThan(days);

    let concluded = 0;

    for (const source of this.sources) concluded += await source.pruneConcluded(days);

    const discussionDays = this.config.systemDiscussionRetentionDays;
    const discussions = await this.attention.pruneStale(discussionDays);

    const credentials = await this.oauth.prune();

    const pruned = receipts + concluded + discussions + credentials;
    if (pruned > 0) {
      this.logger.log(
        `pruned ${receipts} receipts and ${concluded} concluded queue rows older than ${days}d, ` +
          `${discussions} system discussions silent for ${discussionDays}d, ` +
          `${credentials} spent OAuth codes, tokens and unused clients`,
      );
    }

    return pruned;
  }
}
