import { Injectable } from '@nestjs/common';
import { addMinutes, isBefore } from 'date-fns';
import { ScheduledCheck } from '../generated/prisma/client';
import { canonicalDiscussionId, canonicalNotionId } from '../notion/client/notion-id';
import { InvalidRequestError, parsedRequest } from '../platform/request/invalid-request';
import { isReviewMode } from '../reviews/review-modes';
import { Actor, personSpeaks } from '../runs/actor';
import { sameContinuation } from './continuation-identity';
import {
  Continuation,
  ContinuationQuery,
  ContinuationRequest,
  continuationSchema,
} from './continuation.schema';
import {
  continuationStateOf,
  ContinuationStatesWire,
  stagedContinuationOf,
} from './continuation.wire';
import { REASON_CLASS } from './reason-class';
import { ScheduledCheckRepository, SnoozeTarget } from './scheduled-check.repository';

/**
 * How many open continuations one state request returns. A thread has one wake, a page has one per
 * thread and reason; the limit keeps the response finite (`INV-303`) instead of truncating the
 * ordinary case.
 */
export const CONTINUATION_STATE_LIMIT = 20;

const SNOOZE_BY_PERSON_ONLY =
  'continuation: user_snooze is a time the person stated, and only a step where the person speaks can state it';

const CLOSURE_BY_APP_ONLY =
  'continuation: resolution_reconciliation is set by the App when it finds a thread resolved — no step that asks for a continuation names it';

const SNOOZE_HELD =
  "continuation: the thread holds the person's own snooze, still waiting for its moment, and only the person moves it";

/**
 * The minimum time that passes between the start of a run without the person and the time of a
 * continuation it schedules (`contracts/canonical.yaml`, key `scheduled_check`, field
 * `autonomous_min_lead_minutes`).
 */
export const AUTONOMOUS_MIN_LEAD_MINUTES = 60;

/** A thread the App found resolved: its closure is the next run of that thread. */
export interface ClosureRequest {
  readonly discussionId: string;
  readonly notionPageId: string;
}

/**
 * Continuation of attention over time is a capability, and this service is the single entry to it.
 *
 * “Schedule”, “reschedule” and “snooze” are the same call: a thread has one open wake, and a new
 * request moves it. There is no cancellation, and that is a decision, not an omission
 * (`contracts/canonical.yaml`, key `scheduled_check`). The closure of a resolved thread is a
 * separate place in the same queue and is not covered by this call (`requestClosure`).
 *
 * The decisions here concern snooze, a time the person named themselves: only a step in which
 * the person speaks sets it, and while it has not fired yet, only the person moves it as well
 * (`contracts/canonical.yaml`, key `scheduled_check`).
 */
@Injectable()
export class ContinuationsService {
  constructor(private readonly checks: ScheduledCheckRepository) {}

  /**
   * Checks a request without writing anything: everything `schedule` checks.
   *
   * A person's snooze that has not fired yet is checked by a read, not a write, so the person can
   * set it between the check and the write; then it is `schedule` that refuses. A check made
   * before the write answers early, not conclusively.
   */
  async check(actor: Actor, request: ContinuationRequest): Promise<Continuation> {
    const continuation = this.admitted(actor, request);

    if (!personSpeaks(actor) && (await this.checks.holdsPersonsSnooze(continuation))) {
      throw new InvalidRequestError(SNOOZE_HELD);
    }

    return continuation;
  }

  /**
   * Keeps a review from saying anything about what the person snoozed. A snooze that has not fired
   * yet rules out a repeat interruption before its time, unless a new critical event has occurred
   * (`docs/3-policy.md` § “Snooze”). A review carries no new event — it looks over what exists — so
   * the snooze keeps it away from the page and thread the person snoozed
   * (`contracts/canonical.yaml`, key `scheduled_check`). A run for an event or a continuation
   * judges a new event itself. `what` is the write being refused, worded as it appears in the
   * refusal.
   */
  async assertNotSnoozed(actor: Actor, target: SnoozeTarget, what: string): Promise<void> {
    if (actor.kind !== 'run' || !isReviewMode(actor.mode)) return;

    const until = await this.checks.personsSnoozeUntil({
      pages: target.pages.map(canonicalNotionId),
      discussions: target.discussions.map(canonicalNotionId),
    });

    if (until) {
      throw new InvalidRequestError(
        `${what}: the person snoozed this until ${until.toISOString()} — a review says ` +
          'nothing about it before then; the snooze wakes its own run at that moment',
      );
    }
  }

  async schedule(actor: Actor, request: ContinuationRequest): Promise<ScheduledCheck> {
    const continuation = this.admitted(actor, request);
    const scheduled = await this.checks.schedule(continuation, personSpeaks(actor));

    if (!scheduled) {
      throw new InvalidRequestError(SNOOZE_HELD);
    }

    return scheduled;
  }

  /**
   * Asks to close a thread the App found resolved, by scheduling a closure for it (reason
   * `resolution_reconciliation`) that is due immediately. The closure has its own place in the
   * queue: a thread's wake, a person's snooze and a deadline do not move it, and it does not move
   * them. The answer is `requested` (scheduled) or `already_requested`, which means an open
   * closure already exists and the request changes nothing, including a row that is already going
   * into a run. A new resolution after a completed closure is a new closure.
   *
   * This is an entry for whoever found the resolution, not for a step that requests a
   * continuation, because a step cannot name this reason (`admitted`). Before calling
   * `requestClosure`, the caller asks whether the system manages the thread
   * (`AttentionService.managed`, `INV-089`), because there is no point in closing someone else's
   * conversation.
   */
  async requestClosure(thread: ClosureRequest): Promise<'requested' | 'already_requested'> {
    const closure = parsedRequest(
      continuationSchema,
      { ...thread, runAt: new Date(), reasonCode: 'resolution_reconciliation' },
      'closure request',
    );

    return (await this.checks.closure(closure)).created ? 'requested' : 'already_requested';
  }

  /**
   * Asks for a recheck of a page on which the sweep found a situation that arose with the passage
   * of time or without an event: a `safety_recheck` wake without a thread, due immediately. Like
   * closure, this is an entry for the App, not for a step. If an open wake of the same page and
   * reason already exists, the request changes nothing and does not move the time a run named
   * (`already_requested`). A wake with another reason, including a person's snooze, is a separate
   * item of attention, and the request does not touch it.
   */
  async requestSafetyRecheck(page: {
    readonly notionPageId: string;
  }): Promise<'requested' | 'already_requested'> {
    const recheck = parsedRequest(
      continuationSchema,
      { ...page, runAt: new Date(), reasonCode: 'safety_recheck' },
      'safety recheck request',
    );

    return (await this.checks.pageWake(recheck)).created ? 'requested' : 'already_requested';
  }

  /**
   * Checks whether the page has an open continuation, of any thread or of none, a wake or a
   * closure. An open continuation means someone is already handling the page.
   */
  async hasOpenOnPage(notionPageId: string): Promise<boolean> {
    const open = await this.checks.open(
      { notionPageId: canonicalNotionId(notionPageId) },
      1,
      'any',
    );

    return open.length > 0;
  }

  /**
   * Returns the threads that have an open continuation. They are part of the threads the system
   * manages.
   */
  openDiscussions(): Promise<string[]> {
    return this.checks.openDiscussions();
  }

  /**
   * Checks whether the thread has an open continuation, a wake or a closure. That is one of the
   * signs of a thread the system manages (`contracts/canonical.yaml`, key `system_discussion`).
   */
  async hasOpenFor(discussionId: string): Promise<boolean> {
    const open = await this.checks.open(
      { discussionId: canonicalNotionId(discussionId) },
      1,
      'any',
    );

    return open.length > 0;
  }

  /**
   * Returns the open wakes of a thread — or of a page, possibly with a reason — together with
   * those written by this run. Closures are not among them: the model neither schedules nor moves
   * them.
   *
   * What is written supersedes the open continuation of the same item of attention
   * (`sameContinuation`), because applying the writes will move the open one. Whether an open
   * continuation is superseded is checked against all the run's writes, while a write is shown only
   * if it is among those that were asked about: a write that moves a thread to another reason
   * removes its old state from the response about the old reason too.
   *
   * A limit that truncated the response says so, because the model would read silent truncation as
   * “there are no more”.
   */
  async state(
    query: ContinuationQuery,
    staged: readonly Continuation[],
  ): Promise<ContinuationStatesWire> {
    const asked: ContinuationQuery =
      'discussionId' in query
        ? { discussionId: canonicalDiscussionId(query.discussionId) }
        : { notionPageId: canonicalNotionId(query.notionPageId), reasonCode: query.reasonCode };
    const rows = await this.checks.open(asked, CONTINUATION_STATE_LIMIT + 1, 'wake');
    const written = latestOf(staged);
    const open = rows
      .slice(0, CONTINUATION_STATE_LIMIT)
      .filter((row) => !written.some((request) => sameContinuation(request, row)));
    const shown = written.filter((request) => answers(asked, request));

    return {
      continuations: [...open.map(continuationStateOf), ...shown.map(stagedContinuationOf)],
      ...(rows.length > CONTINUATION_STATE_LIMIT ? { truncated: true } : {}),
    };
  }

  /**
   * Returns a request that has passed the schema, the rule about a person's snooze and the limit
   * of an autonomous step.
   *
   * The limit is measured from the start of the run, not from the clock, so `check` and `schedule`
   * of the same run give the same answer however much time passes between them.
   */
  private admitted(actor: Actor, request: ContinuationRequest): Continuation {
    const continuation = parsedRequest(continuationSchema, request, 'continuation');

    if (continuation.reasonCode === 'user_snooze' && !personSpeaks(actor)) {
      throw new InvalidRequestError(SNOOZE_BY_PERSON_ONLY);
    }

    if (REASON_CLASS[continuation.reasonCode] === 'closure') {
      throw new InvalidRequestError(CLOSURE_BY_APP_ONLY);
    }

    if (actor.kind === 'run' && !personSpeaks(actor)) {
      const earliest = addMinutes(actor.startedAt, AUTONOMOUS_MIN_LEAD_MINUTES);

      if (isBefore(continuation.runAt, earliest)) {
        throw new InvalidRequestError(
          `continuation: a run where the person does not speak wakes a thread no sooner than ` +
            `${AUTONOMOUS_MIN_LEAD_MINUTES} minutes after the run started — ` +
            `${earliest.toISOString()} at the earliest. What cannot wait that long ` +
            'belongs in this run.',
        );
      }
    }

    return continuation;
  }
}

function answers(asked: ContinuationQuery, request: Continuation): boolean {
  if ('discussionId' in asked) return request.discussionId === asked.discussionId;

  return (
    request.notionPageId === asked.notionPageId &&
    (asked.reasonCode === undefined || request.reasonCode === asked.reasonCode)
  );
}

/** The last request for each item of attention is the one that will be applied last. */
function latestOf(staged: readonly Continuation[]): Continuation[] {
  return staged.reduce<Continuation[]>(
    (latest, request) => [...latest.filter((other) => !sameContinuation(other, request)), request],
    [],
  );
}
