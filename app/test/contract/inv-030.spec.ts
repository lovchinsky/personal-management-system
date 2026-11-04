import { proposalStateOf } from '../../src/approvals/proposal.wire';
import { continuationStateOf } from '../../src/continuations/continuation.wire';
import { deliveryStateOf } from '../../src/delivery/delivery.wire';
import {
  NotificationOutbox,
  PendingAction,
  ScheduledCheck,
} from '../../src/generated/prisma/client';
import {
  closureEnvelope,
  eventEnvelope,
  recheckEnvelope,
  reviewEnvelope,
  TriggerEnvelope,
} from '../../src/runs/trigger-envelope';
import { canonical } from './contracts';

/**
 * `INV-030` The trigger envelope is narrow JSON. `app_db` rows, retry bookkeeping and the database
 * schema do not reach the prompt.
 *
 * Alongside this invariant, the makeup of the event envelope is checked against
 * `trigger_envelope`, and so is `INV-020`: a continuation passes only `type` and the four origin
 * fields.
 *
 * The makeup is established by an instance, not a type: a field added to the interface breaks the
 * compilation of this file, and a field added to the contract breaks the comparison. A divergence
 * in either direction shows up.
 */
const EVENT: TriggerEnvelope = eventEnvelope('event_evaluation', {
  type: 'comment.created',
  event_types: ['comment.created'],
  event_id: 'evt-1',
  timestamp: '2026-09-25T10:30:00+03:00',
  entity_id: 'page-1',
  page_id: 'page-1',
  discussion_id: 'discussion-1',
  updated_property_ids: ['aGCp'],
});

const RECHECK: TriggerEnvelope = recheckEnvelope({
  event_id: 'check-1:2',
  discussion_id: 'discussion-1',
  page_id: 'page-1',
  reason_code: 'user_snooze',
});

const CLOSURE: TriggerEnvelope = closureEnvelope({
  event_id: 'check-2:0',
  discussion_id: 'discussion-1',
  page_id: 'page-1',
  reason_code: 'resolution_reconciliation',
});

const REVIEW: TriggerEnvelope = reviewEnvelope('weekly_control_review', {
  event_id: 'review:weekly_control_review:2026-W42',
  timestamp: '2026-10-18T15:00:00.000Z',
  since: '2026-10-11T15:00:00.000Z',
});

function paths(envelope: TriggerEnvelope): string[] {
  return ['mode', ...Object.keys(envelope.trigger).map((key) => `trigger.${key}`)];
}

describe('INV-030', () => {
  const declared = canonical.triggerEnvelope().variants;

  it('the event envelope consists of exactly the contract fields', () => {
    expect(paths(EVENT)).toEqual(declared.event);
  });

  it('the continuation envelope (wake and closure) consists of exactly the contract fields', () => {
    expect(paths(RECHECK)).toEqual(declared.continuation);
    expect(paths(CLOSURE)).toEqual(declared.continuation);
  });

  it('the review envelope consists of exactly the contract fields', () => {
    expect(paths(REVIEW)).toEqual(declared.review);
  });

  /**
   * The list consists of the names of the queue and ledger columns. They are tempting because they
   * are at hand for whoever builds the envelope. The model has no need to see any of them.
   */
  it.each([
    'attempt_count',
    'attempt_number',
    'locked_until',
    'last_attempt_at',
    'last_error',
    'next_attempt_at',
    'idempotency_key',
    'status',
    'fingerprint',
    'budget_class',
  ])('the envelope does not contain %s', (forbidden) => {
    for (const envelope of [EVENT, RECHECK, CLOSURE, REVIEW]) {
      expect(JSON.stringify(envelope)).not.toContain(forbidden);
    }
  });
});

/**
 * The second half of `INV-030` is that a `get_*` response of the App MCP carries the lifecycle
 * status and domain times, but not queue bookkeeping.
 *
 * The witness is a row with every bookkeeping field filled in: a field the mapping let out would
 * certainly show here.
 */
describe('INV-030: get_* responses of the App MCP', () => {
  const at = new Date('2026-09-28T10:00:00.000Z');

  const check: ScheduledCheck = {
    id: 'check-1',
    discussionId: 'discussion-1',
    notionPageId: 'page-1',
    runAt: at,
    reasonCode: 'await_external_event',
    version: 3,
    status: 'running',
    attemptCount: 2,
    lockedUntil: at,
    lastAttemptAt: at,
    lastError: 'run died',
    failureNoticedAt: at,
    notionHoldUntil: at,
    notionHeldSince: at,
    createdAt: at,
    updatedAt: at,
  };

  const delivery: NotificationOutbox = {
    id: 'row-1',
    idempotencyKey: 'nudge-1',
    discussionId: null,
    channel: 'telegram',
    externalId: null,
    payload: {},
    status: 'pending',
    attemptCount: 2,
    nextAttemptAt: at,
    lockedUntil: at,
    quietHoursExempt: true,
    sentAt: null,
    lastError: 'retry_after',
    createdAt: at,
  };

  const proposal: PendingAction = {
    id: 'action-1',
    discussionId: null,
    proposedByRunId: 'run-1',
    notionPageId: 'page-1',
    fingerprint: 'fingerprint-1',
    effects: [],
    preconditions: [],
    status: 'approved',
    createdAt: at,
    resolvedAt: null,
    lastError: 'server unreachable',
    nextAttemptAt: at,
    publishedStatus: 'approved',
    approvedAt: at,
    accessFailures: 1,
    failure: null,
    recheckRequestedAt: null,
  };

  const BOOKKEEPING = [
    'attempt',
    'locked',
    'last_error',
    'noticed',
    'notion_hold',
    'notion_held',
    'next_attempt',
    'version',
    'fingerprint',
    'quiet_hours_exempt',
    'payload',
    'proposed_by',
  ];

  it.each([
    ['get_continuation_state', continuationStateOf(check)],
    ['get_delivery_state', deliveryStateOf(delivery)],
    ['get_pending_action', proposalStateOf(proposal)],
  ])('%s contains no queue bookkeeping', (_, state) => {
    const keys = Object.keys(state);

    expect(keys.filter((key) => BOOKKEEPING.some((kept) => key.includes(kept)))).toEqual([]);
    expect(keys).toContain('status');
  });
});

describe('INV-020', () => {
  it('a continuation passes only the wake, the thread, the page and the reason', () => {
    expect(Object.keys(RECHECK.trigger).sort()).toEqual(
      ['discussion_id', 'event_id', 'page_id', 'reason_code', 'type'].sort(),
    );
  });

  it('the continuation mode is named by the envelope itself', () => {
    expect(RECHECK.mode).toBe('scheduled_recheck');
  });

  it('a thread closure passes the same fields, and the envelope itself names the mode', () => {
    expect(Object.keys(CLOSURE.trigger).sort()).toEqual(Object.keys(RECHECK.trigger).sort());
    expect(CLOSURE.mode).toBe('closure_processing');
  });
});
