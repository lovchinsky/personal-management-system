import { Disposition } from './disposition';
import { RunProvenance } from './provenance';
import { Ranked } from './run-priority';
import { TriggerEnvelope } from './trigger-envelope';

/** What a run is about: the envelope, the origin and the row that caused it. */
export interface RunRequest {
  readonly envelope: TriggerEnvelope;
  readonly provenance: RunProvenance;
  readonly originId?: string;
  /**
   * When the row's consecutive wait for Notion began; `null` means it is not waiting (ADR 0045).
   */
  readonly notionHeldSince?: Date | null;
}

/**
 * A due row the scheduler can take into a run. The candidate has its own claim: the scheduler does
 * not look a source up by name, because the row knows whose it is.
 */
export interface RunCandidate extends Ranked {
  readonly id: string;
  /**
   * Claims the row right before the run. `null` means the row can no longer be taken: it was
   * concluded, is not yet due or went to another claimant.
   */
  claim(): Promise<ClaimedRun | null>;
}

/**
 * A row claimed right before its run, and everything that can be done with it.
 *
 * There is one disposition per run outcome, each under the lease-owner fence: `false` or `lost`
 * means the lease expired and the row is no longer ours. The source has already logged the loss
 * itself, so the scheduler only moves on.
 */
export interface ClaimedRun {
  readonly id: string;
  readonly request: RunRequest;
  /**
   * The run is about to start: the attempt is recorded before launch, and the row becomes
   * `running`.
   */
  recordAttempt(): Promise<boolean>;
  /**
   * The run reached a conclusion: the row is concluded if it is still the same row.
   *
   * `notionReached`, here and in `fail` and `refund`, means the row's run reached Notion: the
   * row's consecutive wait for Notion ends, and the next deferral starts its day over (ADR 0045).
   */
  conclude(notionReached: boolean): Promise<Disposition>;
  /** There was no run: the row goes back as it was claimed. */
  release(): Promise<boolean>;
  /** The run failed: the row goes back with a reason, and the attempt stays spent. */
  fail(error: string, notionReached: boolean): Promise<boolean>;
  /** The run hit the plan quota: the row goes back and the attempt is refunded. */
  refund(reason: string, notionReached: boolean): Promise<boolean>;
  /**
   * The run did not reach Notion: the row goes back with the attempt refunded and waits out a
   * backoff pause; a row changed during the run gets only the attempt back (ADR 0045).
   */
  waitForNotion(reason: string): Promise<boolean>;
}

/**
 * A run source is a queue whose rows become runs
 * (`docs/2-system.md` § “Scheduler and outbox”).
 *
 * The port is all the scheduler knows about sources: the scheduler itself decides which
 * disposition a run's outcome gets. Lease-based queues all implement the port through one class,
 * `RunRowSource`, which takes a description of its owner (`run-row-source.ts`).
 */
export interface RunSource {
  /** Retires rows that will do no more of their work. */
  retire(): Promise<void>;
  /**
   * Returns the due candidates: for each origin, the earliest fresh row and the earliest retried
   * row. None is claimed.
   */
  candidates(): Promise<RunCandidate[]>;
  /**
   * Prunes rows that reached a conclusion and are older than `days`. Returns how many were pruned.
   */
  pruneConcluded(days: number): Promise<number>;
  /**
   * Releases the Notion hold once Notion answers again. Returns how many were released.
   *
   * `previous` is the prior release that let any row go. A row whose consecutive wait began
   * earlier has already had its chance in its own deferral round. It again did not reach Notion
   * while Notion was answering others, so its failure most likely comes from the row itself, and
   * it waits out its own pause. Without `previous`, all are released.
   */
  releaseNotionHolds(previous?: Date): Promise<number>;
}

/**
 * The run sources are one list, read by the scheduler (it takes candidates from them) and by
 * pruning (it cleans their concluded rows): a new source appears in the list once. `scheduling/`
 * assembles the list.
 */
export const RUN_SOURCES = Symbol('RunSources');
