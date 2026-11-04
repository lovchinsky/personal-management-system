import type { CanonicalType } from '../../src/notion/binding/binding.schema';
import type { DecodedRecord } from '../../src/notion/semantics/decoded-record';
import type { Reading } from '../../src/notion/semantics/reading';
import type {
  NotionRecordQuery,
  RecordFilter,
  RecordOrder,
  RecordsFound,
} from '../../src/notion/semantics/record-query';

/**
 * A stand-in for Notion that runs a query over a described world of records the way Notion itself
 * runs it: the conditions, the order, the limit and the completeness of the answer. A test
 * describes the world, not the answers to queries, so the recency threshold in the query, the
 * order and the truncation of the result are checked, not stubbed in.
 */
export class RecordWorld implements Pick<NotionRecordQuery, 'records'> {
  readonly pages: DecodedRecord[] = [];
  /** The queries that reached Notion, in order. */
  readonly asked: [CanonicalType, readonly unknown[]][] = [];

  records<T extends CanonicalType>(
    type: T,
    where: readonly RecordFilter<T>[],
    limit: number,
    order?: RecordOrder<T>,
  ): Promise<RecordsFound<T>> {
    this.asked.push([type, where]);

    const matching = this.pages
      .filter((record): record is DecodedRecord<T> => record.type === type)
      .filter((record) => where.every((condition) => holds(record, condition)));
    const ordered = order === undefined ? matching : [...matching].sort(comparing(order));

    return Promise.resolve({ records: ordered.slice(0, limit), complete: ordered.length <= limit });
  }
}

function readingOf(record: DecodedRecord, field: string): Reading | undefined {
  const readings: Readonly<Record<string, Reading>> = record.readings;

  return readings[field];
}

/**
 * Returns the day of a date value, the way a Notion filter compares it with a date that has no
 * time.
 */
function dayOf(reading: Reading | undefined): string | null {
  return reading?.state === 'value' && reading.value.type === 'date'
    ? reading.value.start.slice(0, 10)
    : null;
}

function linksOf(reading: Reading | undefined): readonly string[] {
  return reading?.state === 'value' && reading.value.type === 'links' ? reading.value.pageIds : [];
}

function holds<T extends CanonicalType>(
  record: DecodedRecord,
  condition: RecordFilter<T>,
): boolean {
  if ('editedOnOrAfter' in condition) {
    return Date.parse(record.lastEditedAt) >= Date.parse(condition.editedOnOrAfter);
  }

  const reading = readingOf(record, condition.field);

  if ('anyOf' in condition) {
    return (
      reading?.state === 'value' &&
      reading.value.type === 'option' &&
      condition.anyOf.includes(reading.value.option)
    );
  }

  if ('onOrBefore' in condition) {
    const day = dayOf(reading);

    return day !== null && day <= condition.onOrBefore.slice(0, 10);
  }

  if ('onOrAfter' in condition) {
    const day = dayOf(reading);

    return day !== null && day >= condition.onOrAfter.slice(0, 10);
  }

  if ('linksTo' in condition) return linksOf(reading).includes(condition.linksTo);

  return linksOf(reading).length > 0;
}

function comparing<T extends CanonicalType>(
  order: RecordOrder<T>,
): (one: DecodedRecord, other: DecodedRecord) => number {
  const sign = ('edited' in order ? order.edited : order.direction) === 'ascending' ? 1 : -1;
  const keyOf = (record: DecodedRecord): string =>
    'edited' in order ? record.lastEditedAt : (dayOf(readingOf(record, order.field)) ?? '');

  return (one, other) => sign * keyOf(one).localeCompare(keyOf(other));
}
