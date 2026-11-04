import { Injectable } from '@nestjs/common';
import { Prisma, ScheduledCheck } from '../generated/prisma/client';
import { isUniqueViolation } from '../platform/db/prisma-errors';
import { PrismaService } from '../platform/db/prisma.service';
import { unleased } from '../platform/queue/lease';
import { REASONS_REQUESTED_BY_PERSON } from '../runs/provenance';
import { whereSame } from './continuation-identity';
import { Continuation, ContinuationQuery } from './continuation.schema';
import { REASON_CLASS, ReasonClass, reasonsOf } from './reason-class';
import { OPEN } from './scheduled-check.rows';

/**
 * Selects an open continuation of the same item of attention. The identity is `sameContinuation`,
 * a single rule for queue rows and for what a run has written. The reason class is part of it, so a
 * wake does not coincide with a closure of the same thread.
 */
function openFor(request: Continuation): Prisma.ScheduledCheckWhereInput {
  return { ...whereSame(request), status: { in: [...OPEN] } };
}

/**
 * Selects a person's snooze that has not fired yet: only the person moves such a row. A snooze
 * whose run is already under way is not protected; an expired lease puts the row back to waiting,
 * and the protection returns with it (`contracts/canonical.yaml`, key `scheduled_check`).
 */
function personsWaitingSnooze(): Prisma.ScheduledCheckWhereInput {
  return { reasonCode: 'user_snooze', ...unleased() };
}

/** What a step wants to talk about: pages and threads, by canonical ids. */
export interface SnoozeTarget {
  readonly pages: readonly string[];
  readonly discussions: readonly string[];
}

/** A row placed by insertion only: a new one (`created`) or an open one that already existed. */
interface Inserted {
  readonly row: ScheduledCheck;
  readonly created: boolean;
}

/**
 * Continuation rows from the producer's side: scheduling, moving and reading the open ones. The
 * run source (`ScheduledCheckRunSource`) takes a row through its run.
 */
@Injectable()
export class ScheduledCheckRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Schedules a wake or moves the existing one.
   *
   * A second wake never appears for the same thread: a repeated snooze moves the `run_at` of the
   * existing one. The partial index enforces the constraint, so a race between two simultaneous
   * schedule requests ends in `P2002`, and catching it here restores the expected outcome instead
   * of hiding an error.
   *
   * `null` means the thread is held by a person's snooze that has not fired yet, and the person is
   * not the one asking: only the person moves such a row (`byPerson`).
   *
   * A closure does not come here: its row is not moved but only inserted (`closure`). A request
   * with a reason of that class is a caller error.
   */
  async schedule(request: Continuation, byPerson: boolean): Promise<ScheduledCheck | null> {
    if (REASON_CLASS[request.reasonCode] === 'closure') {
      throw new Error(`schedule is for wake-ups; ${request.reasonCode} goes through closure`);
    }

    const moved = await this.moveOpen(request, byPerson);
    if (moved) {
      return moved;
    }
    if (!byPerson && (await this.holdsPersonsSnooze(request))) {
      return null;
    }

    try {
      return await this.prisma.scheduledCheck.create({
        data: {
          discussionId: request.discussionId ?? null,
          notionPageId: request.notionPageId,
          runAt: request.runAt,
          reasonCode: request.reasonCode,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const raced = await this.moveOpen(request, byPerson);
      if (raced) {
        return raced;
      }
      if (!byPerson && (await this.holdsPersonsSnooze(request))) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Schedules a thread closure by insertion only. If an open closure already exists, it is returned
   * and nothing changes, neither `version` nor `run_at`: a row that is already going into a run
   * would be `superseded` and executed a second time if it were moved. A repeated request that
   * finds the closure just completed creates a new one: that is already a new resolution.
   */
  closure(request: Continuation): Promise<Inserted> {
    if (request.discussionId === undefined || REASON_CLASS[request.reasonCode] !== 'closure') {
      throw new Error('closure needs a thread and the closure reason');
    }

    return this.insertOnce(request);
  }

  /**
   * Schedules a page wake without a thread by insertion only, like a closure: if an open wake of
   * the same page and reason already exists, it is returned unchanged. A request for a page wake
   * does not move the time a run named.
   */
  pageWake(request: Continuation): Promise<Inserted> {
    if (request.discussionId !== undefined || REASON_CLASS[request.reasonCode] !== 'wake') {
      throw new Error('a page wake-up has no thread and wakes rather than closes');
    }

    return this.insertOnce(request);
  }

  /**
   * Inserts a row if there is no open one of the same item of attention; otherwise returns the
   * existing one.
   */
  private async insertOnce(request: Continuation): Promise<Inserted> {
    let conflict: unknown;

    // A second pass is needed only when the open row concluded between the failed insert and the
    // read: then the insert succeeds.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const row = await this.prisma.scheduledCheck.create({
          data: {
            discussionId: request.discussionId ?? null,
            notionPageId: request.notionPageId,
            runAt: request.runAt,
            reasonCode: request.reasonCode,
          },
        });

        return { row, created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        conflict = error;

        const open = await this.prisma.scheduledCheck.findFirst({ where: openFor(request) });

        if (open) return { row: open, created: false };
      }
    }

    throw conflict;
  }

  /** Checks whether a person's snooze that has not fired yet holds the thread. */
  async holdsPersonsSnooze(request: Continuation): Promise<boolean> {
    const held = await this.prisma.scheduledCheck.findFirst({
      where: { AND: [openFor(request), personsWaitingSnooze()] },
      select: { id: true },
    });

    return held !== null;
  }

  /**
   * Returns the time until which a person's snooze that has not fired yet holds pages or threads:
   * the latest time among the snoozes of these pages — on any of their threads or on none — and of
   * these threads. `null` means none holds them.
   */
  async personsSnoozeUntil(target: SnoozeTarget): Promise<Date | null> {
    if (target.pages.length === 0 && target.discussions.length === 0) return null;

    const held = await this.prisma.scheduledCheck.findFirst({
      where: {
        AND: [
          { status: { in: [...OPEN] } },
          personsWaitingSnooze(),
          {
            OR: [
              ...target.pages.map((notionPageId) => ({ notionPageId })),
              ...target.discussions.map((discussionId) => ({ discussionId })),
            ],
          },
        ],
      },
      orderBy: { runAt: 'desc' },
      select: { runAt: true },
    });

    return held?.runAt ?? null;
  }

  /**
   * Returns the open continuations of a thread — or of a page, possibly with a reason — soonest
   * first. The caller picks the class: a wake is what the model sees and moves, `any` is everything
   * the system is busy with on the thread. The class filter sits in the query, not after it: a
   * closure filtered out afterward would eat into the `take` window and distort the truncation
   * flag.
   *
   * A thread has one wake, a page has one per thread and reason, so the `take` limit keeps the
   * response finite instead of truncating the ordinary case.
   */
  open(
    where: ContinuationQuery,
    take: number,
    kind: ReasonClass | 'any',
  ): Promise<ScheduledCheck[]> {
    return this.prisma.scheduledCheck.findMany({
      where: {
        AND: [
          { ...where, status: { in: [...OPEN] } },
          kind === 'any' ? {} : { reasonCode: { in: reasonsOf(kind) } },
        ],
      },
      orderBy: { runAt: 'asc' },
      take,
    });
  }

  /** Lists the threads that have an open continuation, a wake or a closure. */
  async openDiscussions(): Promise<string[]> {
    const rows = await this.prisma.scheduledCheck.findMany({
      where: { discussionId: { not: null }, status: { in: [...OPEN] } },
      select: { discussionId: true },
      distinct: ['discussionId'],
    });

    return rows.flatMap((row) => (row.discussionId === null ? [] : [row.discussionId]));
  }

  /**
   * Returns the wakes that did not take place, whose time the person named and that the person
   * has not yet been told about, oldest first. The system chose the rest of the times: the run
   * trace will report a failure of those wakes.
   */
  unnoticedFailures(): Promise<ScheduledCheck[]> {
    return this.prisma.scheduledCheck.findMany({
      where: {
        status: 'failed',
        failureNoticedAt: null,
        reasonCode: { in: [...REASONS_REQUESTED_BY_PERSON] },
      },
      orderBy: { runAt: 'asc' },
    });
  }

  /** Marks the person as told: a wake that did not take place no longer awaits a notice. */
  async markFailureNoticed(id: string): Promise<void> {
    await this.prisma.scheduledCheck.update({
      where: { id },
      data: { failureNoticedAt: new Date() },
    });
  }

  /**
   * Moves the time of an existing open continuation, in a single statement. A search and a write
   * as two queries would write a new `run_at` to the terminal row of a continuation that closed in
   * that gap: what the person said would vanish, and the caller would receive the row as if
   * everything had succeeded.
   *
   * An empty response means “no open one”. It does not matter whether there was none at all or the
   * open one just closed: both cases lead to creating a new one. For a request not from the
   * person, “none” also means that the person's snooze, which has not fired yet, holds the thread.
   *
   * The reason is written together with the time (`contracts/canonical.yaml`, key
   * `scheduled_check`).
   */
  private async moveOpen(request: Continuation, byPerson: boolean): Promise<ScheduledCheck | null> {
    const [moved] = await this.prisma.scheduledCheck.updateManyAndReturn({
      where: byPerson
        ? openFor(request)
        : { AND: [openFor(request), { NOT: personsWaitingSnooze() }] },
      data: {
        runAt: request.runAt,
        reasonCode: request.reasonCode,
        version: { increment: 1 },
        // A moved continuation is a new request: the Notion hold on the old one does not carry
        // over to it (ADR 0045).
        notionHoldUntil: null,
        notionHeldSince: null,
      },
    });

    return moved ?? null;
  }
}
