import { registerAs, type ConfigType } from '@nestjs/config';

/**
 * Time limits of runs.
 *
 * The ticket is the time a run has from admission to its conclusion. The origin row claimed before
 * the run is held for the same time, and the tokens of the run's servers must live as long.
 * Fifteen minutes is roughly the ceiling of one model run.
 */
export const runsConfig = registerAs('runs', () => ({
  /** The lifetime of a run's ticket and of the lease on its origin row. */
  ticketSeconds: 900,
  /**
   * How long a run is given, after the signal, to stop and report.
   *
   * The conclusion must be recorded in the ledger while the row still belongs to the run: a row
   * whose ticket has expired is retired, and a late conclusion can no longer be written anywhere.
   */
  windDownSeconds: 60,
  /** The pause between ticks of the run scheduler. */
  tickSeconds: 15,
  /**
   * How long to wait after the plan quota when the run does not know the time it resets (ADR 0012).
   * The wait is an hour because the state is external, and asking more often would mean asking the
   * same thing.
   */
  planQuotaBackoffSeconds: 3_600,
  /**
   * How long a row waits when its run did not reach Notion (ADR 0045): twice as long as it has
   * already been waiting, but not less than the first pause and not more than an hour, that is,
   * 15 min, 30, then hourly. A short failure clears in minutes, and a long one is unlikely to clear
   * within the next few minutes. Retrying more often would mean spending plan runs and access
   * refreshes on a failure that has not cleared.
   */
  notionHoldMinMinutes: 15,
  notionHoldMaxMinutes: 60,
  /**
   * How long a row waits for Notion from its first consecutive deferral before Notion's
   * unavailability becomes an ordinary failure: a day, as for the retries of an approved action
   * (ADR 0044). The breaker sees a failure past the limit, and that is also a signal of a long
   * outage.
   */
  notionHoldLimitHours: 24,
}));

export type RunsConfig = ConfigType<typeof runsConfig>;
