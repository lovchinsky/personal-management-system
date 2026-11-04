import { ScheduledCheck } from '../generated/prisma/client';
import { ReasonCode } from '../generated/prisma/enums';
import { scheduledCheckEnvelope } from './scheduled-check.rows';

function checkWith(reasonCode: ReasonCode): ScheduledCheck {
  return {
    id: 'check-1',
    discussionId: 'discussion-1',
    notionPageId: 'page-1',
    runAt: new Date('2026-10-08T09:00:00.000Z'),
    reasonCode,
    version: 2,
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
}

/**
 * A continuation row wakes a run of its mode. The reason determines the mode: the closure of a
 * resolved thread is a separate procedure, not a recheck.
 */
describe('envelope of a continuation row', () => {
  const others = Object.values(ReasonCode).filter((code) => code !== 'resolution_reconciliation');

  it.each(others)('reason %s wakes a recheck', (reasonCode) => {
    const envelope = scheduledCheckEnvelope(checkWith(reasonCode));

    expect(envelope).toEqual({
      mode: 'scheduled_recheck',
      trigger: {
        type: 'scheduled_recheck',
        event_id: 'check-1:2',
        discussion_id: 'discussion-1',
        page_id: 'page-1',
        reason_code: reasonCode,
      },
    });
  });

  it('a thread closure wakes a closure, with the cause in the same form', () => {
    expect(scheduledCheckEnvelope(checkWith('resolution_reconciliation'))).toEqual({
      mode: 'closure_processing',
      trigger: {
        type: 'closure_processing',
        event_id: 'check-1:2',
        discussion_id: 'discussion-1',
        page_id: 'page-1',
        reason_code: 'resolution_reconciliation',
      },
    });
  });
});
