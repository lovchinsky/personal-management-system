import { executorConfig } from '../../src/approvals/executor/executor.config';
import { canonical } from './contracts';

/**
 * The attempt limit of an approved action is the same in the code and in the contract (ADR 0044).
 *
 * A running App does not read contracts, so the executor keeps the numbers in its settings, and a
 * number that diverged from the contract would silently change how long the approved action waits
 * before the person learns that it has not been written.
 */
describe('executing an approved action and the contract', () => {
  const { execution } = canonical.pendingAction();

  it('the limit on temporary unavailability matches the contract', () => {
    expect(executorConfig().unavailableMaxHours).toBe(execution.unavailable_max_hours);
  });

  it('the limit on access refusals matches the contract', () => {
    expect(executorConfig().noAccessMaxAttempts).toBe(execution.no_access_max_attempts);
  });
});
