import {
  instantOfLocalDate,
  instantOfLocalTime,
  isKnownTimeZone,
  localDateAt,
  startOfLocalDay,
  startOfNextLocalDay,
  wallClock,
  type LocalDate,
} from './local-day';

const KYIV = 'Europe/Kyiv';

describe('local day boundaries', () => {
  it('in winter the Kyiv day starts at 22:00 UTC on the day before', () => {
    const at = new Date('2026-01-15T10:00:00Z');

    expect(startOfLocalDay(KYIV, at).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });

  it('in summer it starts at 21:00 UTC', () => {
    const at = new Date('2026-07-01T10:00:00Z');

    expect(startOfLocalDay(KYIV, at).toISOString()).toBe('2026-06-30T21:00:00.000Z');
  });

  /**
   * The day of the switch to summer time: at the time of the call the offset is +3, and at
   * midnight of the same day it was +2. An offset taken once would be an hour off.
   */
  it('on the day of the switch to summer time the offset is read again', () => {
    const at = new Date('2026-03-29T12:00:00Z');

    expect(startOfLocalDay(KYIV, at).toISOString()).toBe('2026-03-28T22:00:00.000Z');
  });

  it('likewise on the day of the switch to winter time', () => {
    const at = new Date('2026-10-25T12:00:00Z');

    expect(startOfLocalDay(KYIV, at).toISOString()).toBe('2026-10-24T21:00:00.000Z');
  });

  it('an instant before local midnight belongs to the day before', () => {
    const before = new Date('2026-01-14T21:59:59Z');
    const after = new Date('2026-01-14T22:00:00Z');

    expect(startOfLocalDay(KYIV, before).toISOString()).toBe('2026-01-13T22:00:00.000Z');
    expect(startOfLocalDay(KYIV, after).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });

  it('midnight corresponds to hour zero, not hour twenty-four', () => {
    expect(wallClock(KYIV, new Date('2026-01-14T22:00:00Z')).hour).toBe(0);
  });

  it('UTC stays UTC', () => {
    expect(startOfLocalDay('UTC', new Date('2026-01-15T10:00:00Z')).toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  /**
   * An instant from `new Date()` has milliseconds. They do not belong to a day boundary, and a
   * boundary that inherited them would leave a random fraction of a second in `silent_until` and in
   * the daily limit.
   */
  it('the milliseconds of an instant do not end up in the day boundary', () => {
    const at = new Date('2026-01-15T10:00:00.437Z');

    expect(startOfLocalDay(KYIV, at).toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(startOfNextLocalDay(KYIV, at).toISOString()).toBe('2026-01-15T22:00:00.000Z');
    expect(instantOfLocalTime(KYIV, at, 480).toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });

  /**
   * The next day is the next calendar date, however many hours the current one lasts: 23 and 25 in
   * Kyiv on transition days, 26 in Antarctica/Troll, where the clock falls back two hours. The
   * export is tested, not a copy of it, because both the run gate for the daily limit and the quiet
   * hours need the function itself.
   */
  describe('start of the next local day', () => {
    it.each([
      ['winter', KYIV, '2026-01-15T10:00:00Z'],
      ['summer', KYIV, '2026-07-01T10:00:00Z'],
      ['the day of the switch to summer time, 23 hours', KYIV, '2026-03-29T12:00:00Z'],
      ['the day of the switch to winter time, 25 hours', KYIV, '2026-10-25T12:00:00Z'],
      ['a day 26 hours long', 'Antarctica/Troll', '2026-10-25T10:00:00Z'],
      ['a day with a repeated hour at midnight', 'Asia/Beirut', '2026-10-24T20:30:00Z'],
      ['late evening', KYIV, '2026-01-15T21:59:00Z'],
      ['right after local midnight', KYIV, '2026-01-14T22:01:00Z'],
      ['a zone with a fractional offset', 'Asia/Kathmandu', '2026-01-15T10:00:00Z'],
    ])('%s: the next midnight, exactly one calendar day later', (_case, timeZone, iso) => {
      const at = new Date(iso);
      const next = startOfNextLocalDay(timeZone, at);
      const wall = wallClock(timeZone, next);
      const today = wallClock(timeZone, startOfLocalDay(timeZone, at));

      expect({ hour: wall.hour, minute: wall.minute }).toEqual({ hour: 0, minute: 0 });
      expect(next.getTime()).toBeGreaterThan(at.getTime());

      const oneDayLater = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));

      expect([wall.year, wall.month, wall.day]).toEqual([
        oneDayLater.getUTCFullYear(),
        oneDayLater.getUTCMonth() + 1,
        oneDayLater.getUTCDate(),
      ]);
    });
  });

  /**
   * Where a transition skips midnight (Havana, Santiago: 00:00 → 01:00), the day begins at the
   * first instant that really exists, not at a midnight that does not. The same applies to the next
   * day, which begins at the first instant that exists.
   */
  describe('a day that does not begin at midnight', () => {
    it.each([
      ['Havana', 'America/Havana', '2026-03-08T12:00:00Z', '2026-03-08T05:00:00.000Z'],
      ['Santiago', 'America/Santiago', '2026-09-06T12:00:00Z', '2026-09-06T04:00:00.000Z'],
    ])('%s: the day begins at the first instant that exists', (_zone, timeZone, iso, start) => {
      expect(startOfLocalDay(timeZone, new Date(iso)).toISOString()).toBe(start);
      expect(wallClock(timeZone, new Date(start)).hour).toBe(1);
    });

    it('the day after the one preceding such a transition begins at the first instant that exists', () => {
      const evening = new Date('2026-03-08T03:30:00Z');

      expect(startOfNextLocalDay('America/Havana', evening).toISOString()).toBe(
        '2026-03-08T05:00:00.000Z',
      );
    });

    /**
     * Where a transition sets the clock back from midnight to 23:00, that hour repeats and the day
     * does not change.
     */
    it('a repeated hour at midnight stays in the same day', () => {
      const repeated = new Date('2026-10-24T21:30:00Z');

      expect(wallClock('Asia/Beirut', repeated).hour).toBe(23);
      expect(startOfLocalDay('Asia/Beirut', repeated).toISOString()).toBe(
        '2026-10-23T21:00:00.000Z',
      );
      expect(startOfNextLocalDay('Asia/Beirut', repeated).toISOString()).toBe(
        '2026-10-24T22:00:00.000Z',
      );
    });
  });

  describe('time of day', () => {
    it.each([
      ['winter', '2026-01-15T10:00:00Z', 480, '2026-01-15T06:00:00.000Z'],
      ['summer', '2026-07-01T10:00:00Z', 480, '2026-07-01T05:00:00.000Z'],
      [
        'the day of the switch to summer time: the morning is already at +3',
        '2026-03-29T12:00:00Z',
        480,
        '2026-03-29T05:00:00.000Z',
      ],
      [
        'the day of the switch to winter time: the morning is already at +2',
        '2026-10-25T12:00:00Z',
        480,
        '2026-10-25T06:00:00.000Z',
      ],
      ['midnight', '2026-01-15T10:00:00Z', 0, '2026-01-14T22:00:00.000Z'],
    ])('%s', (_case, iso, minutes, expected) => {
      expect(instantOfLocalTime(KYIV, new Date(iso), minutes).toISOString()).toBe(expected);
    });

    /**
     * 03:30 on March 29 does not exist in Kyiv: the clock jumps from 03:00 straight to 04:00. A
     * skipped time is shifted forward by the length of the transition — to 04:30 — not into the
     * past.
     */
    it('a skipped clock time is shifted forward by the length of the transition', () => {
      const moment = instantOfLocalTime(KYIV, new Date('2026-03-29T12:00:00Z'), 210);

      expect(moment.toISOString()).toBe('2026-03-29T01:30:00.000Z');
      expect(wallClock(KYIV, moment)).toMatchObject({ hour: 4, minute: 30 });
    });

    /** 03:30 on October 25 occurs twice: the first one is taken. */
    it('a doubled clock time is taken first', () => {
      const moment = instantOfLocalTime(KYIV, new Date('2026-10-25T12:00:00Z'), 210);

      expect(moment.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    });
  });

  it('an unknown zone is recognized as unknown', () => {
    expect(isKnownTimeZone(KYIV)).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('instant of a local date', () => {
  it('a day beyond the end of the month is carried over by the calendar', () => {
    expect(instantOfLocalDate(KYIV, { year: 2026, month: 1, day: 32 }, 0).toISOString()).toBe(
      '2026-01-31T22:00:00.000Z',
    );
  });

  it('an hour skipped by a transition is shifted forward, as within a day', () => {
    expect(instantOfLocalDate(KYIV, { year: 2026, month: 3, day: 29 }, 210).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it("the date is the one the zone's clock shows, not UTC", () => {
    const expected: LocalDate = { year: 2026, month: 1, day: 15 };

    expect(localDateAt(KYIV, new Date('2026-01-14T22:30:00Z'))).toEqual(expected);
  });
});
