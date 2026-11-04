import { OptionEntry, OptionSet } from '../binding/binding';
import { PageProperty } from '../client/page';
import { Read, Reading } from './reading';
import { Slot, SlotResult } from './slot-result';

/**
 * The shapes of the payloads are derived from the union itself, not imported by name, because the
 * SDK does not export all of them. Relying on a name would break where relying on the structure
 * does not.
 */
type PayloadOf<K extends PageProperty['type'], F extends string> =
  Extract<PageProperty, { type: K }> extends Record<F, infer V> ? V : never;

type TextRuns = PayloadOf<'rich_text', 'rich_text'>;
type FormulaValue = PayloadOf<'formula', 'formula'>;
type RollupValue = PayloadOf<'rollup', 'rollup'>;
type DateValue = NonNullable<PayloadOf<'date', 'date'>>;
type OptionValue = NonNullable<PayloadOf<'status', 'status'>>;

/**
 * Reads a physical property as a canonical value.
 *
 * Parsing is driven by the property's **physical type**: it says which shape the value has. The
 * property does not prove that the slot needs this shape, so whoever consumes the value checks
 * the slot's need against the value's tag.
 *
 * `named` is the ID as it is written in the binding file. The person fixes a binding error in the
 * file, so the error has to use the file's wording.
 *
 * The `default` branch covers the rest of Notion's list of types, such as numbers and people. There
 * is no need to list them, because they have no canonical value and a binding that points at them
 * is a binding error.
 */
export function decodeProperty(
  slot: string,
  property: PageProperty,
  optionSet: OptionSet | undefined,
  named: string,
): SlotResult {
  switch (property.type) {
    case 'title':
      return Slot.read(text(property.title));

    case 'rich_text':
      return Slot.read(text(property.rich_text));

    case 'status':
      return decodeOption(slot, named, property.type, property.status, optionSet);

    case 'select':
      return decodeOption(slot, named, property.type, property.select, optionSet);

    case 'date':
      return Slot.read(date(property.date));

    case 'created_time':
      return Slot.read(timestamp(property.created_time));

    case 'last_edited_time':
      return Slot.read(timestamp(property.last_edited_time));

    case 'formula':
      return formula(slot, named, property.formula);

    case 'rollup':
      return rollup(slot, named, property.rollup);

    case 'relation':
      // An empty list is a value, not an absence: the carrier exists, there are no relations.
      // `absent` here would mean there is nothing to link to.
      return Slot.read(
        Read.value({
          type: 'links',
          pageIds: property.relation.map(({ id }) => id),
          truncated: property.has_more === true,
        }),
      );

    default:
      return Slot.misbound(slot, named, `a ${property.type} property carries no canonical value`);
  }
}

/** Reads a value computed by the workspace as is, because the contract says what it means. */
function formula(slot: string, propertyId: string, value: FormulaValue): SlotResult {
  switch (value.type) {
    case 'string':
      return Slot.read(value.string === null ? Read.empty() : textOf(value.string));

    case 'number':
      return Slot.read(
        value.number === null ? Read.empty() : Read.value({ type: 'number', number: value.number }),
      );

    case 'boolean':
      return Slot.read(
        value.boolean === null ? Read.empty() : Read.value({ type: 'flag', flag: value.boolean }),
      );

    case 'date':
      return Slot.read(date(value.date));

    default:
      return Slot.misbound(
        slot,
        propertyId,
        `a ${value.type} formula result cannot be read through the API`,
      );
  }
}

function rollup(slot: string, propertyId: string, value: RollupValue): SlotResult {
  switch (value.type) {
    case 'number':
      return Slot.read(
        value.number === null ? Read.empty() : Read.value({ type: 'number', number: value.number }),
      );

    case 'date':
      return Slot.read(date(value.date));

    default:
      return Slot.misbound(
        slot,
        propertyId,
        `a ${value.type} rollup cannot be read through the API`,
      );
  }
}

function text(runs: TextRuns): Reading {
  return textOf(runs.map((run) => run.plain_text).join(''));
}

function textOf(joined: string): Reading {
  return joined.trim().length > 0 ? Read.value({ type: 'text', text: joined }) : Read.empty();
}

function date(value: DateValue | null): Reading {
  return value
    ? Read.value({ type: 'date', start: value.start, end: value.end, timeZone: value.time_zone })
    : Read.empty();
}

/** Reads a creation or edit time. These times have no time zone: they are instants in UTC. */
function timestamp(at: string): Reading {
  return Read.value({ type: 'date', start: at, end: null, timeZone: null });
}

/**
 * Recognizes the value **by option id**. The display name and the Notion group are not the
 * contract: the former gets renamed, the latter has no semantics.
 */
function decodeOption(
  slot: string,
  propertyId: string,
  propertyType: string,
  chosen: OptionValue | null,
  optionSet: OptionSet | undefined,
): SlotResult {
  if (!optionSet) {
    return Slot.misbound(
      slot,
      propertyId,
      `a ${propertyType} property needs a bound option set, and the mapping declares none for this slot`,
    );
  }

  if (!chosen) return Slot.read(Read.empty());

  const canonical = nameOf(optionSet.canonical, chosen.id);
  if (canonical) {
    return Slot.read(Read.value({ type: 'option', option: canonical }));
  }

  const registered = nameOf(optionSet.knownNonCanonical, chosen.id);
  if (registered) {
    return Slot.read(Read.nonCanonical(registered));
  }

  return Slot.read(Read.gap(slot, `${chosen.name} (${chosen.id})`));
}

function nameOf(entries: readonly OptionEntry[], optionId: string): string | undefined {
  return entries.find(([, id]) => id === optionId)?.[0];
}
