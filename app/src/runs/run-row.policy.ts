import { Inject, Injectable } from '@nestjs/common';
import { afterAttempts, RetirementRule } from '../platform/queue/queue.sql';
import { budgetConfig, type BudgetConfig } from './budget.config';
import { runsConfig, type RunsConfig } from './runs.config';

/**
 * The numbers the run row rules rest on.
 *
 * A row's lease lasts as long as the run's ticket. The row is claimed right before the run, so a
 * shorter lease would hand it to someone else in the middle of the run, and a longer one would
 * keep the row held after the ticket expired. The attempt limit is a budget number
 * (`contracts/canonical.yaml`, key `run_budget`) because it is coupled to the daily limit.
 */
@Injectable()
export class RunRowPolicy {
  constructor(
    @Inject(runsConfig.KEY) private readonly runs: RunsConfig,
    @Inject(budgetConfig.KEY) private readonly budget: BudgetConfig,
  ) {}

  leaseSeconds(): number {
    return this.runs.ticketSeconds;
  }

  /** Returns the shortest and longest pause of a row waiting for Notion, in minutes (ADR 0045). */
  notionHold(): { readonly minMinutes: number; readonly maxMinutes: number } {
    return {
      minMinutes: this.runs.notionHoldMinMinutes,
      maxMinutes: this.runs.notionHoldMaxMinutes,
    };
  }

  /**
   * Returns the attempt limit, the first retirement rule of every run queue. A row that has used
   * it up gets the limit's reason, whatever else applies to it.
   */
  attemptLimit(): RetirementRule {
    return afterAttempts(this.budget.workRowMaxAttempts);
  }
}
