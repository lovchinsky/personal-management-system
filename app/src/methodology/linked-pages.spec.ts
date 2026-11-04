import type { Reading } from '../notion/semantics/reading';
import { linkedPageIds } from './linked-pages';

const links = (pageIds: readonly string[], truncated = false): Reading => ({
  state: 'value',
  value: { type: 'links', pageIds, truncated },
});

/**
 * The list of pages from a relation: an empty relation means “nothing there”, and anything that
 * was not read is not an answer. Whether the rules over relations (dependencies, a Task's
 * Project, a Project's Tasks) can say “none” depends on this.
 */
describe('pages from a relation', () => {
  it('a list that was read is returned as it is, in relation order', () => {
    expect(linkedPageIds(links(['b', 'a']))).toEqual(['b', 'a']);
  });

  it('an empty relation is a list with no elements: the carrier exists, there are no links', () => {
    expect(linkedPageIds({ state: 'empty' })).toEqual([]);
  });

  it('a truncated list is not taken as complete', () => {
    expect(linkedPageIds(links(['a'], true))).toEqual({
      state: 'undetermined',
      because: 'truncated',
    });
  });

  it('a value of the wrong shape is a `gap`: the length of such a list says nothing', () => {
    expect(linkedPageIds({ state: 'value', value: { type: 'text', text: 'a' } })).toEqual({
      state: 'undetermined',
      because: 'gap',
    });
  });

  const unreadable: [Reading['state'], Reading][] = [
    ['unread', { state: 'unread', carrier: 'x' }],
    ['absent', { state: 'absent', reason: 'no carrier' }],
    ['non_canonical', { state: 'non_canonical', value: 'Hidden' }],
    ['gap', { state: 'gap', gap: { kind: 'schema_gap', slot: 'task.project', value: 'odd' } }],
  ];

  it.each(unreadable)('%s is not a list', (because, reading) => {
    expect(linkedPageIds(reading)).toEqual({ state: 'undetermined', because });
  });
});
