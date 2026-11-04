import { ReasonCode } from '../generated/prisma/enums';
import { ScheduledOrigin, ScheduledProvenance } from './provenance';

/**
 * Run priority classes, from the highest to the lowest (`contracts/canonical.yaml`, key
 * `run_priority`; why they are ordered this way: `docs/2-system.md` § “Run priority”).
 */
export const PRIORITY_CLASSES = [
  'person_speaks',
  'person_named_time',
  'person_capture',
  'review',
  'autonomous',
] as const;

type PriorityClass = (typeof PRIORITY_CLASSES)[number];

/**
 * The class of each origin that classifies itself.
 *
 * It is a record over the whole enum, not a list of exceptions, so an origin added without a class
 * is a compile error, not a row that would silently end up last.
 */
export const CLASS_OF_ORIGIN: Readonly<Record<ScheduledOrigin, PriorityClass>> = {
  managed_discussion_reply: 'person_speaks',
  channel_inbound: 'person_speaks',
  inbox_capture: 'person_capture',
  review_schedule: 'review',
  evaluation_window: 'autonomous',
};

/** The class of each continuation reason: `scheduled_check` delegates its class to the reason. */
export const CLASS_OF_REASON: Readonly<Record<ReasonCode, PriorityClass>> = {
  user_snooze: 'person_named_time',
  deadline_followup: 'person_named_time',
  await_external_event: 'autonomous',
  safety_recheck: 'autonomous',
  resolution_reconciliation: 'autonomous',
};

export function priorityClassOf(provenance: ScheduledProvenance): PriorityClass {
  return 'reasonCode' in provenance
    ? CLASS_OF_REASON[provenance.reasonCode]
    : CLASS_OF_ORIGIN[provenance.origin];
}

/**
 * What candidates are compared by: the origin, and whether the row already had a run when it came
 * due.
 */
export interface Ranked {
  readonly provenance: ScheduledProvenance;
  /** The row has already caused a run that reached no conclusion. */
  readonly retried: boolean;
  readonly dueAt: Date;
}

function rankOf(provenance: ScheduledProvenance): number {
  return PRIORITY_CLASSES.indexOf(priorityClassOf(provenance));
}

/**
 * Compares candidates in the order in which the scheduler takes them (`INV-085`): the class, then
 * fresh before retried, then the earlier time.
 */
export function byPriority(one: Ranked, other: Ranked): number {
  return (
    rankOf(one.provenance) - rankOf(other.provenance) ||
    Number(one.retried) - Number(other.retried) ||
    one.dueAt.getTime() - other.dueAt.getTime()
  );
}
