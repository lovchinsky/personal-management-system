import {
  CanonicalWrite,
  canonicalWriteSchema,
  confirmsWrite,
  MAX_WRITTEN_LINKS,
  readsAs,
} from './canonical-write';
import { Read, Reading } from './reading';

const parse = (request: unknown): CanonicalWrite => canonicalWriteSchema.parse(request);

describe('the canonical value of a write', () => {
  const rejected: [string, unknown][] = [
    ['whitespace-only text', { kind: 'text', text: '   ' }],
    ['an instant without a time zone', { kind: 'date', start: '2026-10-01T10:00:00' }],
    ['a non-date value', { kind: 'date', start: 'завтра' }],
    ['the same page twice', { kind: 'links', pageIds: ['a', 'a'] }],
    [
      'a list of relations above the limit',
      { kind: 'links', pageIds: Array.from({ length: MAX_WRITTEN_LINKS + 1 }, (_, i) => `p${i}`) },
    ],
    ['an extra field', { kind: 'clear', value: null }],
    ['an unknown kind', { kind: 'number', number: 1 }],
  ];

  it.each(rejected)('%s is refused', (_, request) => {
    expect(canonicalWriteSchema.safeParse(request).success).toBe(false);
  });

  it('page ids in relations are in one form', () => {
    const expected: CanonicalWrite = {
      kind: 'links',
      pageIds: ['1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b'],
    };

    expect(parse({ kind: 'links', pageIds: ['1F2E3D4C5B6A49788A9B0C1D2E3F4A5B'] })).toEqual(
      expected,
    );
  });

  describe('read as written', () => {
    const date = (start: string, end: string | null = null): Reading =>
      Read.value({ type: 'date', start, end, timeZone: null });

    it('an instant is compared by time, not by spelling', () => {
      const written = parse({ kind: 'date', start: '2026-10-01T10:00:00+03:00' });

      expect(readsAs(written, date('2026-10-01T07:00:00.000Z'))).toBe(true);
      expect(readsAs(written, date('2026-10-01T08:00:00.000Z'))).toBe(false);
    });

    /**
     * State is read by meaning. The system's own write also requires no time zone: the system
     * writes no time zones, so a time zone in the answer to a write is a discrepancy, while in a
     * state it is an annotation.
     */
    describe('the time zone of a date', () => {
      const zoned = (start: string, timeZone: string): Reading =>
        Read.value({ type: 'date', start, end: null, timeZone });
      const written = parse({ kind: 'date', start: '2026-10-01T10:00:00+03:00' });

      it('for a date with an offset, the state reads as named but the write is not confirmed', () => {
        const reading = zoned('2026-10-01T10:00:00.000+03:00', 'Europe/Kyiv');

        expect(readsAs(written, reading)).toBe(true);
        expect(confirmsWrite(written, reading)).toBe(false);
      });

      it('without a time zone, the state reads as named and the write is confirmed', () => {
        const reading = zoned('2026-10-01T07:00:00.000Z', 'Europe/Kyiv');
        const plain = Read.value({
          type: 'date',
          start: '2026-10-01T07:00:00.000Z',
          end: null,
          timeZone: null,
        });

        expect(readsAs(written, reading)).toBe(true);
        expect(readsAs(written, plain)).toBe(true);
        expect(confirmsWrite(written, plain)).toBe(true);
      });

      /**
       * An instant without an offset, read by the host's clock, would yield this very instant, so
       * deriving it from the same reading makes the check sensitive to any time zone of the
       * machine.
       */
      it('an instant without an offset equals nothing, not even what the host clock would yield', () => {
        const local = '2026-10-01T10:00:00';
        const hostReading = parse({ kind: 'date', start: new Date(local).toISOString() });
        const reading = zoned(local, 'Europe/Kyiv');

        expect(readsAs(hostReading, reading)).toBe(false);
        expect(confirmsWrite(hostReading, reading)).toBe(false);
      });

      it('a different instant with a time zone is not the same', () => {
        const reading = zoned('2026-10-01T11:00:00.000+03:00', 'Europe/Kyiv');

        expect(readsAs(written, reading)).toBe(false);
      });

      it('for a date without a time, a time zone does not affect the state but the write is not confirmed', () => {
        const day = parse({ kind: 'date', start: '2026-10-01' });

        expect(readsAs(day, zoned('2026-10-01', 'Europe/Kyiv'))).toBe(true);
        expect(confirmsWrite(day, zoned('2026-10-01', 'Europe/Kyiv'))).toBe(false);
      });
    });

    it('a date and an instant of the same day are not the same', () => {
      const written = parse({ kind: 'date', start: '2026-10-01' });

      expect(readsAs(written, date('2026-10-01'))).toBe(true);
      expect(readsAs(written, date('2026-10-01T00:00:00.000Z'))).toBe(false);
    });

    it('the end of the interval is checked too', () => {
      const written = parse({ kind: 'date', start: '2026-10-01', end: '2026-10-03' });

      expect(readsAs(written, date('2026-10-01', '2026-10-03'))).toBe(true);
      expect(readsAs(written, date('2026-10-01'))).toBe(false);
    });

    it('relations are compared as a set, and a truncated list confirms nothing', () => {
      const written = parse({ kind: 'links', pageIds: ['a', 'b'] });
      const links = (pageIds: string[], truncated = false): Reading =>
        Read.value({ type: 'links', pageIds, truncated });

      expect(readsAs(written, links(['b', 'a']))).toBe(true);
      expect(readsAs(written, links(['a']))).toBe(false);
      expect(readsAs(written, links(['a', 'b'], true))).toBe(false);
    });

    it('a cleared property reads as empty, and for relations as an empty list', () => {
      const cleared = parse({ kind: 'clear' });

      expect(readsAs(cleared, Read.empty())).toBe(true);
      expect(readsAs(cleared, Read.value({ type: 'links', pageIds: [], truncated: false }))).toBe(
        true,
      );
      expect(readsAs(cleared, Read.value({ type: 'text', text: 'x' }))).toBe(false);
    });
  });
});
