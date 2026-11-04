import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../db/prisma.service';
import { olderThanDays } from '../db/sql';
import { Leased, QueueRow } from './lease';
import {
  allOf,
  anyOf,
  NOT_LEASED,
  QueueTable,
  RELEASE,
  RetirementRule,
  tableOf,
  touch,
  TrackedTable,
} from './queue.sql';

/** What the queue takes from the configuration: it is read on every call to the queue. */
interface LeaseSettings {
  /**
   * An ordered list of rules that say when a row is retired. The selection is derived from the
   * same list by negation, so what is retired and what is claimable cannot diverge.
   */
  readonly retireWhen: readonly RetirementRule[];
  readonly leaseSeconds: number;
}

/**
 * The description of a leased queue: what queues really differ in, as SQL fragments.
 * `docs/2-system.md` § “Scheduler and outbox” explains why there is one mechanism for all queues.
 *
 * A claim writes only the lease and the transition timestamp. It does not change the status,
 * because the lease expresses “working” and a second expression of the same fact could diverge
 * from it. A status that an attempt changes is written when the attempt is recorded
 * (`onAttempt`).
 */
interface LeaseQueueSpec<TRow, Table extends QueueTable> {
  readonly table: Table;
  /** The row is still open: a non-terminal status. */
  readonly open: Prisma.Sql;
  /** The row is due. */
  readonly due: Prisma.Sql;
  /** The time column that `due` is built on. Postponing moves it. */
  readonly dueAt: Prisma.Sql;
  /** The order in which rows are handed out. */
  readonly order: Prisma.Sql;
  /**
   * The row waits for nothing beyond its due time. The condition is consulted by head selection and
   * claiming, not by retirement: the limits that retire a row apply to a waiting row as well.
   * Absent means the row never waits.
   */
  readonly available?: Prisma.Sql;
  readonly settings: () => LeaseSettings;
  /** What to write along with the attempt, beyond the counter. The protocol sets `updated_at`. */
  readonly onAttempt?: readonly Prisma.Sql[];
  /** Reads the rows by id. It is a closure because only the repository knows the row type. */
  readonly read: (ids: string[]) => Promise<TRow[]>;
}

/**
 * Builds the condition that the row is still ours: the same id and the same stamp the claim set.
 */
function owned(row: Leased): Prisma.Sql {
  return Prisma.sql`"id" = ${row.id} AND "locked_until" = ${row.lockedUntil}`;
}

const charged = z.array(z.object({ attemptCount: z.number().int() }));

const leases = z.array(z.object({ id: z.string(), lockedUntil: z.date() }));

const ids = z.array(z.object({ id: z.string() }));

/**
 * A leased queue: claiming rows and disposing of the claimed ones.
 *
 * The lease-owner fence, the lease release and the `updated_at` timestamp exist here exactly once
 * (`docs/2-system.md` § “Scheduler and outbox”): without the fence a zombie concludes someone
 * else's row, without the lease release a row hangs until its lease expires, and without the
 * timestamp pruning counts the age from the wrong point.
 *
 * It is composed, not inherited and not injected: its owner — the delivery repository or the run
 * row rules (`runs/run-row-source.ts`) — knows the row type and the specifics of the queue, and
 * passes them in.
 */
export class LeaseQueue<TRow extends QueueRow, Table extends QueueTable = QueueTable> {
  private readonly logger = new Logger(LeaseQueue.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spec: LeaseQueueSpec<TRow, Table>,
  ) {}

  /**
   * Retires the rows that will no longer do their work.
   *
   * Runs before the selection, not after a failure: otherwise a row whose work died without
   * reporting it would stay in the cycle forever, because there is no one to report the
   * exhaustion.
   *
   * One statement per rule, not one for all. The reason must be unambiguous, and to choose it in
   * a single statement the predicates would have to be written twice — in `WHERE` and in `CASE`.
   * The rules are ordered, so a row that falls under several rules gets the reason of the first:
   * later statements no longer see it, because its status is no longer open.
   *
   * The reason is **concatenated** with what was recorded last, because these are two different
   * facts. “Limit exhausted” does not say what the row failed on; “no new events for a week”
   * does not say why nobody got to it. Together they read as one sentence:
   * `no new event for 7d (last: run reported failure)`.
   */
  async retire(): Promise<void> {
    for (const rule of this.spec.settings().retireWhen) {
      const retire = Prisma.join(
        [
          Prisma.sql`"status" = 'failed'`,
          RELEASE,
          Prisma.sql`"last_error" = ${rule.reason}::text || COALESCE(' (last: ' || "last_error" || ')', '')`,
          ...touch(this.spec.table),
        ],
        ', ',
      );

      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE ${tableOf(this.spec.table)} SET ${retire}
        WHERE ${allOf([this.spec.open, this.spec.due, rule.when, NOT_LEASED])}
      `);
    }
  }

  /**
   * Returns the queue heads: the first row in its order that can currently be claimed, for each
   * value of `partition`. Takes no lease: the caller decides which one is worked on.
   */
  async heads(partition: Prisma.Sql): Promise<TRow[]> {
    const found = await this.headsOf(partition);

    return found.length === 0 ? [] : this.spec.read(found);
  }

  /**
   * Claims a row by id, if it can still be claimed. `null` means the row has already concluded, is
   * not yet due, or another leaseholder is working on it.
   */
  async claim(id: string): Promise<(TRow & Leased) | null> {
    const lease = await this.claimLease(id);
    if (!lease) {
      return null;
    }

    const [row] = this.fresh(await this.spec.read([lease.id]), [lease]);

    return row ?? null;
  }

  /**
   * Takes a batch of due rows, first retiring those that will no longer do their work.
   */
  async claimDue(limit: number): Promise<Array<TRow & Leased>> {
    await this.retire();

    const claimed = await this.claimLeases(limit);
    if (claimed.length === 0) {
      return [];
    }

    return this.fresh(await this.spec.read(claimed.map((lease) => lease.id)), claimed);
  }

  /**
   * Disposes of a row, releasing the lease and writing `set`, if the row is still ours and every
   * `where` condition holds.
   *
   * One statement contains everything a disposition cannot do without: the lease-owner fence,
   * the lease release and the transition timestamp. `false` means nothing was applied: the lease
   * expired and the row was reclaimed, or a condition did not hold.
   */
  async fenced(
    row: Leased,
    set: readonly Prisma.Sql[],
    where: readonly Prisma.Sql[] = [],
  ): Promise<boolean> {
    const count = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${tableOf(this.spec.table)}
         SET ${Prisma.join([RELEASE, ...set, ...touch(this.spec.table)], ', ')}
       WHERE ${allOf([owned(row), ...where])}
    `);

    return count === 1;
  }

  /**
   * Disposes of a row like `fenced`, but reports a lost lease itself. `step` is what the
   * disposition is called in the log.
   *
   * The fence has tripped: the lease expired while the work was running, and the row has already
   * been reclaimed by someone else. The outcome of this work was not recorded anywhere. Silence
   * here would be the one place where the fact that the work was most likely done twice gets
   * lost. The queue reports, not the owner of the disposition: otherwise every disposition of
   * every owner would have to keep this in mind.
   */
  async dispose(row: Leased, step: string, set: readonly Prisma.Sql[]): Promise<boolean> {
    const applied = await this.fenced(row, set);
    if (!applied) {
      this.warnLost(row, step);
    }

    return applied;
  }

  /**
   * Releases the lease when there was no work, and does nothing else. The row is returned as it
   * was taken.
   */
  release(row: Leased): Promise<boolean> {
    return this.dispose(row, 'release', []);
  }

  /**
   * Postpones a row until `until`. Leaves attempts alone: it neither spends nor refunds them.
   *
   * Only the delivery queue moves a row's due time: quiet hours and backoff postpone a row that
   * is not yet due. A denial does not move a run row's due time (`INV-084`); a row waiting for
   * Notion is held back by a separate mark, not by its due time (`available`). `step` is what the
   * postponement is called in the log if the lease manages to expire.
   */
  postpone(row: Leased, until: Date, reason: string, step = 'postpone'): Promise<boolean> {
    return this.dispose(row, step, [
      Prisma.sql`${this.spec.dueAt} = ${until}::timestamp(3)`,
      Prisma.sql`"last_error" = ${reason}`,
    ]);
  }

  /**
   * Records an attempt for a row that has just caused work. The attempt is written before the
   * work, and the lease stays. This is the only place where the counter grows
   * (`contracts/canonical.yaml`, key `scheduled_check`).
   *
   * Returns the new number of attempts, or `null` if the lease is no longer ours.
   */
  async recordAttempt(row: Leased): Promise<number | null> {
    const set = Prisma.join(
      [
        Prisma.sql`"attempt_count" = "attempt_count" + 1`,
        ...(this.spec.onAttempt ?? []),
        ...touch(this.spec.table),
      ],
      ', ',
    );

    const rows: unknown = await this.prisma.$queryRaw(Prisma.sql`
      UPDATE ${tableOf(this.spec.table)} SET ${set}
       WHERE ${owned(row)}
      RETURNING "attempt_count" AS "attemptCount"
    `);

    const [counted] = charged.parse(rows);
    if (!counted) {
      this.warnLost(row, 'attempt');
    }

    return counted?.attemptCount ?? null;
  }

  /**
   * Prunes the concluded rows older than `days`.
   *
   * Age is measured from the last transition, not from creation: a row may have waited for weeks
   * and finished yesterday. That is why only tables that have `updated_at` qualify — and the
   * type of `this` states it, not the caller's memory.
   */
  prune(
    this: LeaseQueue<TRow, TrackedTable>,
    days: number,
    concluded: Prisma.Sql,
  ): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM ${tableOf(this.spec.table)}
       WHERE ${allOf([concluded, olderThanDays('updated_at', days)])}
    `);
  }

  private warnLost(row: Leased, step: string): void {
    this.logger.warn(`${this.spec.table} ${row.id}: lease expired before "${step}" was recorded`);
  }

  /**
   * Builds the condition for a row that is able to work: no retirement rule points at it.
   *
   * The selection and the retirement are derived from **one** declaration, so the statement “a
   * retired row is not claimed” holds by construction, not by vigilance.
   */
  private workable(): Prisma.Sql {
    const { retireWhen } = this.spec.settings();

    // A queue without retirement rules has nothing to exclude: a row in it lives until it is
    // concluded. There is no such queue, but an empty `NOT ()` would be a syntax error, not an
    // empty predicate.
    if (retireWhen.length === 0) return Prisma.sql`TRUE`;

    return Prisma.sql`NOT (${anyOf(retireWhen.map((rule) => rule.when))})`;
  }

  /**
   * Builds the condition for a row that can currently be claimed: open, due, able to work, waiting
   * for nothing and without a live lease.
   */
  private claimable(): Prisma.Sql {
    const { available } = this.spec;

    return allOf([
      this.spec.open,
      this.spec.due,
      this.workable(),
      ...(available ? [available] : []),
      NOT_LEASED,
    ]);
  }

  /** Builds what a claim writes: the lease and the transition timestamp. */
  private claimed(): Prisma.Sql {
    const { leaseSeconds } = this.spec.settings();
    const lease = Prisma.sql`"locked_until" = now() + make_interval(secs => ${leaseSeconds}::double precision)`;

    return Prisma.join([lease, ...touch(this.spec.table)], ', ');
  }

  /**
   * Claims a batch of due rows.
   *
   * Uses one atomic `UPDATE` with `FOR UPDATE SKIP LOCKED` in a subquery, not a transaction with
   * a read and a write, because a process killed in the middle does not leave a row
   * half-claimed, and parallel workers spread across different rows. Returns the id together
   * with the stamp that this statement set — the owner token (`docs/2-system.md` § “Scheduler
   * and outbox”). The rows themselves are read by the repository: only it knows their type. The
   * response is parsed with a schema: `$queryRaw` returns `unknown`.
   */
  private async claimLeases(limit: number): Promise<Leased[]> {
    const table = tableOf(this.spec.table);

    const rows: unknown = await this.prisma.$queryRaw(Prisma.sql`
      UPDATE ${table} SET ${this.claimed()}
      WHERE "id" IN (
        SELECT "id" FROM ${table}
         WHERE ${this.claimable()}
         ORDER BY ${this.spec.order}
         FOR UPDATE SKIP LOCKED
         LIMIT ${limit}
      )
      RETURNING "id", "locked_until" AS "lockedUntil"
    `);

    return leases.parse(rows);
  }

  /**
   * Claims one row by id, if it can still be claimed.
   *
   * Uses the same condition as claiming a batch, in one atomic `UPDATE`: a row that has managed
   * to conclude, change its due time or go to another leaseholder is not claimed, and `null`
   * says that.
   */
  private async claimLease(id: string): Promise<Leased | null> {
    const rows: unknown = await this.prisma.$queryRaw(Prisma.sql`
      UPDATE ${tableOf(this.spec.table)} SET ${this.claimed()}
       WHERE ${allOf([Prisma.sql`"id" = ${id}`, this.claimable()])}
      RETURNING "id", "locked_until" AS "lockedUntil"
    `);

    const [lease] = leases.parse(rows);

    return lease ?? null;
  }

  /**
   * Selects the queue heads: of the rows that can currently be claimed, the first in queue order
   * for each value of `partition`.
   *
   * It only reads and takes no lease: the caller decides which of the heads is worked on and
   * claims it afterwards — by id and with the same condition.
   */
  private async headsOf(partition: Prisma.Sql): Promise<string[]> {
    const rows: unknown = await this.prisma.$queryRaw(Prisma.sql`
      SELECT DISTINCT ON (${partition}) "id"
        FROM ${tableOf(this.spec.table)}
       WHERE ${this.claimable()}
       ORDER BY ${partition}, ${this.spec.order}
    `);

    return ids.parse(rows).map((row) => row.id);
  }

  /**
   * Keeps the rows with the stamp set by the claim. A row that has been read and whose stamp is
   * already different is not handed out at all: between the claim and the read its lease
   * expired, and the row is handled by whoever reclaimed it — the work on it would be done twice.
   */
  private fresh(rows: readonly TRow[], leases: readonly Leased[]): Array<TRow & Leased> {
    const tokens = new Map(leases.map((lease) => [lease.id, lease.lockedUntil]));

    return rows.flatMap((row) => {
      const token = tokens.get(row.id);

      return token !== undefined && row.lockedUntil?.getTime() === token.getTime()
        ? [{ ...row, lockedUntil: token }]
        : [];
    });
  }
}
