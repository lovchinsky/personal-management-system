import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../platform/db/prisma.service';
import { Leased, QueueRow } from '../platform/queue/lease';
import { LeaseQueue } from '../platform/queue/lease-queue';
import { RetirementRule, tableOf, TrackedTable } from '../platform/queue/queue.sql';
import { Disposition } from './disposition';
import { ScheduledProvenance } from './provenance';
import { RunRowPolicy } from './run-row.policy';
import { ClaimedRun, RunCandidate, RunSource } from './run-source';
import { TriggerEnvelope } from './trigger-envelope';

/**
 * A run queue row: a leased row that counts its attempts and remembers since when it has been
 * waiting for Notion consecutively (ADR 0045).
 */
type RunRow = QueueRow & { readonly attemptCount: number; readonly notionHeldSince: Date | null };

/**
 * The statuses of a run row as SQL fragments with the cast to the table's enum.
 *
 * `running` and `done` are status assignments (`"status" = …`): the same clause is written to the
 * row and checked as a condition.
 */
interface RunRowStatus {
  /** The row is still open: a non-terminal status. */
  readonly open: Prisma.Sql;
  /** The row's run has started. */
  readonly running: Prisma.Sql;
  /** The run reached a conclusion and the row is concluded. */
  readonly done: Prisma.Sql;
}

/**
 * The description of a run queue: exactly how its row differs from the rows of other queues
 * (`docs/2-system.md` § “Scheduler and outbox”). It does not repeat the run row rules, because
 * `RunRowSource` owns them.
 */
export interface RunRows<TRow extends RunRow> {
  /**
   * The queue table. Pruning concluded rows measures age from `updated_at`, so only a table that
   * has it fits.
   */
  readonly table: TrackedTable;
  readonly status: RunRowStatus;
  /** The time column: both “the row came due” and the queue order come from it. */
  readonly moment: Prisma.Sql;
  readonly momentOf: (row: TRow) => Date;
  /**
   * The columns by which the queue heads split into run classes. The run row rules add the split
   * into fresh and retried rows.
   */
  readonly partition: Prisma.Sql;
  /** Reads rows by id. It is a closure because only the owner knows the row type. */
  readonly read: (ids: string[]) => Promise<TRow[]>;
  /**
   * The queue's own retirement rules. They come after the attempt limit, so a row that falls under
   * both gets the limit's reason.
   */
  readonly retireAlso: () => readonly RetirementRule[];
  /**
   * Concluded rows that pruning keeps despite their age: what the queue still measures from (the
   * last completed review occurrence). Without `keepConcluded` every old `done` row is pruned.
   */
  readonly keepConcluded?: Prisma.Sql;
  /** The row is still the one the run saw. */
  readonly unchanged: (claimed: TRow) => Prisma.Sql;
  /** Why the row was not concluded. It is written to `last_error` of the superseded row. */
  readonly supersededBecause: string;
  /** What to write to a superseded row in addition to the refunded attempt. */
  readonly onSupersede: (claimed: TRow) => readonly Prisma.Sql[];
  /**
   * Rows that a Notion wait never holds back: a safeguard on top of the rule that they are not
   * postponed (a person's snooze, ADR 0045).
   */
  readonly neverHeld?: Prisma.Sql;
  /** The row's origin: the same for the candidate and for the run request. */
  readonly provenance: (row: TRow) => ScheduledProvenance;
  /** The run's trigger envelope, built from the row that has just been claimed. */
  readonly envelope: (claimed: TRow) => Promise<TriggerEnvelope>;
}

/**
 * The row already had a run, and that run reached no conclusion. Heads and candidates use the same
 * split.
 */
const RETRIED = Prisma.sql`"attempt_count" > 0`;

function retried(row: RunRow): boolean {
  return row.attemptCount > 0;
}

/**
 * The attempt is refunded (`contracts/canonical.yaml`, key `scheduled_check`). The floor at zero
 * is a safeguard, because a negative counter would silently give the row attempts beyond the
 * limit.
 */
const RETURN_ATTEMPT = Prisma.sql`"attempt_count" = GREATEST("attempt_count" - 1, 0)`;

/** The row is not waiting for Notion: it has no mark, or its pause has expired (ADR 0045). */
const NOT_HELD = Prisma.sql`("notion_hold_until" IS NULL OR "notion_hold_until" <= now())`;

/**
 * The row's run reached Notion, so the row no longer waits for Notion consecutively: the mark and
 * the time of the first deferral are cleared together (ADR 0045).
 */
function streakOf(notionReached: boolean): Prisma.Sql[] {
  return notionReached
    ? [Prisma.sql`"notion_hold_until" = NULL`, Prisma.sql`"notion_held_since" = NULL`]
    : [];
}

/**
 * A leased run queue: the source of runs, with the row rules written once (ADR 0018).
 *
 * The attempt is written before the run, together with the status `running`. A completed run
 * concludes the row if it did not change while the run was in progress; a changed row returns to
 * the queue along with its attempt. If there was no run, the row is released unchanged; if the run
 * failed, with a reason; if the run hit the plan quota, with the attempt refunded. Every
 * disposition passes the platform's lease-owner fence, because only the platform writes the lease
 * (`INV-082`).
 *
 * The queue's owner supplies the description and does not repeat the implementation. The owner's
 * source class is only a constructor that passes the description here.
 */
export class RunRowSource<TRow extends RunRow> implements RunSource {
  private readonly queue: LeaseQueue<TRow, TrackedTable>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: RunRowPolicy,
    private readonly rows: RunRows<TRow>,
  ) {
    this.queue = new LeaseQueue(prisma, {
      table: rows.table,
      open: rows.status.open,
      due: Prisma.sql`${rows.moment} <= now()`,
      dueAt: rows.moment,
      order: rows.moment,
      // A row waiting for Notion does not occupy the head of its group, so the next row after it
      // is taken.
      available: rows.neverHeld ? Prisma.sql`(${NOT_HELD} OR ${rows.neverHeld})` : NOT_HELD,
      // The status is written together with the attempt, not with the claim, so `running` means
      // the row's run has actually started.
      onAttempt: [rows.status.running, Prisma.sql`"last_attempt_at" = now()`],
      settings: () => ({
        retireWhen: [policy.attemptLimit(), ...rows.retireAlso()],
        leaseSeconds: policy.leaseSeconds(),
      }),
      read: rows.read,
    });
  }

  retire(): Promise<void> {
    return this.queue.retire();
  }

  /**
   * Lists, for each run class, the earliest fresh row and the earliest retried row. Otherwise an
   * older row of one class would hide a fresh row of a higher class from the scheduler.
   */
  async candidates(): Promise<RunCandidate[]> {
    const heads = await this.queue.heads(Prisma.sql`${this.rows.partition}, ${RETRIED}`);

    return heads.map((row) => ({
      id: row.id,
      provenance: this.rows.provenance(row),
      dueAt: this.rows.momentOf(row),
      retried: retried(row),
      claim: () => this.claim(row.id),
    }));
  }

  /** Claims a row by id, the same way a candidate claims it. */
  async claim(id: string): Promise<ClaimedRun | null> {
    const row = await this.queue.claim(id);
    if (!row) {
      return null;
    }

    let envelope: TriggerEnvelope;

    try {
      envelope = await this.rows.envelope(row);
    } catch (error) {
      // There will be no run, so the row is released at once instead of hanging under its lease
      // until the ticket expires (`docs/2-system.md` § “Scheduler and outbox”).
      await this.queue.release(row);

      throw error;
    }

    return {
      id: row.id,
      request: {
        envelope,
        provenance: this.rows.provenance(row),
        originId: row.id,
        notionHeldSince: row.notionHeldSince,
      },
      recordAttempt: async () => (await this.queue.recordAttempt(row)) !== null,
      conclude: (notionReached) => this.conclude(row, notionReached),
      release: () => this.queue.release(row),
      fail: (error, notionReached) =>
        this.queue.dispose(row, 'fail', [
          Prisma.sql`"last_error" = ${error}`,
          ...streakOf(notionReached),
        ]),
      refund: (reason, notionReached) =>
        this.queue.dispose(row, 'refund', [
          Prisma.sql`"last_error" = ${reason}`,
          RETURN_ATTEMPT,
          ...streakOf(notionReached),
        ]),
      waitForNotion: (reason) => this.waitForNotion(row, reason),
    };
  }

  /**
   * Releases the Notion holds when a run has just reached Notion (ADR 0045). A row whose
   * consecutive wait began earlier than `previous` is not released (`RunSource`). The time of the
   * first deferral stays, so a row that still does not reach Notion keeps its day running. The
   * release is neither a disposition of a claimed row nor a lease, so there is no fence.
   */
  async releaseNotionHolds(previous?: Date): Promise<number> {
    const fresh = previous
      ? Prisma.sql`AND "notion_held_since" > ${previous}::timestamp(3)`
      : Prisma.empty;

    return this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${tableOf(this.rows.table)} SET "notion_hold_until" = NULL
       WHERE "notion_hold_until" > now() ${fresh}
    `);
  }

  /**
   * Prunes rows that reached a conclusion and are older than `days`: only `done`, a copy of the
   * run trace. `failed` stays as evidence (`docs/2-system.md` § “`webhook_receipts`”), and
   * `keepConcluded` stays as what the queue still measures from.
   */
  pruneConcluded(days: number): Promise<number> {
    const { done } = this.rows.status;
    const keep = this.rows.keepConcluded;

    return this.queue.prune(days, keep ? Prisma.sql`${done} AND NOT (${keep})` : done);
  }

  /**
   * Handles a run that did not reach Notion. The attempt is refunded, and the row waits a pause
   * twice as long as it has already waited consecutively, within the policy's bounds (ADR 0045).
   * The pause is computed in the statement itself: the same `UPDATE` that sets the time of the
   * first deferral reads that time.
   *
   * Only the **same** row gets the mark. A row that changed while the run was in progress (the
   * person moved the continuation, an event arrived in the window) does not get it; otherwise a
   * snooze or the person's reply would wait out another row's pause. A changed row is treated as
   * superseded: the attempt is refunded and whatever the description writes to a superseded row
   * is written.
   */
  private async waitForNotion(row: TRow & Leased, reason: string): Promise<boolean> {
    const { minMinutes, maxMinutes } = this.policy.notionHold();
    const pause = Prisma.sql`LEAST(
      GREATEST(2 * (now() - COALESCE("notion_held_since", now())), make_interval(mins => ${minMinutes})),
      make_interval(mins => ${maxMinutes})
    )`;
    const held = await this.queue.fenced(
      row,
      [
        Prisma.sql`"last_error" = ${reason}`,
        RETURN_ATTEMPT,
        Prisma.sql`"notion_hold_until" = now() + ${pause}`,
        Prisma.sql`"notion_held_since" = COALESCE("notion_held_since", now())`,
      ],
      [this.rows.unchanged(row)],
    );

    if (held) return true;

    return this.queue.dispose(row, 'refund', [
      Prisma.sql`"last_error" = ${reason}`,
      RETURN_ATTEMPT,
      ...this.rows.onSupersede(row),
    ]);
  }

  /**
   * Concludes the row **if it is still the same**. A changed row is treated as superseded: the
   * lease is released, the row stays open and comes due again along with whatever changed, and the
   * attempt is refunded.
   */
  private async conclude(row: TRow & Leased, notionReached: boolean): Promise<Disposition> {
    if (await this.queue.fenced(row, [this.rows.status.done], [this.rows.unchanged(row)])) {
      return 'closed';
    }

    const superseded = await this.queue.dispose(row, 'completion', [
      Prisma.sql`"last_error" = ${this.rows.supersededBecause}`,
      RETURN_ATTEMPT,
      ...this.rows.onSupersede(row),
      ...streakOf(notionReached),
    ]);

    return superseded ? 'superseded' : 'lost';
  }
}
