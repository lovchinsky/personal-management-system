import type { Reading } from '../notion/semantics/reading';
import { undetermined, type Undetermined } from './undetermined';

/** The value shape that the consumer of a field needs. */
type ValueType = Extract<Reading, { readonly state: 'value' }>['value']['type'];

/** What the rule sees in an optional field: it is present, it is empty, or nothing can be said. */
type Presence = { readonly state: 'present' } | { readonly state: 'none' } | Undetermined;

/**
 * Checks whether the record has this field. It is the rules' only access to optional scalar fields
 * (relations are read by `linkedPageIds`).
 *
 * `empty` is a property of the record: the carrier exists and holds nothing, so the answer is
 * “none”. The other states assert nothing. So does a value of a shape other than the one the
 * consumer needs: the property does not prove that the slot has the shape the consumer expects
 * (`notion/semantics/property.decoder.ts`).
 */
export function presenceOf(reading: Reading, expected: ValueType): Presence {
  switch (reading.state) {
    case 'value':
      return reading.value.type === expected ? { state: 'present' } : undetermined('gap');

    case 'empty':
      return { state: 'none' };

    case 'absent':
    case 'unread':
    case 'gap':
    case 'non_canonical':
      return undetermined(reading.state);
  }
}

/** A date without a time of day is a “day”; with a time of day, an “instant”. */
type DateKind =
  | { readonly state: 'none' }
  | { readonly state: 'day' }
  | { readonly state: 'timed' }
  | Undetermined;

/** `2026-10-20T14:00:00.000+03:00` has a time of day, `2026-10-20` does not. */
const TIME_OF_DAY = /T\d{2}:\d{2}/;

/**
 * Classifies a date field by whether it holds a date and whether that date has a time of day. The
 * difference matters to the methodology: a Task deferred “to a day” belongs to the `Scheduled`
 * view, while an event with a time is a Calendar commitment (`docs/1-methodology.md` § “Hard
 * landscape”).
 */
export function dateKindOf(reading: Reading): DateKind {
  switch (reading.state) {
    case 'value':
      if (reading.value.type !== 'date') return undetermined('gap');

      return { state: TIME_OF_DAY.test(reading.value.start) ? 'timed' : 'day' };

    case 'empty':
      return { state: 'none' };

    case 'absent':
    case 'unread':
    case 'gap':
    case 'non_canonical':
      return undetermined(reading.state);
  }
}
