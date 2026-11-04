import { Test } from '@nestjs/testing';
import { ContinuationRequest } from '../../src/continuations/continuation.schema';
import { continuationWireSchema } from '../../src/continuations/continuation.wire';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { scheduledCheckEnvelope } from '../../src/continuations/scheduled-check.rows';
import { ScheduledCheck } from '../../src/generated/prisma/client';
import { Actor, CHANNEL_BUTTON, CHAT } from '../../src/runs/actor';
import { NOTICED } from '../fixtures/actors';

const SCHEDULED: ScheduledCheck = {
  id: 'check-1',
  discussionId: 'discussion-1',
  notionPageId: 'page-1',
  runAt: new Date('2026-10-08T09:00:00.000Z'),
  reasonCode: 'resolution_reconciliation',
  version: 1,
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

const CLOSING: ContinuationRequest = {
  discussionId: 'discussion-1',
  notionPageId: 'page-1',
  runAt: new Date('2026-10-08T12:00:00.000Z'),
  reasonCode: 'resolution_reconciliation',
};

/**
 * A run in which the person speaks and a run without the person: both are steps that request a
 * continuation.
 */
const PERSON_SPEAKS: Actor = {
  kind: 'run',
  runId: 'run-1',
  mode: 'event_evaluation',
  provenance: { origin: 'managed_discussion_reply' },
  startedAt: new Date('2026-10-08T07:00:00.000Z'),
};

/**
 * Records what reached the queue. A step's request with the closure reason must not get there.
 */
async function serviceOver(
  asked: ContinuationRequest[],
  closed: ContinuationRequest[] = [],
): Promise<ContinuationsService> {
  const checks: Pick<ScheduledCheckRepository, 'schedule' | 'holdsPersonsSnooze' | 'closure'> = {
    schedule: (request) => {
      asked.push(request);

      return Promise.resolve(SCHEDULED);
    },
    holdsPersonsSnooze: () => Promise.resolve(false),
    closure: (request) => {
      closed.push(request);

      return Promise.resolve({ row: SCHEDULED, created: true });
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [ContinuationsService, { provide: ScheduledCheckRepository, useValue: checks }],
  }).compile();

  return moduleRef.get(ContinuationsService);
}

/**
 * `INV-095` Only the App names the reason `resolution_reconciliation`, when it finds a thread it
 * manages resolved: no step that requests a continuation names it, and the wire schema does not
 * offer it. A row with this reason wakes `closure_processing`.
 *
 * The reason turns on a mode that writes to GBrain, so it does not belong to anyone who can be
 * misled by the text of a page or a comment.
 */
describe('INV-095', () => {
  it.each([
    ['a run where the person speaks', PERSON_SPEAKS],
    ['an autonomous run', NOTICED],
    ['chat', CHAT],
    ['a channel button', CHANNEL_BUTTON],
  ])('%s does not name the closure reason: neither the check nor the write', async (_, actor) => {
    const asked: ContinuationRequest[] = [];
    const service = await serviceOver(asked);

    await expect(service.check(actor, CLOSING)).rejects.toThrow(
      'resolution_reconciliation is set by the App',
    );
    await expect(service.schedule(actor, CLOSING)).rejects.toThrow(
      'resolution_reconciliation is set by the App',
    );
    expect(asked).toEqual([]);
  });

  it('the wire schema of the continuation tool does not offer the closure reason', () => {
    const wire = {
      discussion_id: 'discussion-1',
      page_id: 'page-1',
      run_at: '2026-10-08T09:00:00+03:00',
    };

    expect(
      continuationWireSchema.safeParse({ ...wire, reason_code: 'resolution_reconciliation' })
        .success,
    ).toBe(false);
    expect(
      continuationWireSchema.safeParse({ ...wire, reason_code: 'await_external_event' }).success,
    ).toBe(true);
  });

  it('a row with the closure reason wakes closure, and the other reasons wake a recheck', () => {
    expect(scheduledCheckEnvelope(SCHEDULED).mode).toBe('closure_processing');
    expect(scheduledCheckEnvelope({ ...SCHEDULED, reasonCode: 'await_external_event' }).mode).toBe(
      'scheduled_recheck',
    );
  });

  it('a request from the App goes through because it is the only entry that sets the reason', async () => {
    const asked: ContinuationRequest[] = [];
    const closed: ContinuationRequest[] = [];
    const service = await serviceOver(asked, closed);

    await expect(
      service.requestClosure({ discussionId: 'discussion-1', notionPageId: 'page-1' }),
    ).resolves.toBe('requested');
    expect(closed.map((request) => request.reasonCode)).toEqual(['resolution_reconciliation']);
    expect(asked).toEqual([]);
  });
});
