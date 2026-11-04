import { z } from 'zod';
import { canonicalNotionId, notionIdSchema } from '../client/notion-id';
import { Reading } from './reading';

/** The longest text the system writes to one property. */
const MAX_WRITTEN_TEXT_CHARS = 20_000;

/**
 * How many relations the system writes to one property. A page in the answer to a write includes
 * the first 25 relations, so a longer list cannot be verified by the same answer.
 */
export const MAX_WRITTEN_LINKS = 25;

/**
 * A date or an instant with a time zone. Notion would read an instant without a time zone in its
 * own way.
 */
export const momentSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

/** Relations: pages in one form, without repeats and no more than the answer verifies. */
export const linksSchema = z
  .array(notionIdSchema)
  .max(MAX_WRITTEN_LINKS)
  .refine((ids) => new Set(ids).size === ids.length, 'the same page is linked twice');

/**
 * A canonical value the system writes (`contracts/canonical.yaml`, key `canonical_writes`).
 *
 * The kind names the canonical form, not the physical type, because the live schema says at the
 * time of the write which type the value lands in. An option is a canonical name, not an option
 * id, so the binding converts it. A date has no time zone, because the instant already contains
 * an offset and the behavior of a write with a named time zone is not measured.
 */
export const canonicalWriteSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    // An empty or whitespace-only text would read back as empty, so writing such a text means
    // clearing, and there is a separate kind for that.
    text: z
      .string()
      .max(MAX_WRITTEN_TEXT_CHARS)
      .refine((text) => text.trim().length > 0, 'text must not be blank — use clear'),
  }),
  z.strictObject({ kind: z.literal('option'), option: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('date'),
    start: momentSchema,
    end: momentSchema.nullable().default(null),
  }),
  z.strictObject({ kind: z.literal('links'), pageIds: linksSchema }),
  z.strictObject({ kind: z.literal('clear') }),
]);

export type CanonicalWrite = z.output<typeof canonicalWriteSchema>;

/** A value as composed by whoever writes: page ids are not yet in one form. */
export type CanonicalWriteRequest = z.input<typeof canonicalWriteSchema>;

export type CanonicalWriteKind = CanonicalWrite['kind'];

/**
 * Checks whether the property reads as named, by meaning: text, an option, an instant as an
 * instant, relations as a set, cleared as empty. This is how state is compared in the
 * precondition `property_reads_as` and as the basis of verifying the system's own write.
 *
 * The time zone of a date is an annotation of the instant, not part of it, if `start` itself
 * has an offset. An instant without an offset (the local time of a zoned date) is not placed
 * in time, so it is equal to nothing: it is not guessed from the host's clock (`sameMoment`).
 */
export function readsAs(write: CanonicalWrite, reading: Reading): boolean {
  if (write.kind === 'clear') return cleared(reading);

  if (reading.state !== 'value') return false;

  const { value } = reading;

  switch (write.kind) {
    case 'text':
      return value.type === 'text' && value.text === write.text;

    case 'option':
      return value.type === 'option' && value.option === write.option;

    case 'date':
      return (
        value.type === 'date' &&
        sameMoment(value.start, write.start) &&
        (value.end === null ? write.end === null : sameMoment(value.end, write.end))
      );

    case 'links':
      return (
        value.type === 'links' &&
        !value.truncated &&
        sameSet(value.pageIds.map(canonicalNotionId), write.pageIds)
      );
  }
}

/**
 * Checks whether what was read confirms the system's own write: `readsAs`, and no time zone on
 * top. The system writes no time zones, so a time zone in the answer to a write is a discrepancy,
 * not an annotation. This is how each write is verified: the Notion answer, decoded by the
 * adapter, must equal what was intended.
 */
export function confirmsWrite(write: CanonicalWrite, reading: Reading): boolean {
  return readsAs(write, reading) && !zoned(reading);
}

/** Checks whether the reading is a date for which Notion stores a time zone. */
function zoned(reading: Reading): boolean {
  return (
    reading.state === 'value' && reading.value.type === 'date' && reading.value.timeZone !== null
  );
}

/**
 * Checks whether two writes say the same thing: the same kind and the same value in canonical
 * form. An instant is compared as an instant and relations as a set, the same as in `readsAs`.
 * This is how it is checked that an effect really changes what the condition reads.
 */
export function sameWrite(one: CanonicalWrite, other: CanonicalWrite): boolean {
  switch (one.kind) {
    case 'clear':
      return other.kind === 'clear';

    case 'text':
      return other.kind === 'text' && other.text === one.text;

    case 'option':
      return other.kind === 'option' && other.option === one.option;

    case 'date':
      return (
        other.kind === 'date' &&
        sameMoment(one.start, other.start) &&
        (one.end === null ? other.end === null : sameMoment(one.end, other.end))
      );

    case 'links':
      return other.kind === 'links' && sameSet(one.pageIds, other.pageIds);
  }
}

/**
 * A cleared property reads as empty. Relations are the exception: an empty list is a value, not
 * emptiness (the carrier exists, there are no relations), so clearing reads as an empty list.
 */
function cleared(reading: Reading): boolean {
  if (reading.state === 'empty') return true;

  return (
    reading.state === 'value' &&
    reading.value.type === 'links' &&
    reading.value.pageIds.length === 0 &&
    !reading.value.truncated
  );
}

/**
 * A date with a date is compared by spelling, an instant with an instant by time. A date and an
 * instant are not equal. An instant without an offset (`2026-10-01T10:00:00`) is not placed in
 * time, because `Date.parse` would read it in the host's time zone, so the answer would depend on
 * the machine. An instant without an offset is equal to nothing.
 */
function sameMoment(read: string, written: string | null): boolean {
  if (written === null) return false;

  const dateOnly = (value: string): boolean => value.length === 10;

  if (dateOnly(read) || dateOnly(written)) return read === written;
  if (!hasOffset(read) || !hasOffset(written)) return false;

  return Date.parse(read) === Date.parse(written);
}

/** An instant with a time of day has an offset from UTC: `Z` or `±hh:mm`. */
function hasOffset(moment: string): boolean {
  return /T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(moment);
}

function sameSet(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((id) => other.includes(id));
}
