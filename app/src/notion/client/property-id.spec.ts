import { changedByDecoding, propertyIdFromBinding, propertyIdFromNotion } from './property-id';

/** Pairs “as Notion writes it → canonical form”: IDs with special characters. */
const PAIRS: [string, string][] = [
  ['aGCp', 'aGCp'],
  ['HZN%60', 'HZN`'],
  ['%7DEmk', '}Emk'],
  ['o%7B%40c', 'o{@c'],
  ['z%3B%3EH', 'z;>H'],
  ['K%7BhG', 'K{hG'],
  ['_%3Aq%3F', '_:q?'],
];

describe('a property ID from the binding', () => {
  it.each(PAIRS)('%s → %s', (spelled, canonical) => {
    expect(propertyIdFromBinding(spelled)).toBe(canonical);
  });

  /** A malformed sequence in the file is the file's error, and the binding must report it. */
  it('a malformed sequence is not an ID', () => {
    expect(propertyIdFromBinding('%zz')).toBeNull();
  });
});

describe('a property ID from Notion', () => {
  it.each(PAIRS)('%s → %s', (wire, canonical) => {
    expect(propertyIdFromNotion(wire)).toBe(canonical);
  });

  /** An exception here would be a 500 on the webhook or an endless retry of the action. */
  it('a malformed sequence leaves the string as it is and does not fail', () => {
    expect(propertyIdFromNotion('%zz')).toBe('%zz');
    expect(propertyIdFromNotion('100%done')).toBe('100%done');
  });

  it('an ID without special characters stays the same', () => {
    expect(propertyIdFromNotion('TZZi')).toBe('TZZi');
  });
});

/**
 * Decoding is not idempotent: an ID that still has a `%` after decoding would break on a second
 * pass. So the compiler does not allow converting a canonical ID a second time.
 */
describe('a canonical property ID', () => {
  it('is not decoded a second time: the type asserts it', () => {
    const once = propertyIdFromNotion('x%252F');

    expect(once).toBe('x%2F');

    const again = (): string =>
      // @ts-expect-error — no converter from the raw form accepts a canonical ID.
      propertyIdFromNotion(once);

    // On purpose: that is what would happen without the type brand.
    expect(again()).toBe('x/');
  });

  it('the binding and Notion agree on one ID', () => {
    expect(propertyIdFromBinding('K%7BhG')).toBe(propertyIdFromNotion('K%7BhG'));
  });

  it('resemblance to an encoded ID is visible before conversion', () => {
    const changed: boolean[] = ['K%7BhG', 'K{hG', '100%done', '%zz'].map(changedByDecoding);

    expect(changed).toEqual([true, false, false, false]);
  });
});
