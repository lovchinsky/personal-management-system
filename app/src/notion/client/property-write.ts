import type { CreatePageParameters, UpdatePageParameters } from '@notionhq/client';
import type { Assert } from '../../platform/types/assert';
import { PropertyId } from './property-id';

/**
 * The physical type of each property: the type a write is encoded by. It comes from the live
 * schema of the data source or from a freshly re-read page, not from the binding, because the
 * binding has no types.
 */
export type PhysicalTypes = ReadonlyMap<PropertyId, string>;

/** Returns the physical types of any list of properties, a page's or a schema's, by property ID. */
export function physicalTypes(
  properties: ReadonlyMap<PropertyId, { readonly type: string }>,
): PhysicalTypes {
  return new Map([...properties].map(([id, property]) => [id, property.type]));
}

/**
 * The shapes of a property-write request: exactly the ones the system writes
 * (`contracts/canonical.yaml`, key `canonical_writes`).
 *
 * The arrays are deliberately not `readonly`, because the SDK's request types require mutable
 * arrays. Otherwise the conformance assertion below would not hold.
 */

/** A run of text in a request. Notion accepts up to 2000 characters in one run. */
interface TextRun {
  readonly type: 'text';
  readonly text: { readonly content: string };
}

export const TEXT_RUN_CHARS = 2_000;

export type PropertyWrite =
  | { readonly title: TextRun[] }
  | { readonly rich_text: TextRun[] }
  | { readonly status: { readonly id: string } }
  | { readonly select: { readonly id: string } | null }
  | {
      readonly date: {
        readonly start: string;
        readonly end: string | null;
        readonly time_zone: string | null;
      } | null;
    }
  | { readonly relation: Array<{ readonly id: string }> };

/** The properties of a request, keyed by property id as it is written in the binding. */
export type PropertyWrites = Readonly<Record<string, PropertyWrite>>;

/**
 * Cuts text into runs that each fit the limit of one run. It cuts by code points, not by UTF-16
 * units, because a split surrogate pair would produce a corrupted character in Notion.
 */
export function textRuns(text: string): TextRun[] {
  const points = Array.from(text);
  const runs: TextRun[] = [];

  for (let start = 0; start < points.length; start += TEXT_RUN_CHARS) {
    runs.push({
      type: 'text',
      text: { content: points.slice(start, start + TEXT_RUN_CHARS).join('') },
    });
  }

  return runs;
}

/** The write shapes fit the SDK's request, both for creating a page and for changing one. */
export type PropertyWritesFitSdk = Assert<
  [PropertyWrites] extends [NonNullable<UpdatePageParameters['properties']>]
    ? [PropertyWrites] extends [NonNullable<CreatePageParameters['properties']>]
      ? true
      : false
    : false
>;
