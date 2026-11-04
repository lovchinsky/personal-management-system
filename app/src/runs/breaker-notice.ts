/**
 * A circuit breaker opening is something the person must be told about (`run_budget`). Five
 * consecutive failures mean the run path is broken.
 */
export interface BreakerOpening {
  /** The last failed run: it identifies this opening, not some other one. */
  readonly lastFailedRunId: string;
  /** Why the last failed run failed, as recorded in the ledger. */
  readonly reason: string | null;
  /** The page the last failed run was about: the place to take the person to. */
  readonly pageId: string | null;
  /** How many consecutive failures opened the breaker. */
  readonly failures: number;
}

/**
 * Port for the notice about an open breaker. Delivery implements it (`delivery/`) because `runs/`
 * knows neither channels nor the queue. Without an adapter `AbsentBreakerNotice` implements the
 * port.
 *
 * A repeated call for the same opening duplicates nothing. The delivery key is derived from the
 * last failed run, so a restart between the opening and the notice neither loses the notice nor
 * produces a second one.
 */
export interface BreakerNotice {
  opened(opening: BreakerOpening): Promise<void>;
}

export const BREAKER_NOTICE = Symbol('BreakerNotice');

/** The token under which an adapter plugs itself in from outside `runs/`. */
export const BREAKER_NOTICE_ADAPTER = Symbol('BreakerNoticeAdapter');

/** Wiring without delivery, so there is nobody to tell. */
export class AbsentBreakerNotice implements BreakerNotice {
  opened(): Promise<void> {
    return Promise.resolve();
  }
}
