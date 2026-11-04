import { InvalidRequestError } from '../platform/request/invalid-request';
import { ContinuationQuery } from './continuation.schema';
import {
  continuationQueryOf,
  ContinuationQueryWire,
  continuationQueryWireSchema,
  continuationWireSchema,
} from './continuation.wire';

/**
 * A question about the state of continuations from the wire. The wire schema cannot say “exactly
 * one of the two”, so the conversion says it.
 */
describe('question about continuation state from the wire', () => {
  interface Asked {
    readonly asked: string;
    readonly wire: ContinuationQueryWire;
    readonly query: ContinuationQuery;
  }

  const cases: Asked[] = [
    {
      asked: 'thread',
      wire: { discussion_id: 'discussion-1' },
      query: { discussionId: 'discussion-1' },
    },
    // A thread addresses itself: the reason does not narrow it.
    {
      asked: 'thread with a reason',
      wire: { discussion_id: 'discussion-1', reason_code: 'user_snooze' },
      query: { discussionId: 'discussion-1' },
    },
    { asked: 'page', wire: { page_id: 'page-1' }, query: { notionPageId: 'page-1' } },
    {
      asked: 'page with a reason',
      wire: { page_id: 'page-1', reason_code: 'user_snooze' },
      query: { notionPageId: 'page-1', reasonCode: 'user_snooze' },
    },
  ];

  it.each(cases)('$asked', ({ wire, query }) => {
    expect(continuationQueryOf(wire)).toEqual(query);
  });

  /** The model does not see closure: there is nothing to ask about by its reason. */
  it('does not offer the closure reason as an option for the question', () => {
    expect(
      continuationQueryWireSchema.safeParse({
        page_id: 'p',
        reason_code: 'resolution_reconciliation',
      }).success,
    ).toBe(false);
    expect(
      continuationQueryWireSchema.safeParse({ page_id: 'p', reason_code: 'user_snooze' }).success,
    ).toBe(true);
  });

  it('refuses a question with neither a thread nor a page, or with both', () => {
    const unclear: ContinuationQueryWire[] = [{}, { discussion_id: 'd', page_id: 'p' }];

    for (const wire of unclear) {
      expect(() => continuationQueryOf(wire)).toThrow(InvalidRequestError);
    }
  });
});

/**
 * The App names the thread closure reason, not a step that requests a continuation: the wire
 * schema does not even offer it, so the model does not see it among the options.
 */
describe('continuation request from the wire', () => {
  const wire = {
    discussion_id: 'discussion-1',
    page_id: 'page-1',
    run_at: '2026-10-08T09:00:00+03:00',
  };

  it('accepts the reasons a step names', () => {
    for (const reason_code of [
      'await_external_event',
      'user_snooze',
      'safety_recheck',
      'deadline_followup',
    ]) {
      expect(continuationWireSchema.safeParse({ ...wire, reason_code }).success).toBe(true);
    }
  });

  it('does not offer the thread closure reason as an option for a step', () => {
    expect(
      continuationWireSchema.safeParse({ ...wire, reason_code: 'resolution_reconciliation' })
        .success,
    ).toBe(false);
  });
});
