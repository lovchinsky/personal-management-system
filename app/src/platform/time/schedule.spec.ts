import { localDateAt, type LocalDate } from './local-day';
import {
  occurrenceAt,
  occurrenceBefore,
  parseSchedule,
  periodOfKey,
  scheduleProblem,
  type Occurrence,
  type Schedule,
} from './schedule';

const KYIV = 'Europe/Kyiv';

/**
 * Converts an occurrence to a form that is convenient to compare: the key and two instants as
 * strings.
 */
function shown(occurrence: Occurrence | null): {
  key: string;
  at: string;
  closesAt: string;
} | null {
  return occurrence
    ? {
        key: occurrence.key,
        at: occurrence.at.toISOString(),
        closesAt: occurrence.closesAt.toISOString(),
      }
    : null;
}

function at(schedule: string, now: string, zone = KYIV): ReturnType<typeof shown> {
  return shown(occurrenceAt(parseSchedule(schedule), zone, new Date(now)));
}

describe('schedule parsing', () => {
  it.each<[string, Schedule]>([
    ['off', { kind: 'off' }],
    ['daily 08:30', { kind: 'daily', minutes: 510 }],
    ['  weekly   sun 18:00 ', { kind: 'weekly', weekday: 7, minutes: 1080 }],
    ['weekly mon 09:00', { kind: 'weekly', weekday: 1, minutes: 540 }],
    ['monthly 1 10:00', { kind: 'monthly', day: 1, minutes: 600 }],
    ['quarterly 28 00:00', { kind: 'quarterly', day: 28, minutes: 0 }],
  ])('%s', (text, expected) => {
    expect(parseSchedule(text)).toEqual(expected);
  });

  it.each([
    ['', /expected `off`/],
    ['hourly 10:00', /expected `off`/],
    ['daily 8:30', /HH:MM/],
    ['daily 24:00', /HH:MM/],
    ['weekly sunday 18:00', /weekday must be one of/],
    ['monthly 29 10:00', /day of month must be 1–28/],
    ['monthly 0 10:00', /day of month must be 1–28/],
    ['quarterly x 10:00', /day of month must be 1–28/],
  ])('“%s” is rejected with a reason', (text, reason) => {
    expect(() => parseSchedule(text)).toThrow(reason);
    expect(scheduleProblem(text)).toMatch(reason);
  });

  it('a correct schedule has no problem', () => {
    expect(scheduleProblem('daily 08:30')).toBeNull();
  });
});

describe('occurrences of a daily schedule', () => {
  it('after its time of day: the occurrence of this day, with the window to the end of the day', () => {
    expect(at('daily 08:30', '2026-10-14T07:00:00Z')).toEqual({
      key: '2026-10-14',
      at: '2026-10-14T05:30:00.000Z',
      closesAt: '2026-10-14T21:00:00.000Z',
    });
  });

  it('before its time of day: the occurrence of the day before', () => {
    expect(at('daily 08:30', '2026-10-14T05:00:00Z')?.key).toBe('2026-10-13');
  });

  it('changing the time within a day produces no new occurrence', () => {
    expect(at('daily 07:00', '2026-10-14T07:00:00Z')?.key).toBe(
      at('daily 08:30', '2026-10-14T07:00:00Z')?.key,
    );
  });

  /**
   * In Kyiv 03:00–03:59 is skipped in spring, so an occurrence at 03:30 is shifted forward by the
   * length of the transition and stays one per day.
   */
  it('an hour skipped by a transition is shifted forward', () => {
    expect(at('daily 03:30', '2026-03-29T03:00:00Z')).toEqual({
      key: '2026-03-29',
      at: '2026-03-29T01:30:00.000Z',
      closesAt: '2026-03-29T21:00:00.000Z',
    });
  });

  /**
   * In autumn 03:00–03:59 occurs twice. The occurrence is taken at the first one, and a second
   * never occurs.
   */
  it('an hour doubled by a transition produces one occurrence, the first', () => {
    const first = at('daily 03:30', '2026-10-25T00:45:00Z');
    const second = at('daily 03:30', '2026-10-25T01:45:00Z');

    expect(first).toEqual({
      key: '2026-10-25',
      at: '2026-10-25T00:30:00.000Z',
      closesAt: '2026-10-25T22:00:00.000Z',
    });
    expect(second).toEqual(first);
  });

  it('the preceding occurrence is that of the day before', () => {
    const schedule = parseSchedule('daily 08:30');
    const current = occurrenceAt(schedule, KYIV, new Date('2026-10-14T07:00:00Z'));

    expect(current).not.toBeNull();
    expect(shown(current && occurrenceBefore(schedule, KYIV, current))?.key).toBe('2026-10-13');
  });
});

describe('occurrences of a weekly schedule', () => {
  it('in mid-week: the most recent Sunday, with the window to the next one', () => {
    expect(at('weekly sun 18:00', '2026-10-14T07:00:00Z')).toEqual({
      key: '2026-W41',
      at: '2026-10-11T15:00:00.000Z',
      closesAt: '2026-10-18T15:00:00.000Z',
    });
  });

  it('on its own day before its time: the occurrence of last week', () => {
    expect(at('weekly sun 18:00', '2026-10-18T07:00:00Z')?.key).toBe('2026-W41');
    expect(at('weekly sun 18:00', '2026-10-18T16:00:00Z')?.key).toBe('2026-W42');
  });

  it.each([
    ['Monday, December 29, 2025: the first week of 2026', '2025-12-29T10:00:00Z', '2026-W01'],
    ['Monday, December 28, 2026: the fifty-third week of 2026', '2026-12-30T12:00:00Z', '2026-W53'],
    ['Monday, January 4, 2027: the first week of 2027', '2027-01-04T10:00:00Z', '2027-W01'],
  ])('the key is the ISO week: %s', (_name, now, key) => {
    expect(at('weekly mon 09:00', now)?.key).toBe(key);
  });
});

describe('occurrences of a monthly and a quarterly schedule', () => {
  it('month: the occurrence on the 1st, with the window to the 1st of the next month', () => {
    expect(at('monthly 1 10:00', '2026-10-14T07:00:00Z')).toEqual({
      key: '2026-10',
      at: '2026-10-01T07:00:00.000Z',
      closesAt: '2026-11-01T08:00:00.000Z',
    });
  });

  it('month: before its time on the 1st, last month', () => {
    expect(at('monthly 1 10:00', '2026-10-01T05:00:00Z')?.key).toBe('2026-09');
  });

  it('quarter: the first month of the quarter, with the window to the next quarter', () => {
    expect(at('quarterly 1 10:00', '2026-11-20T10:00:00Z')).toEqual({
      key: '2026-Q4',
      at: '2026-10-01T07:00:00.000Z',
      closesAt: '2027-01-01T08:00:00.000Z',
    });
  });

  it('quarter: before its time, the preceding quarter, in the year before', () => {
    expect(at('quarterly 1 10:00', '2026-01-01T07:00:00Z')?.key).toBe('2025-Q4');
  });
});

describe('a schedule that is off', () => {
  it('has no occurrences', () => {
    expect(at('off', '2026-10-14T07:00:00Z')).toBeNull();
  });
});

describe('schedule zone', () => {
  it('UTC stays UTC', () => {
    expect(at('daily 08:30', '2026-10-14T09:00:00Z', 'UTC')?.at).toBe('2026-10-14T08:30:00.000Z');
  });
});

/** Checks whether the key's period contains the local day on which the occurrence fell. */
function covers(occurrence: Occurrence): boolean {
  const day = localDateAt(KYIV, occurrence.at);
  const period = periodOfKey(occurrence.key);
  const ordinal = (date: LocalDate): number => date.year * 10_000 + date.month * 100 + date.day;

  switch (period.kind) {
    case 'daily':
      return ordinal(period.date) === ordinal(day);
    case 'weekly':
      return ordinal(period.first) <= ordinal(day) && ordinal(day) <= ordinal(period.last);
    case 'monthly':
      return period.year === day.year && period.month === day.month;
    case 'quarterly':
      return period.year === day.year && period.quarter === Math.floor((day.month - 1) / 3) + 1;
  }
}

describe('period by occurrence key', () => {
  it('a day, a month and a quarter are read from the key', () => {
    expect(periodOfKey('2026-10-22')).toEqual({
      kind: 'daily',
      date: { year: 2026, month: 10, day: 22 },
    });
    expect(periodOfKey('2026-10')).toEqual({ kind: 'monthly', year: 2026, month: 10 });
    expect(periodOfKey('2026-Q4')).toEqual({ kind: 'quarterly', year: 2026, quarter: 4 });
  });

  it('a week runs from Monday to Sunday, at the year boundary too', () => {
    expect(periodOfKey('2026-W43')).toEqual({
      kind: 'weekly',
      first: { year: 2026, month: 10, day: 19 },
      last: { year: 2026, month: 10, day: 25 },
    });
    // 2026 begins on a Thursday, so it has 53 weeks; the first week of 2027 starts on January 4.
    expect(periodOfKey('2026-W53')).toMatchObject({
      first: { year: 2026, month: 12, day: 28 },
      last: { year: 2027, month: 1, day: 3 },
    });
    expect(periodOfKey('2027-W01')).toMatchObject({ first: { year: 2027, month: 1, day: 4 } });
  });

  /**
   * The key comes from the schedule, so reading it back must point to the week that ends on the
   * occurrence's Sunday.
   */
  it('the Sunday of a weekly occurrence is the last day of the week of its key', () => {
    const keys = ['2026-10-25T16:00:00Z', '2026-12-31T16:00:00Z', '2027-01-03T16:00:00Z'].map(
      (now) => at('weekly sun 18:00', now)?.key ?? '',
    );

    expect(keys.map(periodOfKey)).toEqual([
      expect.objectContaining({ last: { year: 2026, month: 10, day: 25 } }),
      expect.objectContaining({ last: { year: 2026, month: 12, day: 27 } }),
      expect.objectContaining({ last: { year: 2027, month: 1, day: 3 } }),
    ]);
  });

  it('a non-key is an error, not an invented period', () => {
    expect(() => periodOfKey('2026-13-W1')).toThrow('not an occurrence key');
    expect(() => periodOfKey('2026-13')).toThrow('not an occurrence key');
    expect(() => periodOfKey('2026-W54')).toThrow('not an occurrence key');
    expect(() => periodOfKey('2026-02-31')).toThrow('not an occurrence key');
    expect(() => periodOfKey('2025-W53')).toThrow('not an occurrence key');
  });

  /**
   * The key comes from the schedule: reading a key back, for each kind, must yield a period that
   * contains the day of the occurrence itself.
   */
  it.each(['daily 08:30', 'weekly sun 18:00', 'monthly 1 10:00', 'quarterly 1 10:00'])(
    '%s: the day of the occurrence belongs to the period of its key',
    (text) => {
      const moments = ['2026-01-01T12:00:00Z', '2026-10-25T16:00:00Z', '2027-01-03T16:00:00Z'];
      const outside = moments.flatMap((now) => {
        const occurrence = occurrenceAt(parseSchedule(text), KYIV, new Date(now));

        return occurrence === null ? [] : [occurrence].filter((one) => !covers(one));
      });

      expect(outside).toEqual([]);
    },
  );
});
