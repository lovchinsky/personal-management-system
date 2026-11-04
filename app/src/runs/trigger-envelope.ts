import { ReasonCode, WorkflowMode } from '../generated/prisma/enums';

/**
 * Everything a run learns about its origin.
 *
 * The keys are in snake_case on purpose: this is the format that goes into the prompt, and its
 * composition is listed in `contracts/canonical.yaml`, key `trigger_envelope`. A second name for
 * the same field at the boundary with the model would create a discrepancy that nothing keeps in
 * check.
 *
 * `INV-030`: the envelope is narrow. It contains no `app_db` rows, retry bookkeeping or database
 * schema, not for economy but because the model must read the state again instead of trusting our
 * snapshot.
 */
interface EventTrigger {
  /** The type of the event that closed the window. */
  readonly type: string;
  /**
   * The types of all events the window collected, sorted by name. A body edit or a message from
   * the channel remains an origin, whichever event closed the window.
   */
  readonly event_types: readonly string[];
  readonly event_id: string;
  readonly timestamp: string;
  readonly entity_id: string;
  readonly page_id: string;
  /**
   * The thread the person has just commented in, present only when a comment event touched the
   * window. The envelope does not include the content of the comment: the model reads the thread
   * again itself.
   */
  readonly discussion_id?: string;
  /**
   * The canonical name of the envelope's field. In the Notion payload it arrives under another
   * name (`data.updated_properties`). The renaming at the boundary is deliberate and one-way.
   */
  readonly updated_property_ids: readonly string[];
}

/**
 * The modes that a continuation row wakes: the recheck of a thread or, when the thread is found
 * resolved, its closure.
 */
type ContinuationMode = Extract<WorkflowMode, 'scheduled_recheck' | 'closure_processing'>;

/**
 * The origin of a continuation. `INV-020` allows only `type` and four origin fields: nothing more
 * reaches the prompt, because the model reads the semantic state again itself.
 */
interface ContinuationTrigger {
  readonly type: ContinuationMode;
  /**
   * The wake: the continuation row and its version. The same run, repeated after a
   * failure, gets the same key, and the next wake of the same thread gets a different one, so a
   * delivery key derived from it does not collapse two different notifications into one.
   */
  readonly event_id: string;
  readonly discussion_id?: string;
  readonly page_id: string;
  readonly reason_code: ReasonCode;
}

/** Each review has its own schedule and is woken by the occurrence of its period (ADR 0036). */
export type ReviewMode = Extract<
  WorkflowMode,
  'daily_control' | 'weekly_control_review' | 'strategic_review' | 'deep_review'
>;

/**
 * The origin of a scheduled review. A review has no page or thread: it reads its scope itself, and
 * the envelope says only which occurrence it is and from what time to look at changes (`INV-030`).
 */
interface ReviewTrigger {
  readonly type: `review.${ReviewMode}`;
  /**
   * The occurrence: the review and the key of its period. A retry of a run of the same occurrence
   * gets the same key, so a delivery key derived from it yields one packet per occurrence.
   */
  readonly event_id: string;
  /** The time of the occurrence. */
  readonly timestamp: string;
  /** The cutoff for “what has changed since the last review” is a time, not a state snapshot. */
  readonly since: string;
}

/**
 * The modes the App dispatches: each has an envelope builder (`eventEnvelope`, `recheckEnvelope`,
 * `closureEnvelope` and `reviewEnvelope`) and a procedure in the plugin's run entry; the list is
 * in `contracts/canonical.yaml`, key `run_frames`. A mode the App does not dispatch has only a row
 * of the toolset matrix.
 */
export const DISPATCHED_MODES = [
  'dialogue',
  'event_evaluation',
  'scheduled_recheck',
  'closure_processing',
  'daily_control',
  'weekly_control_review',
  'strategic_review',
  'deep_review',
] as const satisfies readonly WorkflowMode[];

export interface TriggerEnvelope {
  readonly mode: WorkflowMode;
  readonly trigger: EventTrigger | ContinuationTrigger | ReviewTrigger;
}

function continuationEnvelope(
  mode: ContinuationMode,
  trigger: Omit<ContinuationTrigger, 'type'>,
): TriggerEnvelope {
  return { mode, trigger: { type: mode, ...trigger } };
}

/** Builds the envelope for the recheck of a thread whose time has come. */
export function recheckEnvelope(trigger: Omit<ContinuationTrigger, 'type'>): TriggerEnvelope {
  return continuationEnvelope('scheduled_recheck', trigger);
}

/**
 * Builds the envelope for the closure of a thread the App found resolved: the same origin shape,
 * a different procedure.
 */
export function closureEnvelope(trigger: Omit<ContinuationTrigger, 'type'>): TriggerEnvelope {
  return continuationEnvelope('closure_processing', trigger);
}

/**
 * The mode of an event run: either the evaluation of changes or a dialogue the system has been
 * holding in a thread and continues in reply to the person (`contracts/canonical.yaml`, key
 * `system_discussion`).
 */
export type EventMode = Extract<WorkflowMode, 'event_evaluation' | 'dialogue'>;

export function eventEnvelope(mode: EventMode, trigger: EventTrigger): TriggerEnvelope {
  return { mode, trigger };
}

/**
 * Returns the page the run is about: an event or continuation envelope names it; a review has none.
 */
export function pageOf(envelope: TriggerEnvelope): string | null {
  return 'page_id' in envelope.trigger ? envelope.trigger.page_id : null;
}

/** Builds the envelope for a scheduled review whose occurrence has arrived. */
export function reviewEnvelope(
  mode: ReviewMode,
  trigger: Omit<ReviewTrigger, 'type'>,
): TriggerEnvelope {
  const type: ReviewTrigger['type'] = `review.${mode}`;

  return { mode, trigger: { type, ...trigger } };
}
