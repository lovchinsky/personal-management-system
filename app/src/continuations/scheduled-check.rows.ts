import { Prisma, ScheduledCheck } from '../generated/prisma/client';
import { ScheduledCheckStatus } from '../generated/prisma/enums';
import { PrismaService } from '../platform/db/prisma.service';
import { olderThanDays, statusIn, statusIs } from '../platform/db/sql';
import { RetirementRule } from '../platform/queue/queue.sql';
import { ScheduledProvenance } from '../runs/provenance';
import { RunRows } from '../runs/run-row-source';
import { closureEnvelope, recheckEnvelope, TriggerEnvelope } from '../runs/trigger-envelope';
import { REASON_CLASS, ReasonClass } from './reason-class';

/** Non-terminal statuses: `contracts/canonical.yaml`, key `scheduled_check`. */
export const OPEN: readonly ScheduledCheckStatus[] = ['pending', 'running'];

const STATUS = 'ScheduledCheckStatus';

/**
 * How many days after its time a `safety_recheck` wake without a thread waits for a run
 * (`contracts/canonical.yaml`, key `scheduled_check`, field `safety_recheck_max_age_days`).
 */
export const SAFETY_RECHECK_MAX_AGE_DAYS = 7;

/**
 * Returns the rule that retires a `safety_recheck` wake that has no thread and has not produced a
 * run within a week after its time. The Weekly Control Review surfaces a situation nobody looked at
 * for a week, and what accumulated beyond the daily limit would otherwise use up that limit on the
 * day the run gates open. The age is measured from the time, not from creation: a wake named for
 * the future does not age while it waits. The rule does not touch a thread: its continuation
 * keeps the person's conversation going.
 */
function afterStaleRecheck(): RetirementRule {
  const days = SAFETY_RECHECK_MAX_AGE_DAYS;

  return {
    when: Prisma.sql`"reason_code" = 'safety_recheck'::"ReasonCode" AND "discussion_id" IS NULL AND ${olderThanDays('run_at', days)}`,
    reason: `safety recheck without a thread did not run for ${days}d after its moment`,
  };
}

/**
 * Builds the origin of a continuation. The wake's reason determines both its budget class and its
 * run priority class, and the compiler does not let a continuation's origin be built without it.
 */
function provenanceOf(check: ScheduledCheck): ScheduledProvenance {
  return { origin: 'scheduled_check', reasonCode: check.reasonCode };
}

/**
 * Describes continuations as a run queue: what makes their row differ from the rows of other
 * queues (ADR 0018). The queue is separate from the evaluation window
 * (`docs/2-system.md` § “`evaluation_windows`”).
 */
export function scheduledCheckRows(prisma: PrismaService): RunRows<ScheduledCheck> {
  return {
    table: 'scheduled_checks',
    status: {
      open: statusIn(STATUS, OPEN),
      running: statusIs(STATUS, ScheduledCheckStatus.running),
      done: statusIs(STATUS, ScheduledCheckStatus.done),
    },
    moment: Prisma.sql`"run_at"`,
    momentOf: (check) => check.runAt,
    // The reason names the class of the run, so each class has its head among the candidates.
    partition: Prisma.sql`"reason_code"`,
    read: (ids) =>
      prisma.scheduledCheck.findMany({ where: { id: { in: ids } }, orderBy: { runAt: 'asc' } }),
    // Only a `safety_recheck` wake without a thread ages: the `run_at` of the rest can
    // legitimately be half a year ahead — “remind me in December” — and they have no time after
    // which they are no longer needed.
    retireAlso: () => [afterStaleRecheck()],
    // The row is the same, of the same version, and its time has come. The version catches a
    // “remind me on Monday” said while the recheck was running, because concluding the row would
    // delete the person's instruction. The version is not enough: the row snapshot is taken by a
    // second query, after the claim, so a reschedule that hit this gap arrives in the snapshot
    // **together** with the new version, and the version fence lets it through. The time catches
    // what the version does not: a row whose time is still ahead has not been executed but
    // rescheduled.
    unchanged: (check) => Prisma.sql`"version" = ${check.version} AND "run_at" <= now()`,
    // A person's snooze never waits for Notion (ADR 0045): a safeguard on top of the dispatcher
    // rule.
    neverHeld: Prisma.sql`"reason_code" = 'user_snooze'::"ReasonCode"`,
    supersededBecause: 'continuation moved while the run was in flight',
    // A changed continuation stays open with its new time: `run_at` is not moved here at all,
    // since it is what the person has just named.
    onSupersede: () => [],
    provenance: provenanceOf,
    envelope: (check) => Promise.resolve(scheduledCheckEnvelope(check)),
  };
}

/**
 * The envelope by reason class: a wake is a recheck, the closure of a resolved thread is a
 * separate procedure with its own set of tools. A `Record` over all classes: a class without a
 * decision is a compile error.
 */
const ENVELOPE_OF: Readonly<
  Record<ReasonClass, (trigger: Parameters<typeof recheckEnvelope>[0]) => TriggerEnvelope>
> = {
  wake: recheckEnvelope,
  closure: closureEnvelope,
};

/**
 * The cause of a row's run is the `event_id` of its envelope: the row and the version. The next
 * wake of the same thread is a new version and therefore a different cause; the run's delivery key
 * is derived from the cause.
 */
export function causeOf(check: Pick<ScheduledCheck, 'id' | 'version'>): string {
  return `${check.id}:${check.version}`;
}

/** Builds the row's envelope. The class of its reason names the mode. */
export function scheduledCheckEnvelope(check: ScheduledCheck): TriggerEnvelope {
  return ENVELOPE_OF[REASON_CLASS[check.reasonCode]]({
    event_id: causeOf(check),
    discussion_id: check.discussionId ?? undefined,
    page_id: check.notionPageId,
    reason_code: check.reasonCode,
  });
}
