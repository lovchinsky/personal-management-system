import { Prisma } from '../../generated/prisma/client';

/** The lease is released: the row is free for the next claim. */
export const RELEASE = Prisma.sql`"locked_until" = NULL`;

/**
 * A row is free if its lease is not live. The selection filters by the lease's expiry, not by
 * status — which is why `running` is in the lists of open statuses (`contracts/canonical.yaml`,
 * key `runtime_record_rules`).
 */
export const NOT_LEASED = Prisma.sql`("locked_until" IS NULL OR "locked_until" < now())`;

/**
 * The queue tables, and whether each table has `updated_at`.
 *
 * The list is closed on purpose: the table name is substituted into the SQL raw because it cannot
 * be made a parameter, and the type is the one place where that is safe.
 *
 * The Prisma client sets `@updatedAt` only on **its own** writes, while the protocol writes raw
 * SQL, so the protocol sets the transition timestamp itself (`touch`) — and only where the column
 * exists: the delivery queue does not have it, and writing it there would be a query error.
 */
export const TRACKS_UPDATES = {
  evaluation_windows: true,
  scheduled_checks: true,
  review_occurrences: true,
  notification_outbox: false,
} as const;

export type QueueTable = keyof typeof TRACKS_UPDATES;

/** Tables with `updated_at`: only in them is a row's age measured from its last transition. */
export type TrackedTable = {
  [Table in QueueTable]: (typeof TRACKS_UPDATES)[Table] extends true ? Table : never;
}[QueueTable];

/** The last-transition timestamp, where the table has it. */
export function touch(table: QueueTable): Prisma.Sql[] {
  return TRACKS_UPDATES[table] ? [Prisma.sql`"updated_at" = now()`] : [];
}

/** Returns a table name from the closed list. This is the only case where `raw` is safe. */
export function tableOf(table: QueueTable): Prisma.Sql {
  return Prisma.raw(`"${table}"`);
}

function grouped(predicates: readonly Prisma.Sql[]): Prisma.Sql[] {
  return predicates.map((predicate) => Prisma.sql`(${predicate})`);
}

/**
 * Combines all the conditions, each in its own parentheses.
 *
 * The queues write the conditions as SQL fragments, and `OR` in them is legitimate. Without
 * parentheses a fragment with `OR` would break out of the whole conjunction: `… AND "locked_until"
 * = $2 AND "version" = 3 OR TRUE` touches every row of the table, someone else's lease included.
 * The protocol adds the parentheses, not everyone who writes a condition.
 */
export function allOf(predicates: readonly Prisma.Sql[]): Prisma.Sql {
  return Prisma.join(grouped(predicates), ' AND ');
}

/**
 * Combines the conditions so that any of them suffices, each in its own parentheses, for the same
 * reason as in `allOf`.
 */
export function anyOf(predicates: readonly Prisma.Sql[]): Prisma.Sql {
  return Prisma.join(grouped(predicates), ' OR ');
}

/**
 * A state in which a row can no longer do its job.
 *
 * A row can reach it for more than one reason, and the reasons do not reduce to a common one: a
 * row that failed three times and a row that nobody got to in a week are dead in different ways —
 * and the difference is what matters to the queue's owner. So the rule includes both the
 * predicate and its own explanation, not a number from which someone else would compose the
 * predicate.
 *
 * The list of rules is ordered: a row that falls under several rules gets the reason of the
 * first of them.
 */
export interface RetirementRule {
  /** A predicate over a table row. */
  readonly when: Prisma.Sql;
  /** What to record as the cause of death. */
  readonly reason: string;
}

/**
 * The retry limit is a rule common to all queues: exhaustion means “it failed that many times”,
 * not “it was taken that many times” (`contracts/canonical.yaml`, key `scheduled_check`).
 */
export function afterAttempts(maxAttempts: number): RetirementRule {
  return {
    when: Prisma.sql`"attempt_count" >= ${maxAttempts}`,
    reason: 'attempt limit reached',
  };
}
