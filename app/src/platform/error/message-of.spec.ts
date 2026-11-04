import { messageOf, stackOf } from './message-of';

describe('the text of an exception', () => {
  it('an Error returns its own message', () => {
    expect(messageOf(new Error('boom'))).toBe('boom');
  });

  it('a thrown non-Error becomes a string', () => {
    expect(messageOf('boom')).toBe('boom');
    expect(messageOf(42)).toBe('42');
  });

  it('only an Error has a stack', () => {
    expect(stackOf(new Error('boom'))).toContain('boom');
    expect(stackOf('boom')).toBeUndefined();
  });
});
