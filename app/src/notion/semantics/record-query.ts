import { Injectable } from '@nestjs/common';
import { Binding, propertyOf, type BoundProperty } from '../binding/binding';
import type { CanonicalType } from '../binding/binding.schema';
import { DataSourceQuery, type QueryFilter, type QuerySorts } from '../client/data-source-query';
import { LiveSchema, type LiveProperty } from '../client/live-schema';
import type { PropertyId } from '../client/property-id';
import { AdapterConfigurationError } from './adapter.error';
import type { DecodedRecord, FieldOf } from './decoded-record';
import { SemanticAdapter } from './semantic.adapter';

type Group = Extract<QueryFilter, { readonly and: unknown }>['and'];
type Condition = Group[number];
/** A condition without a group: Notion accepts groups nested no deeper than two levels. */
type Leaf = Exclude<Condition, { readonly or: unknown } | { readonly and: unknown }>;

/**
 * A filter condition over a canonical field, written without physical ids and names. The binding
 * and the live schema substitute them when the query is made.
 */
export type RecordFilter<T extends CanonicalType> =
  /** The field's option is one of the canonical names. */
  | { readonly field: FieldOf<T>; readonly anyOf: readonly string[] }
  /** The field's date is on or before this date or time (ISO). */
  | { readonly field: FieldOf<T>; readonly onOrBefore: string }
  /** The field's date is on or after this date or time (ISO). */
  | { readonly field: FieldOf<T>; readonly onOrAfter: string }
  /** The field's relation points to this page. */
  | { readonly field: FieldOf<T>; readonly linksTo: string }
  /** The field's relation is not empty. */
  | { readonly field: FieldOf<T>; readonly linked: true }
  /** The page was edited at or after this time (ISO). */
  | { readonly editedOnOrAfter: string };

/**
 * The order of the records in the response: by a field's date or by the last edit. The query limit
 * cuts off the end of the order, so the records the caller must see come first.
 */
export type RecordOrder<T extends CanonicalType> =
  | { readonly field: FieldOf<T>; readonly direction: 'ascending' | 'descending' }
  | { readonly edited: 'ascending' | 'descending' };

export interface RecordsFound<T extends CanonicalType> {
  readonly records: readonly DecodedRecord<T>[];
  /**
   * `false` means the limit cut the selection off, so anything missing from the records may be
   * beyond it.
   */
  readonly complete: boolean;
}

/**
 * Finds the records of a canonical type that pass the conditions. They are read over REST and
 * decoded by the same adapter as a single record. Only this layer reads the binding (`INV-081`):
 * a condition names a canonical field, while the property id, the option id and the option's
 * current name (the Notion filter accepts the name) appear here.
 */
@Injectable()
export class NotionRecordQuery {
  constructor(
    private readonly binding: Binding,
    private readonly schema: LiveSchema,
    private readonly query: DataSourceQuery,
    private readonly adapter: SemanticAdapter,
  ) {}

  /**
   * Returns the records that pass **all** the conditions: at most `limit`, in the order given by
   * `order`.
   */
  async records<T extends CanonicalType>(
    type: T,
    where: readonly RecordFilter<T>[],
    limit: number,
    order?: RecordOrder<T>,
  ): Promise<RecordsFound<T>> {
    if (where.length === 0) throw new Error(`a ${type} query needs at least one condition`);

    const dataSourceId = this.binding.dataSource(type);
    const live = await this.schema.of(dataSourceId);
    const conditions = where.map((condition) => this.condition(type, condition, live));
    const filter: QueryFilter = conditions.length === 1 ? conditions[0] : { and: conditions };
    const sorts = order === undefined ? undefined : this.sorts(type, order, live);
    const found = await this.query.query(dataSourceId, filter, limit, sorts);

    return {
      records: found.pages.map((page) => this.adapter.decode(type, page)),
      complete: found.complete,
    };
  }

  private condition<T extends CanonicalType>(
    type: T,
    condition: RecordFilter<T>,
    live: ReadonlyMap<PropertyId, LiveProperty>,
  ): Condition {
    if ('editedOnOrAfter' in condition) {
      return {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: condition.editedOnOrAfter },
      };
    }

    const { slot, property, physical, at } = this.propertyAt(type, condition.field, live);

    if ('anyOf' in condition) {
      if (condition.anyOf.length === 0) throw new Error(`${slot}: anyOf needs at least one option`);

      const leaves = condition.anyOf.map((option): Leaf => {
        const name = this.liveName(type, slot, property, physical, option);

        if (physical.type === 'status') return { property: at, status: { equals: name } };
        if (physical.type === 'select') return { property: at, select: { equals: name } };

        throw misbound(type, slot, at, `a ${physical.type} property has no options to query`);
      });

      return leaves.length === 1 ? leaves[0] : { or: leaves };
    }

    if ('onOrBefore' in condition) {
      expectType(type, slot, at, physical, 'date');

      return { property: at, date: { on_or_before: condition.onOrBefore } };
    }

    if ('onOrAfter' in condition) {
      expectType(type, slot, at, physical, 'date');

      return { property: at, date: { on_or_after: condition.onOrAfter } };
    }

    expectType(type, slot, at, physical, 'relation');

    return 'linksTo' in condition
      ? { property: at, relation: { contains: condition.linksTo } }
      : { property: at, relation: { is_not_empty: true } };
  }

  /**
   * Returns the order in Notion's form: a field is sorted by the property the binding assigns to
   * it, an edit by the page's edit time.
   */
  private sorts<T extends CanonicalType>(
    type: T,
    order: RecordOrder<T>,
    live: ReadonlyMap<PropertyId, LiveProperty>,
  ): QuerySorts {
    if ('edited' in order) return [{ timestamp: 'last_edited_time', direction: order.edited }];

    return [{ property: this.propertyAt(type, order.field, live).at, direction: order.direction }];
  }

  /**
   * Returns the property of a canonical field: taken from the binding, checked against the live
   * schema.
   */
  private propertyAt<T extends CanonicalType>(
    type: T,
    field: FieldOf<T>,
    live: ReadonlyMap<PropertyId, LiveProperty>,
  ): {
    readonly slot: string;
    readonly property: BoundProperty;
    readonly physical: LiveProperty;
    readonly at: string;
  } {
    const bound = this.binding.field(type, field);
    const slot = bound?.slot ?? `${type}.${field}`;
    const property = propertyOf(bound?.carrier);
    if (!property) {
      throw misbound(
        type,
        slot,
        bound?.carrier.kind ?? 'none',
        'a carrier without a property cannot be queried',
      );
    }

    const physical = live.get(property.id);
    if (!physical) {
      throw misbound(
        type,
        slot,
        property.spelled,
        'the live schema carries no property with this id',
      );
    }

    return { slot, property, physical, at: property.spelled };
  }

  /**
   * Returns the option's current name for the binding's option id. The id is the contract, and
   * Notion's filter accepts the name.
   */
  private liveName(
    type: CanonicalType,
    slot: string,
    property: BoundProperty,
    physical: LiveProperty,
    canonical: string,
  ): string {
    const optionId = this.binding
      .optionSet(slot)
      ?.canonical.find(([name]) => name === canonical)?.[1];
    if (!optionId) {
      throw misbound(type, slot, property.spelled, `the mapping names no option for ${canonical}`);
    }

    const name = physical.optionNames?.get(optionId);
    if (name === undefined) {
      throw misbound(type, slot, optionId, `option ${canonical} is gone from the live schema`);
    }

    return name;
  }
}

function expectType(
  type: CanonicalType,
  slot: string,
  named: string,
  physical: LiveProperty,
  expected: string,
): void {
  if (physical.type !== expected) {
    throw misbound(
      type,
      slot,
      named,
      `a ${physical.type} property cannot be queried as ${expected}`,
    );
  }
}

function misbound(
  type: CanonicalType,
  slot: string,
  named: string,
  detail: string,
): AdapterConfigurationError {
  return new AdapterConfigurationError(type, [{ slot, named, detail }]);
}
