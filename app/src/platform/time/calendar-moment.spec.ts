import { momentOfCalendarValue, type CalendarValue, type DayEdge } from './calendar-moment';

const KYIV = 'Europe/Kyiv';

function moment(start: string, edge: DayEdge, timeZone: string | null = null): string | null {
  const value: CalendarValue = { start, timeZone };

  return momentOfCalendarValue(value, KYIV, edge)?.toISOString() ?? null;
}

describe('instant of a calendar value', () => {
  it('a day with no time: the start is midnight of its day in the installation zone', () => {
    expect(moment('2026-10-20', 'start')).toBe('2026-10-19T21:00:00.000Z');
  });

  it('a day with no time: the end is midnight of the next day', () => {
    expect(moment('2026-10-20', 'end')).toBe('2026-10-20T21:00:00.000Z');
  });

  /**
   * The day of the switch to summer time is shorter: the end of the day already uses the new
   * offset.
   */
  it('the day of a clock change', () => {
    expect(moment('2026-03-29', 'start')).toBe('2026-03-28T22:00:00.000Z');
    expect(moment('2026-03-29', 'end')).toBe('2026-03-29T21:00:00.000Z');
  });

  it('an instant with an offset is that instant; the day edge and the zone do not matter', () => {
    expect(moment('2026-10-20T14:00:00.000+03:00', 'end')).toBe('2026-10-20T11:00:00.000Z');
    expect(moment('2026-10-20T11:00:00.000Z', 'start')).toBe('2026-10-20T11:00:00.000Z');
  });

  it("a local time without an offset is read in the value's time zone", () => {
    expect(moment('2026-10-20T09:00:00.000', 'start', 'America/New_York')).toBe(
      '2026-10-20T13:00:00.000Z',
    );
  });

  it('a local time with neither offset nor time zone is read in the installation zone', () => {
    expect(moment('2026-10-20T09:00', 'start')).toBe('2026-10-20T06:00:00.000Z');
  });

  it.each([
    ['a string that is not a date', 'наступного тижня', null],
    ['a value with an unknown time zone', '2026-10-20T09:00:00', 'Mars/Olympus'],
  ])('%s cannot be placed in time', (_name, start, timeZone) => {
    expect(moment(start, 'start', timeZone)).toBeNull();
  });
});
