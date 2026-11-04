import { messageOf } from '../error/message-of';
import { instantOfLocalDate, localDateAt, type LocalDate } from './local-day';
import { parseTimeOfDay } from './time-of-day';

/**
 * A schedule the person sets in the wall-clock time of the installation's zone
 * (`docs/2-system.md` § “Schedule and recurrence”, ADR 0036).
 *
 * The grammar is closed: `daily HH:MM`, `weekly <mon…sun> HH:MM`, `monthly <1–28> HH:MM`,
 * `quarterly <1–28> HH:MM`, `off`. The day of the month is capped at 28: otherwise a shorter month
 * would lose its occurrence.
 */
export type Schedule =
  | { readonly kind: 'off' }
  | { readonly kind: 'daily'; readonly minutes: number }
  | { readonly kind: 'weekly'; readonly weekday: number; readonly minutes: number }
  | { readonly kind: 'monthly'; readonly day: number; readonly minutes: number }
  | { readonly kind: 'quarterly'; readonly day: number; readonly minutes: number };

/** Weekdays in ISO order: Monday is 1. */
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const MAX_MONTH_DAY = 28;

const FORMS = [
  /^(off)$/,
  /^(daily) (\S+)$/,
  /^(weekly) (\S+) (\S+)$/,
  /^(monthly) (\S+) (\S+)$/,
  /^(quarterly) (\S+) (\S+)$/,
];

const GRAMMAR =
  'expected `off`, `daily HH:MM`, `weekly <mon…sun> HH:MM`, `monthly <1–28> HH:MM` or `quarterly <1–28> HH:MM`';

/**
 * Parses a schedule from a variable's value. A form outside the grammar is refused with an error
 * that names the grammar.
 */
export function parseSchedule(text: string): Schedule {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const match = FORMS.map((form) => form.exec(normalized)).find((found) => found !== null);
  if (!match) throw new Error(`schedule "${text}": ${GRAMMAR}`);

  const [, kind, first, second] = match;

  switch (kind) {
    case 'off':
      return { kind: 'off' };

    case 'daily':
      return { kind: 'daily', minutes: timeOf(text, first) };

    case 'weekly':
      return { kind: 'weekly', weekday: weekdayOf(text, first), minutes: timeOf(text, second) };

    default:
      return {
        kind: kind === 'monthly' ? 'monthly' : 'quarterly',
        day: monthDayOf(text, first),
        minutes: timeOf(text, second),
      };
  }
}

/**
 * Returns the schedule's problem in words, or `null`, for the environment check that collects all
 * problems together.
 */
export function scheduleProblem(text: string): string | null {
  try {
    parseSchedule(text);

    return null;
  } catch (error) {
    return messageOf(error);
  }
}

function timeOf(text: string, value: string | undefined): number {
  try {
    return parseTimeOfDay(value ?? '');
  } catch {
    throw new Error(`schedule "${text}": time of day must be HH:MM`);
  }
}

function weekdayOf(text: string, value: string | undefined): number {
  const index = WEEKDAYS.findIndex((day) => day === value);
  if (index < 0) {
    throw new Error(`schedule "${text}": weekday must be one of ${WEEKDAYS.join(', ')}`);
  }

  return index + 1;
}

function monthDayOf(text: string, value: string | undefined): number {
  const day = /^\d{1,2}$/.test(value ?? '') ? Number(value) : Number.NaN;
  if (!(day >= 1 && day <= MAX_MONTH_DAY)) {
    throw new Error(`schedule "${text}": day of month must be 1–${MAX_MONTH_DAY}`);
  }

  return day;
}

/**
 * One occurrence of a schedule. Its identity is the period key, not the instant: a clock change
 * and an edit of the time within the period do not produce a second occurrence.
 */
export interface Occurrence {
  /** The local key of the period: `2026-10-14`, `2026-W42`, `2026-10`, `2026-Q4`. */
  readonly key: string;
  /** The time of the occurrence. */
  readonly at: Date;
  /**
   * The end of the window: an occurrence that has not taken place before it will no longer take
   * place. A daily one lasts until the end of its local day; the others, until the next occurrence.
   */
  readonly closesAt: Date;
}

/**
 * Returns the latest occurrence whose time is not later than `now`. `null` means the schedule is
 * off.
 */
export function occurrenceAt(schedule: Schedule, timeZone: string, now: Date): Occurrence | null {
  if (schedule.kind === 'off') return null;

  const period = PERIODS[schedule.kind];
  const today = localDateAt(timeZone, now);
  const current = period.anchorOn(today, schedule);
  const anchor =
    momentOf(timeZone, current, schedule).getTime() <= now.getTime()
      ? current
      : period.shift(current, -1);

  return occurrenceOf(schedule, period, timeZone, anchor);
}

/** Returns the occurrence of the same schedule that comes before `occurrence`. */
export function occurrenceBefore(
  schedule: Schedule,
  timeZone: string,
  occurrence: Occurrence,
): Occurrence | null {
  return occurrenceAt(schedule, timeZone, new Date(occurrence.at.getTime() - 1));
}

/** The period an occurrence key names: a day, a week (Monday to Sunday), a month or a quarter. */
export type KeyedPeriod =
  | { readonly kind: 'daily'; readonly date: LocalDate }
  | { readonly kind: 'weekly'; readonly first: LocalDate; readonly last: LocalDate }
  | { readonly kind: 'monthly'; readonly year: number; readonly month: number }
  | { readonly kind: 'quarterly'; readonly year: number; readonly quarter: number };

const DAILY_KEY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const WEEKLY_KEY = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const MONTHLY_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTERLY_KEY = /^(\d{4})-Q([1-4])$/;

/**
 * Returns the period for an occurrence key. It inverts the keys that schedule periods produce.
 */
export function periodOfKey(key: string): KeyedPeriod {
  const daily = DAILY_KEY.exec(key);
  const date = daily && dateOf(daily);
  // The pattern lets February 31 through, but the calendar rolls it over to March, so a day like
  // that is never a key.
  if (date && sameDate(calendar(date), date)) return { kind: 'daily', date };

  const weekly = WEEKLY_KEY.exec(key);
  const first = weekly && isoWeekMonday(Number(weekly[1]), Number(weekly[2]));
  // Not every year has a 53rd week: a week the year does not have yields no key of its own.
  if (first && isoWeekKey(first) === key) {
    return { kind: 'weekly', first, last: calendar({ ...first, day: first.day + 6 }) };
  }

  const monthly = MONTHLY_KEY.exec(key);
  if (monthly) return { kind: 'monthly', year: Number(monthly[1]), month: Number(monthly[2]) };

  const quarterly = QUARTERLY_KEY.exec(key);
  if (quarterly) {
    return { kind: 'quarterly', year: Number(quarterly[1]), quarter: Number(quarterly[2]) };
  }

  throw new Error(`${key} is not an occurrence key`);
}

function dateOf(match: RegExpExecArray): LocalDate {
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function sameDate(left: LocalDate, right: LocalDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

/**
 * Returns the Monday of an ISO week. The first week of a year is the one that contains January 4.
 */
function isoWeekMonday(year: number, week: number): LocalDate {
  const fourth = { year, month: 1, day: 4 };

  return calendar({ ...fourth, day: fourth.day - isoWeekday(fourth) + 1 + 7 * (week - 1) });
}

type Active = Exclude<Schedule, { readonly kind: 'off' }>;

interface Period {
  /**
   * Returns the occurrence date in the period that contains `date`, or in the nearest earlier
   * period (for a week).
   */
  anchorOn(date: LocalDate, schedule: Active): LocalDate;
  /** Returns the occurrence date `steps` periods further on. */
  shift(anchor: LocalDate, steps: number): LocalDate;
  key(anchor: LocalDate): string;
}

const PERIODS: Readonly<Record<Active['kind'], Period>> = {
  daily: {
    anchorOn: (date) => date,
    shift: (anchor, steps) => calendar({ ...anchor, day: anchor.day + steps }),
    key: (anchor) => `${anchor.year}-${pad(anchor.month)}-${pad(anchor.day)}`,
  },
  weekly: {
    anchorOn: (date, schedule) => {
      const weekday = schedule.kind === 'weekly' ? schedule.weekday : 1;
      const back = (isoWeekday(date) - weekday + 7) % 7;

      return calendar({ ...date, day: date.day - back });
    },
    shift: (anchor, steps) => calendar({ ...anchor, day: anchor.day + 7 * steps }),
    key: (anchor) => isoWeekKey(anchor),
  },
  monthly: {
    anchorOn: (date, schedule) => ({ year: date.year, month: date.month, day: dayOf(schedule) }),
    shift: (anchor, steps) => calendar({ ...anchor, month: anchor.month + steps }),
    key: (anchor) => `${anchor.year}-${pad(anchor.month)}`,
  },
  quarterly: {
    anchorOn: (date, schedule) => ({
      year: date.year,
      month: Math.floor((date.month - 1) / 3) * 3 + 1,
      day: dayOf(schedule),
    }),
    shift: (anchor, steps) => calendar({ ...anchor, month: anchor.month + 3 * steps }),
    key: (anchor) => `${anchor.year}-Q${Math.floor((anchor.month - 1) / 3) + 1}`,
  },
};

function occurrenceOf(
  schedule: Active,
  period: Period,
  timeZone: string,
  anchor: LocalDate,
): Occurrence {
  const closesAt =
    schedule.kind === 'daily'
      ? instantOfLocalDate(timeZone, { ...anchor, day: anchor.day + 1 }, 0)
      : momentOf(timeZone, period.shift(anchor, 1), schedule);

  return { key: period.key(anchor), at: momentOf(timeZone, anchor, schedule), closesAt };
}

function momentOf(timeZone: string, date: LocalDate, schedule: Active): Date {
  return instantOfLocalDate(timeZone, date, schedule.minutes);
}

function dayOf(schedule: Active): number {
  return schedule.kind === 'monthly' || schedule.kind === 'quarterly' ? schedule.day : 1;
}

/**
 * Returns a date normalized by the calendar: January 32 is February 1, month 13 is January of the
 * next year.
 */
function calendar(date: LocalDate): LocalDate {
  const at = new Date(Date.UTC(date.year, date.month - 1, date.day));

  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

function isoWeekday(date: LocalDate): number {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

  return weekday === 0 ? 7 : weekday;
}

/**
 * Returns the key of an ISO week. The week's year is taken from its Thursday, so December 29 can
 * belong to `W01`.
 */
function isoWeekKey(date: LocalDate): string {
  const thursday = calendar({ ...date, day: date.day - isoWeekday(date) + 4 });
  const januaryFirst = { year: thursday.year, month: 1, day: 1 };
  const toFirstThursday = (4 - isoWeekday(januaryFirst) + 7) % 7;
  const ordinal =
    (Date.UTC(thursday.year, thursday.month - 1, thursday.day) -
      Date.UTC(thursday.year, 0, 1 + toFirstThursday)) /
    86_400_000;

  return `${thursday.year}-W${pad(ordinal / 7 + 1)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
