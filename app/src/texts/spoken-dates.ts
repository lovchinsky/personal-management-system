import { localDateAt, type LocalDate } from '../platform/time/local-day';
import type { Language } from './language';

/**
 * The App writes dates to the person in words, in the installation's language (ADR 0046): the day
 * and the month, the year only when it is not the current one, the time of day if the instant has
 * one. `Intl` supplies the grammar in the installation's language, not the code:
 * “27 жовтня о 14:30” (October 27 at 2:30 PM), “20–26 жовтня” (October 20 – 26), “October 27 at
 * 2:30 PM”. ISO stays for keys and for values meant for programs.
 */

/** The fields of the day format: the month in words, the year when it is not the one in `today`. */
function dayFields(year: number, today: LocalDate): Intl.DateTimeFormatOptions {
  return {
    day: 'numeric',
    month: 'long',
    ...(year === today.year ? {} : { year: 'numeric' }),
  };
}

/** A calendar day as a point in time for `Intl`: noon UTC, so the format's zone cannot shift it. */
const noonOf = (date: LocalDate): Date =>
  new Date(Date.UTC(date.year, date.month - 1, date.day, 12));

/**
 * Formats a day in words: “27 жовтня” (October 27); “3 січня 2027 р.” (January 3, 2027) when the
 * year is not the current one.
 */
export function spokenDay(date: LocalDate, language: Language, today: LocalDate): string {
  return new Intl.DateTimeFormat(language, {
    ...dayFields(date.year, today),
    timeZone: 'UTC',
  }).format(noonOf(date));
}

/**
 * Formats the days from `first` to `last` in words: “20–26 жовтня” (October 20 – 26),
 * “28 грудня 2026 – 3 січня 2027 рр.” (December 28, 2026 – January 3, 2027). `Intl` puts the spaces
 * around the dash and before the abbreviation according to the typography of the language (thin and
 * non-breaking).
 */
export function spokenDays(
  first: LocalDate,
  last: LocalDate,
  language: Language,
  today: LocalDate,
): string {
  const year = first.year === last.year ? first.year : Number.NaN;

  return new Intl.DateTimeFormat(language, {
    ...dayFields(year, today),
    timeZone: 'UTC',
  }).formatRange(noonOf(first), noonOf(last));
}

/**
 * Formats an instant in words, on the clock of the installation's zone: “27 жовтня о 14:30”
 * (October 27 at 2:30 PM).
 */
export function spokenMoment(at: Date, language: Language, timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat(language, {
    ...dayFields(localDateAt(timeZone, at).year, localDateAt(timeZone, now)),
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(at);
}

/**
 * Returns the calendar day from a `YYYY-MM-DD` value, or `null` for an instant with a time of day.
 */
function dayOfValue(value: string): LocalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  return match === null
    ? null
    : { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Formats a date in words. The date is a day (`2026-11-10`) or an ISO instant with a zone, as the
 * canonical write has it. The results look like “10 листопада” (November 10),
 * “10 листопада о 14:00” (November 10 at 2:00 PM) and “10–12 листопада” (November 10 – 12).
 */
export function spokenDateValue(
  start: string,
  end: string | null,
  language: Language,
  timeZone: string,
  now: Date,
): string {
  const today = localDateAt(timeZone, now);
  const one = (value: string): string => {
    const day = dayOfValue(value);

    return day === null
      ? spokenMoment(new Date(value), language, timeZone, now)
      : spokenDay(day, language, today);
  };

  if (end === null) return one(start);

  const first = dayOfValue(start);
  const last = dayOfValue(end);

  return first !== null && last !== null
    ? spokenDays(first, last, language, today)
    : `${one(start)} – ${one(end)}`;
}
