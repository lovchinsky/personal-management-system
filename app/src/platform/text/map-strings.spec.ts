import { mapStrings } from './map-strings';

describe('mapStrings', () => {
  const upper = (text: string): string => text.toUpperCase();

  it('changes the text at every level: in fields, lists and nested objects', () => {
    expect(mapStrings({ a: 'x', list: ['y', { deep: 'z' }], nested: { b: 'w' } }, upper)).toEqual({
      a: 'X',
      list: ['Y', { deep: 'Z' }],
      nested: { b: 'W' },
    });
  });

  it('leaves numbers, booleans and `null` as they are, and does not mutate the input', () => {
    const input = { n: 1, ok: true, nothing: null, text: 'a' };

    expect(mapStrings(input, upper)).toEqual({ n: 1, ok: true, nothing: null, text: 'A' });
    expect(input.text).toBe('a');
  });
});
