import { Inject, Injectable } from '@nestjs/common';
import { hoursToMilliseconds, isBefore, minutesToMilliseconds, subDays } from 'date-fns';
import { PollingWorker } from '../../platform/worker/polling.worker';
import { workersConfig, type WorkersConfig } from '../../platform/worker/workers.config';
import { notionMcpConfig, type NotionMcpConfig } from './notion-mcp.config';
import { NotionMcpGrant } from './notion-mcp.grant';

/**
 * How long before the ceiling to say that the person is needed. Two weeks, so that authorizing
 * again is a planned job and not an emergency.
 */
const CEILING_NOTICE_DAYS = 14;

/**
 * The Notion MCP grant does not die while nobody is using it.
 *
 * The provider kills a grant after thirty days without a refresh. Runs refresh it themselves, but
 * the runner sits behind a switch (`RUNNER_ENABLED`, ADR 0013) and there may be no runs for
 * weeks, so without this worker the grant would die before the next run appeared.
 */
@Injectable()
export class NotionMcpKeepalive extends PollingWorker {
  constructor(
    private readonly grant: NotionMcpGrant,
    @Inject(notionMcpConfig.KEY) private readonly config: NotionMcpConfig,
    @Inject(workersConfig.KEY) protected readonly workers: WorkersConfig,
  ) {
    super();
  }

  protected tickMs(): number {
    return hoursToMilliseconds(this.config.keepaliveIntervalHours);
  }

  /**
   * The first tick does not run at startup. Otherwise a restart loop would go to the database and
   * the provider every time, together with the rest of startup.
   */
  protected override initialDelayMs(): number {
    return minutesToMilliseconds(this.config.keepaliveFirstDelayMinutes);
  }

  protected async tick(): Promise<number> {
    const kept = await this.grant.keepAlive();
    if (kept.kind === 'absent') {
      this.logger.warn('Notion MCP is not authorized — RUNBOOK §6.3');
      return 0;
    }

    if (kept.kind === 'refreshed') {
      this.logger.log(
        `Notion MCP grant refreshed; alive until ${kept.status.inactiveAfter.toISOString()}`,
      );
    }

    if (isBefore(subDays(kept.status.ceilingAt, CEILING_NOTICE_DAYS), new Date())) {
      this.logger.warn(
        `Notion MCP grant reaches its ceiling at ${kept.status.ceilingAt.toISOString()} — ` +
          'authorize again before then (RUNBOOK §6.3)',
      );
    }

    return kept.kind === 'refreshed' ? 1 : 0;
  }
}
