import type { ReasonRequestedByPerson } from '../runs/provenance';

/**
 * A wake whose time the person named and that did not take place: the attempts are exhausted, and
 * there was no run that would have reached the end.
 */
export interface WakeFailure {
  /**
   * The cause of the wake's run (`causeOf`). The delivery key is derived from it, and it is the
   * same key the run's delivery has.
   */
  readonly cause: string;
  readonly reasonCode: ReasonRequestedByPerson;
  /** The page the person asked to have brought back. */
  readonly pageId: string;
  /** The wake's thread; `null` means a page wake. */
  readonly discussionId: string | null;
  /** The time the person named. */
  readonly runAt: Date;
}

/**
 * The port for the notice of a wake that did not take place. Delivery (`delivery/`) implements it:
 * continuations know neither channels nor the queue. Without an adapter the port is
 * `AbsentWakeFailureNotice`.
 *
 * A repeated call about the same wake duplicates nothing: the delivery key is the one the run of
 * that wake would have set, so neither a retry after a failure nor a reminder the run managed to
 * queue before failing yields a second message.
 */
export interface WakeFailureNotice {
  failed(failure: WakeFailure): Promise<void>;
}

export const WAKE_FAILURE_NOTICE = Symbol('WakeFailureNotice');

/** The token under which the adapter plugs itself in from outside `continuations/`. */
export const WAKE_FAILURE_NOTICE_ADAPTER = Symbol('WakeFailureNoticeAdapter');

/** Wiring without delivery: there is nobody to tell. */
export class AbsentWakeFailureNotice implements WakeFailureNotice {
  failed(): Promise<void> {
    return Promise.resolve();
  }
}
