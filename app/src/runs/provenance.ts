import { ReasonCode, RunBudgetClass, RunOrigin } from '../generated/prisma/enums';

/**
 * Origins whose class is decided not by the origin itself but by the reason it has.
 *
 * The single source for both the shape of the run request below and the check against the
 * contract. A list kept only in the contract would let an origin that delegates nothing be added
 * to it, and that origin would silently become budgeted.
 */
export const DELEGATING_ORIGINS = ['scheduled_check'] as const satisfies readonly RunOrigin[];

type DelegatingOrigin = (typeof DELEGATING_ORIGINS)[number];

/**
 * Origins the scheduler does not take. Their run is launched outside the queues. The gate command
 * (ADR 0013) launches its run itself.
 */
export const UNSCHEDULED_ORIGINS = ['operator'] as const satisfies readonly RunOrigin[];

type UnscheduledOrigin = (typeof UNSCHEDULED_ORIGINS)[number];

/**
 * Who asked for the run.
 *
 * A union type, not an object with an optional field, because a continuation's class is decided
 * by its `reason_code`. A `scheduled_check` origin without a reason is not a state that exists at
 * all, so the compiler does not let it be built.
 */
export type RunProvenance =
  | { readonly origin: DelegatingOrigin; readonly reasonCode: ReasonCode }
  | { readonly origin: Exclude<RunOrigin, DelegatingOrigin> };

/** An origin the scheduler manages: any except those launched outside the queues. */
export type ScheduledProvenance =
  | { readonly origin: DelegatingOrigin; readonly reasonCode: ReasonCode }
  | { readonly origin: ScheduledOrigin };

/** An origin that classifies itself, not through `reason_code`, and that the scheduler manages. */
export type ScheduledOrigin = Exclude<RunOrigin, DelegatingOrigin | UnscheduledOrigin>;

/**
 * Whether the person asked for a run driven by a continuation's reason.
 *
 * The person asked when they named the time: for `user_snooze` the person said “remind me on
 * Monday”. For `deadline_followup` the person named the date in `Deadline`, and the system chose
 * only how far ahead of it to wake. A silent failure to warn about a deadline is the worst kind of
 * failure. The system chose the other times.
 *
 * It is a record over the whole enum, not a list of exceptions, so a reason added without a
 * decision is a compile error, not a silently budgeted run.
 */
const REASON_REQUESTED_BY_PERSON = {
  user_snooze: true,
  deadline_followup: true,
  await_external_event: false,
  safety_recheck: false,
  resolution_reconciliation: false,
} as const satisfies Readonly<Record<ReasonCode, boolean>>;

/** A continuation reason whose time the person named. */
export type ReasonRequestedByPerson = {
  [Code in ReasonCode]: (typeof REASON_REQUESTED_BY_PERSON)[Code] extends true ? Code : never;
}[ReasonCode];

export function isRequestedByPerson(code: ReasonCode): code is ReasonRequestedByPerson {
  return REASON_REQUESTED_BY_PERSON[code];
}

/**
 * Continuation reasons whose time the person named, in enum order. The list has the same source as
 * the classifier: both the budget and the wake-failure notice use it.
 */
export const REASONS_REQUESTED_BY_PERSON: readonly ReasonRequestedByPerson[] =
  Object.values(ReasonCode).filter(isRequestedByPerson);

/** What is known about an origin that classifies itself. */
interface OriginFacts {
  /** The person asked for the run, so neither the budget nor quiet hours stop it. */
  readonly requestedByPerson: boolean;
  /**
   * The person has just said something themselves: replied in a thread that Personal Management
   * System manages, wrote in a channel or pressed a button there. Only someone who is speaking can
   * approve a proposal or name the time of a snooze, not someone whose schedule is being followed.
   */
  readonly personSpeaks: boolean;
}

/**
 * The facts of each origin that classifies itself.
 *
 * There are more exempt origins than ones where the person speaks: the person also set up the
 * review schedule, an Inbox item is work the person gave the system, and the operator's launch
 * (the gate command, ADR 0013) is done by hand. None of them contains a reply. It is a record over
 * the whole enum, so an origin added without facts is a compile error.
 */
const ORIGIN_FACTS: Readonly<Record<Exclude<RunOrigin, DelegatingOrigin>, OriginFacts>> = {
  review_schedule: { requestedByPerson: true, personSpeaks: false },
  managed_discussion_reply: { requestedByPerson: true, personSpeaks: true },
  channel_inbound: { requestedByPerson: true, personSpeaks: true },
  inbox_capture: { requestedByPerson: true, personSpeaks: false },
  operator: { requestedByPerson: true, personSpeaks: false },
  evaluation_window: { requestedByPerson: false, personSpeaks: false },
};

/**
 * Checks whether the person asked for this run.
 *
 * This one function serves two mechanisms, the run budget and quiet hours, because both ask the
 * same question (`docs/2-system.md` § “Observability and cost”).
 *
 * The criterion is mechanical: each run has exactly one origin row, and one enum field decides
 * the class. There is no judgment at runtime.
 */
export function requestedByPerson(provenance: RunProvenance): boolean {
  // The key is the presence of a reason, not the origin's name, because delegation means the
  // reason determines the class. The list of delegating origins and the run request shape are
  // derived from one constant, so they have no way to diverge.
  if ('reasonCode' in provenance) return REASON_REQUESTED_BY_PERSON[provenance.reasonCode];

  return ORIGIN_FACTS[provenance.origin].requestedByPerson;
}

/**
 * Checks whether the person speaks for themselves in the run. A delegating origin never does,
 * because time drives it.
 */
export function personSpeaksIn(provenance: RunProvenance): boolean {
  return 'reasonCode' in provenance ? false : ORIGIN_FACTS[provenance.origin].personSpeaks;
}

/**
 * Checks whether the run is a wake of the person's snooze, whose reminder does not wait for Notion
 * (ADR 0045). In the middle of a run the reminder goes ahead without Notion, a run that does not
 * start fails, and beyond the attempt limit the App tells the person.
 */
export function isPersonsSnooze(provenance: RunProvenance): boolean {
  return 'reasonCode' in provenance && provenance.reasonCode === 'user_snooze';
}

export function budgetClassOf(provenance: RunProvenance): RunBudgetClass {
  return requestedByPerson(provenance) ? 'exempt' : 'budgeted';
}

function classifiesItself(origin: RunOrigin): origin is Exclude<RunOrigin, DelegatingOrigin> {
  const delegating: readonly RunOrigin[] = DELEGATING_ORIGINS;
  return !delegating.includes(origin);
}

/** For the conformance test: the exempt reasons and origins, compared with the contract. */
export const BUDGET_EXEMPTIONS = {
  reasonCodes: REASONS_REQUESTED_BY_PERSON,
  origins: Object.values(RunOrigin)
    .filter(classifiesItself)
    .filter((origin) => ORIGIN_FACTS[origin].requestedByPerson),
} as const;
