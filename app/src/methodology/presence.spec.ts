import type { Reading } from '../notion/semantics/reading';
import { dateKindOf, presenceOf } from './presence';

const date = (start: string): Reading => ({
  state: 'value',
  value: { type: 'date', start, end: null, timeZone: null },
});

const gap: Reading = {
  state: 'gap',
  gap: { kind: 'schema_gap', slot: 'task.date', value: 'odd' },
};

/**
 * An optional field: `empty` means “none”, a value of the needed shape means “present”, and
 * anything else asserts nothing. Rules do not write their own checks for this; they go through
 * `presenceOf`.
 */
describe('presence of an optional field', () => {
  it('a value of the needed shape means the field is present', () => {
    expect(presenceOf(date('2026-10-20'), 'date')).toEqual({ state: 'present' });
  });

  it('an empty field is “none”: the carrier exists and holds nothing', () => {
    expect(presenceOf({ state: 'empty' }, 'date')).toEqual({ state: 'none' });
  });

  /** The property does not prove that the slot has the shape the consumer needs. */
  it('a value of the wrong shape is a `gap`, not “present”', () => {
    expect(presenceOf({ state: 'value', value: { type: 'text', text: 'x' } }, 'date')).toEqual({
      state: 'undetermined',
      because: 'gap',
    });
  });

  it.each([
    ['unread', { state: 'unread', carrier: 'x' }],
    ['absent', { state: 'absent', reason: 'no carrier' }],
    ['non_canonical', { state: 'non_canonical', value: 'Hidden' }],
    ['gap', gap],
  ] as const)('%s asserts nothing: it is not “none”', (because, reading) => {
    expect(presenceOf(reading, 'date')).toEqual({ state: 'undetermined', because });
  });
});

describe('date: `day` or `timed`', () => {
  it('a date without a time of day is a `day`', () => {
    expect(dateKindOf(date('2026-10-20'))).toEqual({ state: 'day' });
  });

  it.each(['2026-10-20T14:00:00.000+03:00', '2026-10-20T14:00:00Z'])(
    'a date with a time of day (%s) is `timed`',
    (start) => {
      expect(dateKindOf(date(start))).toEqual({ state: 'timed' });
    },
  );

  it('an `empty` date is `none`; an `unread` one or one of the wrong shape is not an answer', () => {
    expect(dateKindOf({ state: 'empty' })).toEqual({ state: 'none' });
    expect(dateKindOf({ state: 'unread', carrier: 'x' })).toEqual({
      state: 'undetermined',
      because: 'unread',
    });
    expect(dateKindOf({ state: 'value', value: { type: 'text', text: 'x' } })).toEqual({
      state: 'undetermined',
      because: 'gap',
    });
  });
});
