import { ReasonCode, RunOrigin } from '../../src/generated/prisma/enums';
import { budgetConfig } from '../../src/runs/budget.config';
import { BUDGET_EXEMPTIONS, DELEGATING_ORIGINS } from '../../src/runs/provenance';
import { canonical } from './contracts';

/**
 * The run budget numbers and their classification agree with the contract.
 *
 * The run gates enforce the limit, and the contract numbers set its size, so a number that
 * diverged from the contract would change the limit silently. The second half of the test matters
 * more than the first: it makes it impossible to add a wake reason without saying whether it
 * counts against the daily limit. Otherwise a new reason would silently behave as budgeted, or
 * silently bypass the limit, which is worse.
 */
describe('the run budget and the contract', () => {
  const declared = canonical.runBudget();
  const implemented = budgetConfig();

  it('the numbers agree', () => {
    expect(implemented.dailyLimit).toBe(declared.daily_limit);
    expect(implemented.breakerConsecutiveFailures).toBe(declared.breaker_consecutive_failures);
    expect(implemented.concurrency).toBe(declared.concurrency);
    expect(implemented.workRowMaxAttempts).toBe(declared.work_row_max_attempts);
  });

  it('the exempt reasons agree', () => {
    expect([...BUDGET_EXEMPTIONS.reasonCodes]).toEqual(declared.exempt.reason_codes);
  });

  it('the exempt origins agree', () => {
    expect([...BUDGET_EXEMPTIONS.origins]).toEqual(declared.exempt.origins);
  });

  it('every wake reason is classified exactly once', () => {
    const classified = [...declared.exempt.reason_codes, ...declared.budgeted.reason_codes];

    expect([...classified].sort()).toEqual([...Object.values(ReasonCode)].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  /**
   * The delegating origins are named in both the contract and the code (`DELEGATING_ORIGINS`).
   * Without the check, an origin added to the list by mistake would quietly become budgeted,
   * because the implementation would know about delegation only from the shape of its type.
   */
  it('the delegating origins agree', () => {
    expect([...DELEGATING_ORIGINS]).toEqual(declared.delegating_origins);
  });

  it('every run origin is classified or delegates to its reason', () => {
    const classified = [
      ...declared.exempt.origins,
      ...declared.budgeted.origins,
      ...declared.delegating_origins,
    ];

    expect([...classified].sort()).toEqual([...Object.values(RunOrigin)].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });
});
