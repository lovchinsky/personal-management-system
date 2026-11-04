/**
 * A row of a leased queue as the client reads it: the lease stamp may be absent.
 *
 * `QueueRow` is a type, not a list of fields kept by every owner, because whoever describes a
 * queue constrains the row type with it and does not name the lease (`INV-082`).
 */
export interface QueueRow {
  readonly id: string;
  readonly lockedUntil: Date | null;
}

/**
 * A queue row in the hands of whoever claimed it: the lease stamp set by the claim is the owner
 * token (`docs/2-system.md` § “Scheduler and outbox”).
 *
 * The stamp is non-null by type: on a row that has been read it is `Date | null`, and without the
 * fence stamp there is nothing to compare, so a disposition would silently not be applied.
 */
export interface Leased {
  readonly id: string;
  readonly lockedUntil: Date;
}

/**
 * The condition “nobody is currently working on the row” in the form the Prisma client takes.
 *
 * The array is mutable because that is what the generated `WhereInput.OR` requires.
 */
interface Unleased {
  OR: [{ lockedUntil: null }, { lockedUntil: { lt: Date } }];
}

/**
 * Returns the condition for a row without a live lease: the row has no lease, or its lease has
 * expired.
 *
 * It is the same condition as in the protocol's selection, for queries that need to tell a row
 * being worked on from one that waits. The clock here is the process's, not the database's,
 * because the client cannot express `now()`. A clock skew of milliseconds is orders of magnitude
 * smaller than any lease.
 */
export function unleased(): Unleased {
  return { OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] };
}
