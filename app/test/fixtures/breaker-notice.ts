import { BREAKER_NOTICE, BreakerNotice, BreakerOpening } from '../../src/runs/breaker-notice';

/** A port that only records what it was told, and fails on demand. */
export class RecordingBreakerNotice implements BreakerNotice {
  readonly told: BreakerOpening[] = [];
  /** How many of the next notices fail before one goes through. */
  failures = 0;

  opened(opening: BreakerOpening): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;

      return Promise.reject(new Error('the queue is down'));
    }

    this.told.push(opening);

    return Promise.resolve();
  }
}

/** A port provider for tests that do not need the notice. */
export const BREAKER_NOTICE_PROVIDER = {
  provide: BREAKER_NOTICE,
  useValue: new RecordingBreakerNotice(),
};
