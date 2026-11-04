import type { DecodedRecord } from '../notion/semantics/decoded-record';
import type { Reading } from '../notion/semantics/reading';
import { lifecycleOf } from './lifecycle';
import { undetermined, type Undetermined } from './undetermined';

/**
 * The instant of a date in milliseconds, as the installation's time rule places it, or `null` when
 * there is no way to place it. The rule has neither a clock nor time zones, so the caller supplies
 * the placement (`docs/2-system.md` § “Schedule and recurrence”). With `start`, a check date comes
 * due at the start of its day; with `end`, a deadline passes at the end of its day.
 */
export type PlaceDate = (
  date: { readonly start: string; readonly timeZone: string | null },
  edge: 'start' | 'end',
) => number | null;

type Moment =
  { readonly state: 'none' } | { readonly state: 'at'; readonly at: number } | Undetermined;

/**
 * Returns the instant of a date field: `empty` means “no date”, and the other states assert
 * nothing.
 */
function momentOf(reading: Reading, place: PlaceDate, edge: 'start' | 'end'): Moment {
  switch (reading.state) {
    case 'value': {
      if (reading.value.type !== 'date') return undetermined('gap');

      const at = place({ start: reading.value.start, timeZone: reading.value.timeZone }, edge);

      return at === null ? undetermined('gap') : { state: 'at', at };
    }

    case 'empty':
      return { state: 'none' };

    case 'absent':
    case 'unread':
    case 'gap':
    case 'non_canonical':
      return undetermined(reading.state);
  }
}

type CheckDue =
  /** A `Waiting For` whose check date has come due: it is time to check the dependency. */
  | { readonly state: 'due'; readonly at: number }
  /** A `Waiting For` with no check date or with a date that has not come due yet. */
  | { readonly state: 'not_due' }
  /** Not a `Waiting For`: the date means something else or nothing. */
  | { readonly state: 'not_applicable' }
  | Undetermined;

/**
 * Checks whether the dependency check date has come due: the `Date` on a `Waiting For` is the time
 * to check whether what is expected has arrived (`docs/1-methodology.md` § “Waiting For”). The
 * Task's status does not change when the date comes due; the rule only says it is time to look.
 */
export function checkDateReached(
  task: DecodedRecord<'task'>,
  place: PlaceDate,
  now: number,
): CheckDue {
  const lifecycle = lifecycleOf(task.readings.status);

  if (lifecycle.state === 'undetermined') return lifecycle;
  if (lifecycle.state !== 'open' || lifecycle.status !== 'Waiting For') {
    return { state: 'not_applicable' };
  }

  const date = momentOf(task.readings.date, place, 'start');

  if (date.state === 'undetermined') return date;
  if (date.state === 'none' || date.at > now) return { state: 'not_due' };

  return { state: 'due', at: date.at };
}

type DeadlineSignal =
  /** The deadline has passed, and the work is open. */
  | { readonly state: 'passed'; readonly at: number }
  /** A `Waiting For` with a deadline within the threshold: the work is stalled on a dependency. */
  | { readonly state: 'near'; readonly at: number }
  /** There is no deadline, or it is far off. */
  | { readonly state: 'none' }
  /** The Task is not a commitment with a time: closed, outside the model or `Someday/Maybe`. */
  | { readonly state: 'not_applicable' }
  | Undetermined;

/**
 * Returns a structural signal that a deadline is at risk: the deadline has passed on open work, or
 * it is approaching while the work waits on a dependency (`docs/3-policy.md` § “Deadline risk”). A
 * `Deadline` by itself is not a risk, so a near deadline on work that can be done is not a signal;
 * `Someday/Maybe` is not a commitment.
 */
export function deadlineSignal(
  task: DecodedRecord<'task'>,
  place: PlaceDate,
  now: number,
  leadMs: number,
): DeadlineSignal {
  const lifecycle = lifecycleOf(task.readings.status);

  if (lifecycle.state === 'undetermined') return lifecycle;
  if (lifecycle.state !== 'open' || lifecycle.status === 'Someday/Maybe') {
    return { state: 'not_applicable' };
  }

  const deadline = momentOf(task.readings.deadline, place, 'end');

  if (deadline.state === 'undetermined') return deadline;
  if (deadline.state === 'none') return { state: 'none' };
  if (deadline.at <= now) return { state: 'passed', at: deadline.at };
  if (lifecycle.status === 'Waiting For' && deadline.at <= now + leadMs) {
    return { state: 'near', at: deadline.at };
  }

  return { state: 'none' };
}
