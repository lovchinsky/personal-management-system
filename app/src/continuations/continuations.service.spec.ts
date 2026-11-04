import { Test } from '@nestjs/testing';
import { differenceInMilliseconds } from 'date-fns';
import { ScheduledCheck } from '../generated/prisma/client';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { Actor, CHAT } from '../runs/actor';
import {
  Continuation,
  ContinuationQuery,
  ContinuationRequest,
  continuationSchema,
} from './continuation.schema';
import { ContinuationStatesWire } from './continuation.wire';
import {
  ClosureRequest,
  CONTINUATION_STATE_LIMIT,
  ContinuationsService,
} from './continuations.service';
import { ScheduledCheckRepository } from './scheduled-check.repository';

const REQUEST: ContinuationRequest = {
  discussionId: 'discussion-1',
  notionPageId: 'page-1',
  runAt: new Date('2026-09-28T09:00:00.000Z'),
  reasonCode: 'await_external_event',
};

const SCHEDULED: ScheduledCheck = {
  id: 'check-1',
  discussionId: 'discussion-1',
  notionPageId: 'page-1',
  runAt: new Date('2026-09-28T09:00:00.000Z'),
  reasonCode: 'await_external_event',
  version: 0,
  status: 'pending',
  attemptCount: 0,
  lockedUntil: null,
  lastAttemptAt: null,
  lastError: null,
  failureNoticedAt: null,
  notionHoldUntil: null,
  notionHeldSince: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** The person replied in a thread that Personal Management System manages. */
const REPLY: Actor = {
  kind: 'run',
  runId: 'run-1',
  mode: 'event_evaluation',
  provenance: { origin: 'managed_discussion_reply' },
  startedAt: new Date('2026-09-28T07:00:00.000Z'),
};

/**
 * A scheduled review the person configured: the run is exempt from the budget but carries none of
 * the person's words. It started two hours before `REQUEST.runAt`, so the request passes the limit
 * of an autonomous step.
 */
const REVIEW: Actor = {
  kind: 'run',
  runId: 'run-2',
  mode: 'daily_control',
  provenance: { origin: 'review_schedule' },
  startedAt: new Date('2026-09-28T07:00:00.000Z'),
};

interface Scheduling {
  readonly service: ContinuationsService;
  /** What reached the queue: the request and whether the person is the one asking. */
  readonly asked: [ContinuationRequest, boolean][];
  /** Which open continuations the queue was asked about. */
  readonly looked: ContinuationQuery[];
  /** Classes of continuation requested from the queue: the model sees `wake`, the system `any`. */
  readonly kinds: string[];
  /** Closures that reached the queue. */
  readonly closed: Continuation[];
}

/**
 * Builds a service over a queue that remembers requests. `held`: a person's snooze holds the
 * thread, which is how the queue answers a request that does not move it. `open`: the open
 * continuations, of which the queue returns as many as were asked for. `closing`: the thread
 * already has an open closure, which is how the queue answers a repeated request.
 */
async function continuationsOver(
  held = false,
  open: readonly ScheduledCheck[] = [SCHEDULED],
  closing = false,
): Promise<Scheduling> {
  const asked: [ContinuationRequest, boolean][] = [];
  const looked: ContinuationQuery[] = [];
  const kinds: string[] = [];
  const closed: Continuation[] = [];
  const checks: Pick<
    ScheduledCheckRepository,
    'schedule' | 'holdsPersonsSnooze' | 'open' | 'closure'
  > = {
    schedule: (request, byPerson) => {
      asked.push([request, byPerson]);

      return Promise.resolve(held && !byPerson ? null : SCHEDULED);
    },
    holdsPersonsSnooze: () => Promise.resolve(held),
    open: (where, take, kind) => {
      looked.push(where);
      kinds.push(kind);

      return Promise.resolve(open.slice(0, take));
    },
    closure: (request) => {
      closed.push(request);

      return Promise.resolve({ row: SCHEDULED, created: !closing });
    },
  };

  const moduleRef = await Test.createTestingModule({
    providers: [ContinuationsService, { provide: ScheduledCheckRepository, useValue: checks }],
  }).compile();

  return { service: moduleRef.get(ContinuationsService), asked, looked, kinds, closed };
}

describe('continuation as a capability', () => {
  it('passes a request to the queue together with whether the person speaks', async () => {
    const { service, asked } = await continuationsOver();

    await service.schedule(REPLY, REQUEST);
    await service.schedule(REVIEW, REQUEST);

    const expected: [ContinuationRequest, boolean][] = [
      [REQUEST, true],
      [REQUEST, false],
    ];

    expect(asked).toEqual(expected);
  });

  /**
   * `user_snooze` exempts a run from the budget and from quiet hours because the person named the
   * time. A step that carries none of the person's words cannot name it on the person's behalf,
   * not even an exempt review.
   */
  it('lets only a step in which the person speaks name a snooze', async () => {
    const { service, asked } = await continuationsOver();
    const snooze: ContinuationRequest = { ...REQUEST, reasonCode: 'user_snooze' };

    await expect(service.schedule(REVIEW, snooze)).rejects.toThrow(InvalidRequestError);
    await expect(service.schedule(REPLY, snooze)).resolves.toEqual(SCHEDULED);
    await expect(service.schedule(CHAT, snooze)).resolves.toEqual(SCHEDULED);
    expect(asked).toHaveLength(2);
  });

  it("refuses instead of succeeding silently when a person's snooze stays unmoved", async () => {
    const { service } = await continuationsOver(true);

    await expect(service.schedule(REVIEW, REQUEST)).rejects.toThrow(
      "the thread holds the person's own snooze",
    );
  });

  /**
   * A run without the person does not wake a thread sooner than an hour after its start:
   * otherwise a continuation that moves its own row to “due immediately” would wake itself
   * endlessly. The limit is measured from the start of the run, so the check and the write give
   * the same answer.
   */
  describe('limit of an autonomous step', () => {
    const at = (iso: string): Date => new Date(iso);
    const started = (iso: string): Actor => ({ ...REVIEW, startedAt: at(iso) });

    it('refuses a check and a write sooner than an hour after the run starts', async () => {
      const { service, asked } = await continuationsOver();
      const hasty = started('2026-09-28T08:30:00.000Z');

      await expect(service.check(hasty, REQUEST)).rejects.toThrow('2026-09-28T09:30:00.000Z');
      await expect(service.schedule(hasty, REQUEST)).rejects.toThrow(InvalidRequestError);
      expect(asked).toHaveLength(0);
    });

    it('allows exactly an hour after the run started', async () => {
      const { service } = await continuationsOver();

      await expect(service.schedule(started('2026-09-28T08:00:00.000Z'), REQUEST)).resolves.toEqual(
        SCHEDULED,
      );
    });

    it('has no limit for a step in which the person speaks', async () => {
      const { service } = await continuationsOver();
      const minuteLater: Actor = { ...REPLY, startedAt: at('2026-09-28T08:59:00.000Z') };

      await expect(service.schedule(minuteLater, REQUEST)).resolves.toEqual(SCHEDULED);
      await expect(service.schedule(CHAT, REQUEST)).resolves.toEqual(SCHEDULED);
    });
  });

  /**
   * A thread closure is the App's reaction to a resolution that was found. `INV-095` enforces that
   * no step names its reason. The tests here cover how a closure reaches the queue.
   */
  describe('thread closure', () => {
    const THREAD: ClosureRequest = { discussionId: 'discussion-1', notionPageId: 'page-1' };

    it('requestClosure schedules a closure due immediately and does not touch wakes', async () => {
      const { service, asked, closed } = await continuationsOver();

      await expect(service.requestClosure(THREAD)).resolves.toBe('requested');
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({ ...THREAD, reasonCode: 'resolution_reconciliation' });
      expect(Math.abs(differenceInMilliseconds(closed[0].runAt, new Date()))).toBeLessThan(5_000);
      expect(asked).toEqual([]);
    });

    it("is not hindered by a person's snooze, because a closure is in another place in the queue", async () => {
      const { service } = await continuationsOver(true);

      await expect(service.requestClosure(THREAD)).resolves.toBe('requested');
    });

    it('schedules nothing when an open closure already exists, and says so', async () => {
      const { service } = await continuationsOver(false, [SCHEDULED], true);

      await expect(service.requestClosure(THREAD)).resolves.toBe('already_requested');
    });

    it('treats a thread without an id as no thread', async () => {
      const { service, closed } = await continuationsOver();

      await expect(service.requestClosure({ ...THREAD, discussionId: '' })).rejects.toThrow(
        InvalidRequestError,
      );
      expect(closed).toHaveLength(0);
    });

    /**
     * What the model sees in `get_continuation_state`, and what the system sees in the question
     * “does it manage the thread”: the model does not move a closure, but a closure makes the
     * thread managed.
     */
    it("puts only wakes in the model's state, and counts wakes and closures when deciding whether the system manages a thread", async () => {
      const { service, kinds } = await continuationsOver();

      await service.state({ discussionId: 'discussion-1' }, []);
      await service.hasOpenFor('discussion-1');

      expect(kinds).toEqual(['wake', 'any']);
    });
  });

  it('treats an empty thread as no thread, and does not pass it to the queue', async () => {
    const { service, asked } = await continuationsOver();
    const nameless: ContinuationRequest = { ...REQUEST, discussionId: '' };

    await expect(service.schedule(REPLY, nameless)).rejects.toThrow(InvalidRequestError);
    expect(asked).toHaveLength(0);
  });

  /**
   * The types would not let a request with an extra or malformed field through, but the transport
   * reads JSON, not types: the schema enforces the boundary, and it is tested on untyped input.
   */
  it('refuses an extra or malformed field instead of staying silent', () => {
    const misspelt: Record<string, unknown> = {
      discusionId: 'discussion-1',
      notionPageId: 'page-1',
      runAt: REQUEST.runAt,
      reasonCode: 'await_external_event',
    };
    const undated: Record<string, unknown> = { ...REQUEST, runAt: new Date('not a date') };

    expect(continuationSchema.safeParse(misspelt).success).toBe(false);
    expect(continuationSchema.safeParse(undated).success).toBe(false);
    expect(continuationSchema.safeParse({ ...REQUEST }).success).toBe(true);
  });

  /** A check says early what the write would say late, and schedules nothing. */
  it('refuses in a check without a write what the write refuses', async () => {
    const snoozed: ContinuationRequest = { ...REQUEST, reasonCode: 'user_snooze' };

    await expect((await continuationsOver()).service.check(REVIEW, REQUEST)).resolves.toEqual(
      REQUEST,
    );
    await expect((await continuationsOver()).service.check(REVIEW, snoozed)).rejects.toThrow(
      InvalidRequestError,
    );
    await expect((await continuationsOver(true)).service.check(REVIEW, REQUEST)).rejects.toThrow(
      "the person's own snooze",
    );

    const { service, asked } = await continuationsOver(true);

    await expect(service.check(REPLY, REQUEST)).resolves.toEqual(REQUEST);
    expect(asked).toHaveLength(0);
  });

  /** An open continuation is one of the signs of a thread the system manages (`INV-089`). */
  it('a thread with an open continuation is visible, and one without is not', async () => {
    const held = await continuationsOver(false, [SCHEDULED]);
    const empty = await continuationsOver(false, []);

    await expect(held.service.hasOpenFor('discussion-1')).resolves.toBe(true);
    await expect(empty.service.hasOpenFor('discussion-1')).resolves.toBe(false);
  });

  /** `INV-030`: thread, page, reason, time and status, without attempts and lease. */
  it('returns the open continuations as the state, without queue bookkeeping', async () => {
    const { service } = await continuationsOver();

    await expect(service.state({ discussionId: 'discussion-1' }, [])).resolves.toEqual({
      continuations: [
        {
          discussion_id: 'discussion-1',
          page_id: 'page-1',
          reason_code: 'await_external_event',
          run_at: '2026-09-28T09:00:00.000Z',
          status: 'pending',
        },
      ],
    });
  });

  /**
   * The model may take an id from a URL, where it has no hyphens: a question about the same thread
   * or page reaches the queue in the same form as its rows.
   */
  it('passes a question with an id without hyphens to the queue in canonical form', async () => {
    const { service, looked } = await continuationsOver();
    const undashed = '1F2E3D4C5B6A49788A9B0C1D2E3F4A5B';
    const dashed = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';

    await service.state({ discussionId: undashed }, []);
    await service.state({ notionPageId: undashed, reasonCode: 'user_snooze' }, []);

    const expected: ContinuationQuery[] = [
      { discussionId: dashed },
      { notionPageId: dashed, reasonCode: 'user_snooze' },
    ];

    expect(looked).toEqual(expected);
  });

  /** The model would read silent truncation as “there are no more”. */
  it('says a state over the limit is truncated', async () => {
    const crowded = Array<ScheduledCheck>(CONTINUATION_STATE_LIMIT + 5).fill(SCHEDULED);
    const { service } = await continuationsOver(false, crowded);

    const state = await service.state({ notionPageId: 'page-1' }, []);

    expect(state.truncated).toBe(true);
    expect(state.continuations).toHaveLength(CONTINUATION_STATE_LIMIT);
  });

  it('does not truncate a state exactly at the limit', async () => {
    const full = Array<ScheduledCheck>(CONTINUATION_STATE_LIMIT).fill(SCHEDULED);
    const { service } = await continuationsOver(false, full);

    const state = await service.state({ notionPageId: 'page-1' }, []);

    expect(state).not.toHaveProperty('truncated');
    expect(state.continuations).toHaveLength(CONTINUATION_STATE_LIMIT);
  });

  /**
   * What a run has written is shown in the same form as a queue row and supersedes the open
   * continuation of the same thread, because applying the run's writes will move that continuation.
   */
  it('supersedes the open one of the same thread with what a run has written', async () => {
    const { service } = await continuationsOver();
    const moved: ContinuationRequest = {
      ...REQUEST,
      runAt: new Date('2026-09-30T09:00:00.000Z'),
      reasonCode: 'safety_recheck',
    };
    const expected: ContinuationStatesWire = {
      continuations: [
        {
          discussion_id: 'discussion-1',
          page_id: 'page-1',
          reason_code: 'safety_recheck',
          run_at: '2026-09-30T09:00:00.000Z',
          status: 'staged',
        },
      ],
    };

    await expect(service.state({ discussionId: 'discussion-1' }, [moved])).resolves.toEqual(
      expected,
    );
  });

  /**
   * A thread moved with another reason disappears from the response about the old reason too:
   * otherwise the model would see the old time alongside the new one.
   */
  it('does not show a superseded continuation under the old reason either', async () => {
    const { service } = await continuationsOver();
    const moved: ContinuationRequest = { ...REQUEST, reasonCode: 'safety_recheck' };
    const empty: ContinuationStatesWire = { continuations: [] };

    await expect(
      service.state({ notionPageId: 'page-1', reasonCode: 'await_external_event' }, [moved]),
    ).resolves.toEqual(empty);
  });

  it('shows the last of several requests for the same thread', async () => {
    const { service } = await continuationsOver(false, []);
    const first: ContinuationRequest = { ...REQUEST, runAt: new Date('2026-09-30T09:00:00.000Z') };
    const last: ContinuationRequest = { ...REQUEST, runAt: new Date('2026-10-01T09:00:00.000Z') };

    const state = await service.state({ notionPageId: 'page-1' }, [first, last]);

    expect(state.continuations.map((continuation) => continuation.run_at)).toEqual([
      '2026-10-01T09:00:00.000Z',
    ]);
  });
});
