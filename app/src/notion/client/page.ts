import type { BlockObjectResponse, PageObjectResponse } from '@notionhq/client';
import type { Assert } from '../../platform/types/assert';
import { PropertyId, propertyIdFromNotion } from './property-id';

/**
 * The physical Notion payload, to the extent the adapter reads it.
 *
 * The shape of a property comes from the official SDK and is not described again here: the
 * discriminated union provides narrowing by `type`, and the removal of a variant from the SDK's
 * list breaks the build at the code branch that read it.
 *
 * `has_more` is added on purpose. A live payload returns it on every relation, but
 * `PagePropertyValueWithIdResponse` does not declare it: in the SDK this field lives only in the
 * response of the property-item endpoint. An intersection with a union distributes over its
 * members, so narrowing by `type` remains.
 */
export type RestProperty = PageObjectResponse['properties'][string] & {
  readonly has_more?: boolean;
};

/** Each member of the union separately, so narrowing by `type` survives the replaced field. */
type WithCanonicalId<T> = T extends unknown ? Omit<T, 'id'> & { readonly id: PropertyId } : never;

/**
 * A property of a canonical page: the same payload, but with the `id` already canonical.
 *
 * The field is rewritten, not left raw: a raw string next to the canonical one would tempt
 * comparing the two without conversion, and the conversion would spread to every place that
 * compares.
 */
export type PageProperty = WithCanonicalId<RestProperty>;

/**
 * The envelope is our own and narrow: the page id, its data source, the time of the last edit, the
 * trash mark and the properties.
 *
 * `PageObjectResponse` has about ten more fields (`url`, `public_url`, `icon`, `cover`,
 * `is_locked`, the authors) that nobody reads and that would have to be built in every test.
 */
export interface RestPage {
  readonly id: string;
  /** Where the page lives. The data source determines its canonical type. */
  readonly parent: PageObjectResponse['parent'];
  readonly last_edited_time: string;
  /**
   * The page is in the trash: it can still be read, but it accepts no writes, and for the domain
   * it no longer exists.
   */
  readonly in_trash: boolean;
  /** The key is the display name; the contract is the `id` inside the value. */
  readonly properties: Readonly<Record<string, RestProperty>>;
}

/** A page in canonical form: properties keyed by canonical property ID. */
export interface Page {
  readonly id: string;
  /**
   * The data source the page lives in, in Notion's form; `null` if it does not live in a data
   * source. The binding determines the canonical type from it: a property id alone does not
   * determine the field, since `title` exists in every data source.
   */
  readonly dataSourceId: string | null;
  /**
   * The time of the page's last edit. It is the carrier of the attention signal: an edit means that
   * the person or the system looked at the page and recorded something.
   */
  readonly last_edited_time: string;
  /** The page is in the trash: for the domain it no longer exists. */
  readonly inTrash: boolean;
  /** The key is the canonical property ID: the conversion is done at input, in `canonicalPage`. */
  readonly properties: ReadonlyMap<PropertyId, PageProperty>;
}

/**
 * Converts a REST page to canonical form. The same function serves the reader and the tests: a
 * page built around it would not test the conversion at all.
 */
export function canonicalPage(page: RestPage): Page {
  const properties = new Map<PropertyId, PageProperty>();

  for (const property of Object.values(page.properties)) {
    const id = propertyIdFromNotion(property.id);

    properties.set(id, { ...property, id });
  }

  return {
    id: page.id,
    dataSourceId: page.parent.type === 'data_source_id' ? page.parent.data_source_id : null,
    last_edited_time: page.last_edited_time,
    inTrash: page.in_trash,
    properties,
  };
}

/**
 * A page body block kept whole, in the SDK's own shape.
 *
 * The adapter neither parses a block nor narrows it: the body is prose, and whoever reads it needs
 * the content. Narrowing to `id` and `type` would hand the model an empty shell instead of the
 * text.
 */
export type PageBlock = BlockObjectResponse;

/** An SDK response fits the page envelope. */
export type PageEnvelopeFitsSdk = Assert<[PageObjectResponse] extends [RestPage] ? true : false>;
