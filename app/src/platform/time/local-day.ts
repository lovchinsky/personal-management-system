import { addHours, subHours } from 'date-fns';

/**
 * Boundaries of the local day.
 *
 * They are needed because, without a zone, a “daily limit of runs” has no boundary: a day has to
 * start somewhere. The zone comes from the installation's configuration, not from the machine,
 * because the container runs in UTC and relying on its locale would count the day somewhere other
 * than where the person lives.
 *
 * No third-party library is used: `Intl` already includes tzdata. The machine's clock is not read
 * here at all, so the answer is the same on a developer's machine and in the container.
 */

const FORMATS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATS.get(timeZone);
  if (cached) {
    return cached;
  }

  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  FORMATS.set(timeZone, created);

  return created;
}

export interface Wall {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Returns what the zone's wall clock shows at the instant `at`. */
export function wallClock(timeZone: string, at: Date): Wall {
  const parts = new Map(
    formatter(timeZone)
      .formatToParts(at)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.get(type);
    if (value === undefined) {
      throw new Error(`time zone ${timeZone} gave no ${type}`);
    }

    return value;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Returns what the zone's clock shows at the instant `at`, in milliseconds as if it were UTC. */
function wallTime(timeZone: string, at: Date): number {
  const wall = wallClock(timeZone, at);

  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/**
 * Returns the instant at which the zone's clock shows `minutes` minutes into the day that is `days`
 * days from the day of `at`.
 *
 * The offset is taken a day before and a day after: if a transition falls between them, one of the
 * two is the correct one. A time the transition skipped (03:00–03:59 in Kyiv in spring) is shifted
 * forward by the length of the transition; a doubled one (in autumn) is taken first.
 */
function localInstant(timeZone: string, at: Date, days: number, minutes: number): Date {
  const { year, month, day } = wallClock(timeZone, at);

  return instantOfLocalDate(timeZone, { year, month, day: day + days }, minutes);
}

/** A calendar date with no time and no zone: year, month numbered from one, day of the month. */
export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Returns the instant at which the zone's clock shows `minutes` minutes into the day `date`. A day
 * that falls outside the month is carried over by the calendar (`{ day: 32 }` of January is
 * February 1). A clock transition follows the same rule as within a day, stated above.
 */
export function instantOfLocalDate(timeZone: string, date: LocalDate, minutes: number): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  const readWith = (sample: Date): Date =>
    new Date(wall - (wallTime(timeZone, sample) - sample.getTime()));
  const before = readWith(subHours(wall, 24));
  const after = readWith(addHours(wall, 24));
  const shows = (instant: Date): boolean => wallTime(timeZone, instant) === wall;

  return shows(before) || !shows(after) ? before : after;
}

/** Returns the calendar date the zone's clock shows at the instant `at`. */
export function localDateAt(timeZone: string, at: Date): LocalDate {
  const { year, month, day } = wallClock(timeZone, at);

  return { year, month, day };
}

/** Returns the instant at which the day containing `at` begins. */
export function startOfLocalDay(timeZone: string, at: Date): Date {
  return localInstant(timeZone, at, 0, 0);
}

/**
 * Returns the instant at which the next day begins: the next calendar date, however many hours the
 * current one lasts (23 and 25 on transition days).
 */
export function startOfNextLocalDay(timeZone: string, at: Date): Date {
  return localInstant(timeZone, at, 1, 0);
}

/**
 * Returns the instant at which the zone's wall clock shows `minutes` minutes into the day
 * containing `day`.
 */
export function instantOfLocalTime(timeZone: string, day: Date, minutes: number): Date {
  return localInstant(timeZone, day, 0, minutes);
}

/** A zone `Intl` does not know is a configuration error, not a reason to substitute UTC. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });

    return true;
  } catch {
    return false;
  }
}
