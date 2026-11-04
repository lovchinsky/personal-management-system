import { instantOfLocalDate, isKnownTimeZone } from './local-day';

/**
 * A calendar value as a date holds it: a day (`2026-10-20`), an instant with an offset
 * (`2026-10-20T14:00:00.000+03:00`) or a local time without an offset together with the date's own
 * time zone.
 */
export interface CalendarValue {
  readonly start: string;
  readonly timeZone: string | null;
}

/**
 * Which edge of the day is needed when the value is a day with no time: a check date comes due at
 * the start of its day, a deadline passes at the end of its own day
 * (`docs/2-system.md` § “Schedule and recurrence”).
 */
export type DayEdge = 'start' | 'end';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * Returns the instant of a calendar value. A day with no time is midnight of its day in the
 * installation's zone (`end` is midnight of the next day). An instant with an offset is that
 * instant itself. A local time without an offset is read in the value's time zone, or in the
 * installation's zone when it has none. A string of another form or an unknown time zone yields
 * `null`: the value cannot be placed in time, and the rule that asks about it asserts nothing.
 */
export function momentOfCalendarValue(
  value: CalendarValue,
  installationZone: string,
  edge: DayEdge,
): Date | null {
  const day = DAY.exec(value.start);
  if (day) {
    const date = { year: Number(day[1]), month: Number(day[2]), day: Number(day[3]) };

    return instantOfLocalDate(
      installationZone,
      edge === 'start' ? date : { ...date, day: date.day + 1 },
      0,
    );
  }

  if (WITH_OFFSET.test(value.start)) {
    const at = new Date(value.start);

    return Number.isNaN(at.getTime()) ? null : at;
  }

  const local = LOCAL.exec(value.start);
  if (!local) return null;

  const zone = value.timeZone ?? installationZone;
  if (!isKnownTimeZone(zone)) return null;

  const at = instantOfLocalDate(
    zone,
    { year: Number(local[1]), month: Number(local[2]), day: Number(local[3]) },
    Number(local[4]) * 60 + Number(local[5]),
  );

  return new Date(at.getTime() + Number(local[6] ?? 0) * 1000);
}
