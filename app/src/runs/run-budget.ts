import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfig } from '../config/app.config';
import { startOfLocalDay, startOfNextLocalDay } from '../platform/time/local-day';
import { budgetConfig, type BudgetConfig } from './budget.config';
import { RunTraceRepository } from './run-trace.repository';

/** What stops autonomous work. Neither of the two stops exempt runs. */
export type AutonomousDenial = 'breaker' | 'daily_limit';

/** A hold on autonomous work: why, and until when, if that is known in advance. */
interface AutonomousHold {
  readonly denial: AutonomousDenial;
  readonly until?: Date;
}

/**
 * How many times the system may go off and think on its own, and what stands above that right.
 *
 * The limit covers **only** runs the system started itself. Snoozes, deadlines, scheduled reviews
 * and the person's replies always go through, because whoever asked is the one in control. The
 * numbers come from `contracts/canonical.yaml`, key `run_budget`.
 *
 * The concurrency limit is not part of the run budget. It is a matter of admission, and the
 * ticket's slot enforces it, because “count, then insert” is never atomic (`docs/2-system.md`
 * § “Observability and cost”).
 */
@Injectable()
export class RunBudget {
  constructor(
    private readonly traces: RunTraceRepository,
    @Inject(budgetConfig.KEY) private readonly budget: BudgetConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * Reports the time until which the plan quota is exhausted; `null` means it is not exhausted.
   *
   * Exempt runs face the plan quota too, because it is physical, not policy, and a run the person
   * asked for would hit it just the same (ADR 0012).
   */
  quotaBlockedUntil(): Promise<Date | null> {
    return this.traces.quotaBlockedUntil();
  }

  /**
   * Reports what currently holds autonomous work, the breaker or the daily limit; `null` means
   * nothing does.
   */
  async autonomousHold(): Promise<AutonomousHold | null> {
    // Only a successful run can close the breaker, so there is no time known in advance.
    if (await this.breakerOpen()) return { denial: 'breaker' };

    const now = new Date();
    const spent = await this.traces.countBudgetedSince(startOfLocalDay(this.app.timeZone, now));

    return spent >= this.budget.dailyLimit
      ? { denial: 'daily_limit', until: startOfNextLocalDay(this.app.timeZone, now) }
      : null;
  }

  /**
   * Checks whether the breaker is open. It is open when the last N finished runs have all failed.
   *
   * The breaker is measured in consecutive failures, not as a fraction. A single timeout is not a
   * breakdown, while five failures in a row mean the next one will fail too, and forty attempts a
   * day will spend the quota for no result at all.
   */
  private async breakerOpen(): Promise<boolean> {
    const threshold = this.budget.breakerConsecutiveFailures;
    const recent = await this.traces.lastVerdicts(threshold);

    return recent.length === threshold && recent.every((verdict) => verdict === 'failed');
  }
}
