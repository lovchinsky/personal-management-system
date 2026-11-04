import { PageBlock } from '../client/page';

/**
 * A value the canonical model can read.
 *
 * The tag names the **canonical** shape, not the physical Notion type: `created_time` and `date`
 * both yield `date`, and `status` and `select` both yield `option`. The consumer checks against
 * the tag, because the binding alone does not prove that the property has the shape the slot
 * needs.
 */
type CanonicalValue =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'option'; readonly option: string }
  | {
      readonly type: 'date';
      readonly start: string;
      readonly end: string | null;
      /**
       * The time zone chosen explicitly in Notion. It is read because otherwise it is lost for
       * good.
       */
      readonly timeZone: string | null;
    }
  | { readonly type: 'number'; readonly number: number }
  | { readonly type: 'flag'; readonly flag: boolean }
  | { readonly type: 'links'; readonly pageIds: readonly string[]; readonly truncated: boolean }
  | { readonly type: 'prose'; readonly blocks: readonly PageBlock[] };

/**
 * The workspace holds a value that the canonical model does not describe
 * (`contracts/canonical.yaml`, key `adapter_errors`).
 *
 * The gap is not an exception, because the blast radius is one field and the rest of the record
 * stays readable. The caller asserts nothing about this field and does not substitute a default.
 */
export interface SchemaGap {
  readonly kind: 'schema_gap';
  readonly slot: string;
  readonly value: string;
}

/**
 * The state of a canonical field on one record that has been read. `absent` is a property of the
 * **type** (there is no carrier anywhere, `INV-002`), and `empty` is a property of the **record**
 * (the carrier exists and holds nothing, `INV-009`). For why they are kept apart, see
 * `docs/2-system.md` § “Logical interface of the adapter”.
 *
 * `unread` exists because a carrier is not always part of what was read: relation traversal is a
 * separate step under a budget, the page body arrives in a separate request, and the GBrain
 * anchor comes from another system altogether. Calling an unread field `empty` would assert an
 * emptiness nobody checked.
 */
export type Reading =
  | { readonly state: 'value'; readonly value: CanonicalValue }
  | { readonly state: 'absent'; readonly reason: string }
  | { readonly state: 'empty' }
  | { readonly state: 'unread'; readonly carrier: string }
  | { readonly state: 'gap'; readonly gap: SchemaGap }
  | { readonly state: 'non_canonical'; readonly value: string };

const EMPTY: Reading = { state: 'empty' };

export const Read = {
  value: (value: CanonicalValue): Reading => ({ state: 'value', value }),
  /** The binding is the only source of this reading, because it declares there is no carrier. */
  absent: (reason: string): Reading => ({ state: 'absent', reason }),
  empty: (): Reading => EMPTY,
  unread: (carrier: string): Reading => ({ state: 'unread', carrier }),
  gap: (slot: string, value: string): Reading => ({
    state: 'gap',
    gap: { kind: 'schema_gap', slot, value },
  }),
  /**
   * Represents a value from the `known_non_canonical` registry. It is not an error and is not
   * mapped to the canon.
   */
  nonCanonical: (value: string): Reading => ({ state: 'non_canonical', value }),
} as const;
