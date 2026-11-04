import { registerAs, type ConfigType } from '@nestjs/config';

/** The executor of approved actions: pace, batch and the pause when a dependency is down. */
export const executorConfig = registerAs('executor', () => ({
  /** Pause between executor ticks. */
  tickSeconds: 15,
  /** How many approved actions one tick takes. */
  batchSize: 5,
  /**
   * The executor's pause when the page could not be inspected or written: Notion does not
   * respond, the integration lacks access to the page or the integration bot is not yet known.
   * The person's decision stands, and asking more often would mean asking the same thing. An hour
   * is the ceiling on the delay after the dependency comes back.
   */
  missingDependencyBackoffSeconds: 3_600,
  /**
   * The attempt limit of an approved action (`contracts/canonical.yaml`, key `pending_action`;
   * ADR 0044): if Notion is temporarily unresponsive, at most this many hours from approval; if
   * Notion refuses access, this many attempts. Beyond that the action is `failed`, and the person
   * sees this in the thread.
   */
  unavailableMaxHours: 24,
  noAccessMaxAttempts: 3,
}));

export type ExecutorConfig = ConfigType<typeof executorConfig>;
