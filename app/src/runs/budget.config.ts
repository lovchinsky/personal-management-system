import { registerAs, type ConfigType } from '@nestjs/config';

/**
 * The numbers of the run budget.
 *
 * They are not installation settings but contract values. Their source is
 * `contracts/canonical.yaml`, key `run_budget`, and `budget-agreement.spec.ts` fails when they
 * diverge. The environment deliberately does not override them, because a calibration change must
 * be visible in the diff, not in somebody's `.env`.
 */
export const budgetConfig = registerAs('budget', () => ({
  /** How many runs a day the system may start on its own. */
  dailyLimit: 40,
  /** How many consecutive failures stop the autonomous side. */
  breakerConsecutiveFailures: 5,
  /** How many runs execute at once. */
  concurrency: 1,
  /** How many attempts that reached no conclusion a queue row gets before it moves to `failed`. */
  workRowMaxAttempts: 3,
}));

export type BudgetConfig = ConfigType<typeof budgetConfig>;
