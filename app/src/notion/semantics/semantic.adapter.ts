import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Binding, BoundField, BoundProperty, Carrier, propertyOf } from '../binding/binding';
import { CanonicalType } from '../binding/binding.schema';
import { LiveProperty } from '../client/live-schema';
import { Page, PageBlock } from '../client/page';
import { PropertyId } from '../client/property-id';
import {
  PhysicalTypes,
  physicalTypes,
  PropertyWrite,
  PropertyWrites,
} from '../client/property-write';
import { AdapterConfigurationError, MisboundSlot } from './adapter.error';
import { TaskStatus } from './canonical-status';
import { CanonicalWrite } from './canonical-write';
import { DecodedRecord, FieldOf, gapsOf } from './decoded-record';
import { decodeProperty } from './property.decoder';
import { encodeProperty } from './property.encoder';
import { Read, Reading } from './reading';
import { Slot, SlotResult } from './slot-result';
import { UnwritableOnPageError } from './unwritable-on-page.error';
import { UnwritableValueError } from './unwritable-value.error';
import { withoutCarrier } from './without-carrier';

const NEXT_ACTION: TaskStatus = 'Next Action';

/**
 * Refusals of the `INV-005` rule say what to do: the model composes the request anew from them.
 */
const PLANNED_DATE_NEXT_ACTION =
  'a planned date makes the task Scheduled, not Next Action with a date — choose Scheduled or drop the date';
const NEXT_ACTION_KEEPS_DATE =
  'the task still carries a planned date, and a Next Action carries none — clear the date in the same change or choose Scheduled';
const DATE_ON_NEXT_ACTION =
  'a planned date makes the task Scheduled, not Next Action with a date — write the status with it';
const DATE_WITHOUT_STATUS =
  'a task created with a planned date names its status: the date means different things in different statuses';

/** Checks whether a write is a write of the `Next Action` status. */
function isNextAction(write: CanonicalWrite): boolean {
  return write.kind === 'option' && write.option === NEXT_ACTION;
}

/** The properties whose change is visible in an event, and the slots whose change is not. */
interface WatchedProperties {
  readonly ids: ReadonlySet<PropertyId>;
  /** Slots without a property carrier: the event does not name a change in them. */
  readonly unwatchable: readonly string[];
}

/**
 * Reads a physical Notion record as a canonical one and encodes a canonical record into a
 * physical one. It is the only reader of the binding outside the binding itself.
 *
 * It keeps no list of identifiers of its own: the contract sets which fields exist through the
 * binding's DTO, and the binding itself sets the values. As a consequence, a property
 * the binding does not name is not read by the adapter at all: `Priority`, `Effort points`,
 * `Days in column` and the rest have no canonical home and do not get one.
 *
 * `INV-003`: what was read is not cached. Every call parses what it was given.
 */
@Injectable()
export class SemanticAdapter implements OnModuleInit {
  private readonly logger = new Logger(SemanticAdapter.name);

  constructor(private readonly binding: Binding) {}

  /**
   * Announces the degradations of this installation once, at startup.
   *
   * The level is informational, not a warning, because the absence of a carrier is a declared
   * decision, not a breakage, and a daily “warn” about it would train people to ignore the
   * warning.
   */
  onModuleInit(): void {
    const absent = withoutCarrier(this.binding);
    if (absent.length === 0) {
      return;
    }

    this.logger.log(
      `${absent.length} canonical semantics have no carrier in this workspace: ` +
        absent.map(({ slot, reason }) => `${slot} (${reason})`).join(', '),
    );
  }

  /**
   * Returns the canonical IDs of the properties that carry the named slots, for comparison with
   * an event.
   *
   * Only property carriers are comparable with an event: `native` and `relation`. The page body
   * and GBrain have no ID at all, and a traversal has an ID that is not its own: it is the ID of
   * the relation being followed, not of the semantic's carrier.
   */
  watchedPropertyIds(slots: readonly string[]): WatchedProperties {
    const carriers = new Map(this.binding.fields.map(({ slot, carrier }) => [slot, carrier]));
    const ids = new Set<PropertyId>();
    const unwatchable: string[] = [];

    for (const slot of slots) {
      const property = propertyOf(carriers.get(slot));

      if (property) ids.add(property.id);
      else unwatchable.push(slot);
    }

    return { ids, unwatchable };
  }

  /** Returns the data source of a canonical type, where the system creates its pages. */
  dataSourceOf(type: CanonicalType): string {
    return this.binding.dataSource(type);
  }

  /**
   * Returns the canonical type whose pages are in the data source; `undefined` means the data
   * source is not canonical.
   */
  typeOfDataSource(dataSourceId: string): CanonicalType | undefined {
    return this.binding.typeOf(dataSourceId);
  }

  /**
   * Returns the data source whose pages the field's relation points to, or `undefined` if the
   * field is not a relation. The result is used to check that a relation the system writes points
   * to the data source its property targets.
   */
  linkTargetOf<T extends CanonicalType>(type: T, field: FieldOf<T>): string | undefined {
    const bound = this.binding.field(type, field);

    return bound?.carrier.kind === 'relation' ? bound.carrier.dataSourceId : undefined;
  }

  /**
   * Encodes the canonical values of a type's fields as the properties of a write request, using
   * the physical types of the live schema (`docs/2-system.md` § “Logical interface of the
   * adapter”). The key is the property id as it is written in the binding, because that is the
   * spelling Notion accepts.
   */
  encode<T extends CanonicalType>(
    type: T,
    writes: Readonly<Partial<Record<FieldOf<T>, CanonicalWrite>>>,
    types: PhysicalTypes,
  ): PropertyWrites {
    const given = Object.entries<CanonicalWrite | undefined>(writes).flatMap(([field, write]) =>
      write ? [[field, write] as const] : [],
    );

    return this.encodeAll(
      type,
      given,
      (field) => {
        const bound = this.binding.field(type, field);
        if (!bound) {
          throw new UnwritableValueError(`${type}.${field}`, 'is not a field of this type');
        }

        return bound;
      },
      types,
      null,
    );
  }

  /**
   * Throws a refusal with a reason if `writes` cannot be written to this page, before the write
   * is made. The encoded result is not needed here; the refusal itself is.
   */
  assertWritable(page: Page, writes: ReadonlyMap<PropertyId, CanonicalWrite>): void {
    this.encodeOn(page, writes);
  }

  /**
   * Encodes the property writes of an existing page in the shape of a request. The field is
   * determined by the page's canonical type, that is, by the data source it is in. A property id
   * alone does not determine the field, because `title` is in every data source. The physical
   * type comes from the page itself, which has just been read. Only a property that carries a
   * canonical field of this type can be written to: a signal or a property without a canonical
   * home takes no writes.
   */
  encodeOn(page: Page, writes: ReadonlyMap<PropertyId, CanonicalWrite>): PropertyWrites {
    const type = this.typeOf(page);

    return this.encodeAll(
      type,
      writes,
      (propertyId) => this.fieldCarriedBy(type, propertyId),
      physicalTypes(page.properties),
      page,
    );
  }

  /**
   * Describes the changes to a page as the workspace shows them: the property name and the option
   * name from the live schema, because the person renames them while the binding keeps ids. The
   * proposal's trail in the thread uses them to tell the person what they approved (ADR 0043). A
   * name the live schema does not supply cannot be taken from anywhere, so the canonical name
   * stays: the name of the field or the option in the model.
   */
  shownOn(
    page: Page,
    live: ReadonlyMap<PropertyId, LiveProperty>,
    writes: ReadonlyMap<PropertyId, CanonicalWrite>,
  ): ShownChange[] {
    const type = this.typeOf(page);

    return [...writes].map(([propertyId, write]) => {
      const bound = this.fieldCarriedBy(type, propertyId);
      const property = live.get(propertyId);

      return {
        field: property?.name ?? bound.field,
        canonical: bound.field,
        value: this.shownValue(bound, property, write),
      };
    });
  }

  private shownValue(
    bound: BoundField,
    property: LiveProperty | undefined,
    write: CanonicalWrite,
  ): ShownValue {
    switch (write.kind) {
      case 'option': {
        const id = this.binding
          .optionSet(bound.slot)
          ?.canonical.find(([name]) => name === write.option)?.[1];
        const name = id === undefined ? undefined : property?.optionNames?.get(id);

        return { kind: 'option', name: name ?? write.option };
      }

      case 'date':
        return { kind: 'date', start: write.start, end: write.end };

      case 'text':
        return { kind: 'text', text: write.text };

      case 'links':
        return { kind: 'links', count: write.pageIds.length };

      case 'clear':
        return { kind: 'clear' };
    }
  }

  /**
   * Reads back a property of the page the system wrote to, to check the write: what was read
   * must equal what was written (`docs/2-system.md` § “System writes to Notion”).
   */
  readBack(page: Page, propertyId: PropertyId): Reading {
    const type = this.typeOf(page);

    return this.readBound(type, this.fieldCarriedBy(type, propertyId), page);
  }

  /**
   * Reads one canonical field of a page by name, without the rest of the record. Whoever needs
   * only the status does not depend on slots they did not ask for: a slot that cannot be read is
   * an `AdapterConfigurationError` only when it is the named field itself.
   *
   * It logs no warnings about gaps in the model: `decode` does that, reading the record whole.
   */
  readField<T extends CanonicalType>(type: T, page: Page, field: FieldOf<T>): Reading {
    const bound = this.binding.field(type, field);
    if (!bound) {
      throw new AdapterConfigurationError(type, [
        { slot: `${type}.${field}`, named: field, detail: 'the mapping binds no such field' },
      ]);
    }

    return this.readBound(type, bound, page);
  }

  /**
   * The body is passed separately because it arrives in a separate request. A body that was not
   * passed yields `unread`, not `absent`, because `unread` and `empty` are different claims.
   */
  decode<T extends CanonicalType>(
    type: T,
    page: Page,
    body?: readonly PageBlock[],
  ): DecodedRecord<T> {
    const readings: Record<string, Reading> = {};
    const signals: Record<string, Reading> = {};
    const misbound: MisboundSlot[] = [];

    for (const { field, slot, carrier } of this.binding.fieldsOf(type)) {
      const result = this.read(slot, carrier, page, body);

      if (result.ok) readings[field] = result.reading;
      else misbound.push(result.problem);
    }

    for (const { slot, property } of this.binding.signalsOf(type)) {
      const result = this.readProperty(slot, property, page);

      if (result.ok) signals[slot.slice(type.length + 1)] = result.reading;
      else misbound.push(result.problem);
    }

    if (misbound.length > 0) throw new AdapterConfigurationError(type, misbound);

    // The keys are exactly the type's fields and signals from the binding, which the strict
    // schema accepted at startup. That is what the record's type states.
    const record = {
      type,
      pageId: page.id,
      lastEditedAt: page.last_edited_time,
      readings,
      signals,
    } as DecodedRecord<T>;

    const gaps = gapsOf(record);
    if (gaps.length > 0) {
      this.logger.warn(
        `Canonical model does not describe ${gaps.length} value(s) on ${type} ${page.id}: ` +
          gaps.map((gap) => `${gap.slot} = ${gap.value}`).join(', '),
      );
    }

    return record;
  }

  /**
   * Encodes the writes of one type in the shape of a request. Each write names the field in its
   * own way, by name or by the property that carries it, so `resolve` finds the field by whatever
   * the write names it with. The rest is shared: a carrier that can be written to, encoding by
   * the physical type and the rules between fields.
   */
  private encodeAll<K>(
    type: CanonicalType,
    writes: Iterable<readonly [K, CanonicalWrite]>,
    resolve: (key: K) => BoundField,
    types: PhysicalTypes,
    page: Page | null,
  ): PropertyWrites {
    const properties: Record<string, PropertyWrite> = {};
    const written = new Map<string, CanonicalWrite>();

    for (const [key, write] of writes) {
      const bound = resolve(key);
      const property = this.writable(bound.slot, bound.carrier);

      properties[property.spelled] = this.encodeInto(type, bound.slot, property, write, types);
      written.set(bound.field, write);
    }

    this.agree(type, written, page);

    return properties;
  }

  /**
   * Checks the write rules that concern several fields together. There is one, `INV-005`:
   * `Next Action` has no `Date`. The result of the write is checked: the status and the date are
   * those the request writes, and what the request does not name is taken from the page. So every
   * path is caught: a date written to a `Next Action` Task, a move into `Next Action` of a Task
   * that keeps its date, and a request that has both.
   *
   * The refusal names the reason. If both halves are in the request, the request is wrong in
   * itself (`UnwritableValueError`). If one of the halves is on the page, the request is wrong
   * only for that page (`UnwritableOnPageError`): were the page different, the answer would be
   * different.
   *
   * The page is asked only when the answer depends on it: a request that removes one of the
   * halves (the date cleared, the status not `Next Action`) cannot violate the rule, and a slot
   * that cannot be read does not get in the request's way. A slot that must be readable and is
   * not is a configuration refusal, not “there is no date”.
   */
  private agree(
    type: CanonicalType,
    written: ReadonlyMap<string, CanonicalWrite>,
    page: Page | null,
  ): void {
    const status = written.get('status');
    const date = written.get('date');

    if (type !== 'task' || (status === undefined && date === undefined)) return;
    if (status !== undefined && !isNextAction(status)) return;
    if (date !== undefined && date.kind !== 'date') return;

    if (status !== undefined && date !== undefined) {
      throw new UnwritableValueError('task.date', PLANNED_DATE_NEXT_ACTION);
    }

    if (status !== undefined) {
      if (page !== null && this.readField('task', page, 'date').state === 'value') {
        throw new UnwritableOnPageError('task.date', NEXT_ACTION_KEEPS_DATE);
      }

      return;
    }

    if (page === null) throw new UnwritableValueError('task.date', DATE_WITHOUT_STATUS);

    const current = this.readField('task', page, 'status');

    if (
      current.state === 'value' &&
      current.value.type === 'option' &&
      current.value.option === NEXT_ACTION
    ) {
      throw new UnwritableOnPageError('task.date', DATE_ON_NEXT_ACTION);
    }
  }

  /** Reads a slot from one page. A slot that cannot be read is a configuration refusal. */
  private readBound(type: CanonicalType, bound: BoundField, page: Page): Reading {
    const result = this.read(bound.slot, bound.carrier, page, undefined);

    if (!result.ok) {
      throw new AdapterConfigurationError(type, [result.problem]);
    }

    return result.reading;
  }

  /** Determines the canonical type of a page by the data source it is in. */
  private typeOf(page: Page): CanonicalType {
    const type = page.dataSourceId === null ? undefined : this.binding.typeOf(page.dataSourceId);
    if (!type) {
      throw new UnwritableValueError(
        `page ${page.id}`,
        'lies in no data source of a canonical type',
      );
    }

    return type;
  }

  /**
   * Returns the field of the type that the property carries. Otherwise the system has nothing to
   * write to the property.
   */
  private fieldCarriedBy(type: CanonicalType, propertyId: PropertyId): BoundField {
    const bound = this.binding.fieldCarrying(type, propertyId);
    if (!bound) {
      throw new UnwritableValueError(
        `${type} ${propertyId}`,
        'the property carries no canonical field of this type',
      );
    }

    return bound;
  }

  /**
   * Returns the property of a carrier that can be written to. Only a property can be written to:
   * a `native` or `relation` carrier.
   */
  private writable(slot: string, carrier: Carrier): BoundProperty {
    const property = propertyOf(carrier);
    if (!property) {
      throw new UnwritableValueError(slot, `a ${carrier.kind} carrier cannot be written`);
    }

    return property;
  }

  /**
   * Encodes by the type from the live schema. A property the schema does not know cannot be
   * written: the binding has diverged from the workspace (`configuration_error`).
   */
  private encodeInto(
    type: CanonicalType,
    slot: string,
    property: BoundProperty,
    write: CanonicalWrite,
    types: PhysicalTypes,
  ): PropertyWrite {
    const physical = types.get(property.id);
    if (!physical) {
      throw new AdapterConfigurationError(type, [
        {
          slot,
          named: property.spelled,
          detail: 'the live schema carries no property with this id',
        },
      ]);
    }

    return encodeProperty(slot, write, physical, this.binding.optionSet(slot));
  }

  private read(
    slot: string,
    carrier: Carrier,
    page: Page,
    body: readonly PageBlock[] | undefined,
  ): SlotResult {
    switch (carrier.kind) {
      case 'native':
        return this.readProperty(slot, carrier.property, page);

      case 'relation':
        return this.readRelation(slot, carrier.property, page);

      case 'page_body':
        return Slot.read(readBody(body));

      case 'traversed':
        return Slot.read(
          Read.unread(`traversal ${carrier.rule} through property ${carrier.via.spelled}`),
        );

      case 'gbrain':
        return Slot.read(Read.unread('GBrain anchor of this record'));

      case 'absent':
        return Slot.read(Read.absent(carrier.reason));
    }
  }

  private readProperty(slot: string, bound: BoundProperty, page: Page): SlotResult {
    const property = page.properties.get(bound.id);
    if (!property) {
      return missing(slot, bound);
    }

    return decodeProperty(slot, property, this.binding.optionSet(slot), bound.spelled);
  }

  private readRelation(slot: string, bound: BoundProperty, page: Page): SlotResult {
    const property = page.properties.get(bound.id);
    if (!property) {
      return missing(slot, bound);
    }

    if (property.type !== 'relation') {
      return Slot.misbound(
        slot,
        bound.spelled,
        `the mapping binds this slot as a relation, and the property is ${property.type}`,
      );
    }

    return decodeProperty(slot, property, undefined, bound.spelled);
  }
}

function missing(slot: string, bound: BoundProperty): SlotResult {
  return Slot.misbound(slot, bound.spelled, 'the page carries no property with this id');
}

function readBody(body: readonly PageBlock[] | undefined): Reading {
  if (body === undefined) return Read.unread('page body');

  return body.length > 0 ? Read.value({ type: 'prose', blocks: body }) : Read.empty();
}

/** A change's value as the proposal's trail shows it to the person. */
export type ShownValue =
  | { readonly kind: 'option'; readonly name: string }
  | { readonly kind: 'date'; readonly start: string; readonly end: string | null }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'links'; readonly count: number }
  | { readonly kind: 'clear' };

/** The change of one property: the name the workspace shows, and the value. */
export interface ShownChange {
  /** The property name from the workspace. */
  readonly field: string;
  /**
   * The canonical name of the field (`status`): the texts addressed to the person use it to refer
   * to the field with a word in the person's language (ADR 0046).
   */
  readonly canonical: string;
  readonly value: ShownValue;
}
