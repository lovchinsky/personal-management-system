import { sameContinuation } from './continuation-identity';

const wake = {
  discussionId: 'thread-1',
  notionPageId: 'page-1',
  reasonCode: 'user_snooze',
} as const;
const closure = {
  discussionId: 'thread-1',
  notionPageId: 'page-1',
  reasonCode: 'resolution_reconciliation',
} as const;

/**
 * A thread addresses itself within its class (`ADR 0028`): the wake and the closure of one thread
 * are different continuations, and without a thread the page and the reason tell continuations
 * apart.
 */
describe('continuation identity', () => {
  it('treats two wakes of one thread as the same continuation, whatever caused them', () => {
    expect(sameContinuation(wake, { ...wake, reasonCode: 'deadline_followup' })).toBe(true);
  });

  it('treats a wake and a closure of one thread as different continuations', () => {
    expect(sameContinuation(wake, closure)).toBe(false);
    expect(sameContinuation(closure, wake)).toBe(false);
  });

  it('treats continuations of different threads as different', () => {
    expect(sameContinuation(wake, { ...wake, discussionId: 'thread-2' })).toBe(false);
  });

  it('tells continuations without a thread apart by page and reason', () => {
    const page = { notionPageId: 'page-1', reasonCode: 'safety_recheck' } as const;

    expect(sameContinuation(page, { ...page })).toBe(true);
    expect(sameContinuation(page, { ...page, reasonCode: 'await_external_event' })).toBe(false);
    expect(sameContinuation(page, { ...page, notionPageId: 'page-2' })).toBe(false);
    expect(sameContinuation(page, wake)).toBe(false);
  });
});
