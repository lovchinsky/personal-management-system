import { canonicalNotionId } from '../client/notion-id';
import { PropertyId, propertyIdFromBinding, propertyIdFromCanonical } from '../client/property-id';
import { BindingError } from './binding.error';
import {
  BindingFile,
  bindingFileSchema,
  CANONICAL_TYPES,
  CanonicalType,
  Representation,
  SIGNAL_SLOTS,
  SignalSlot,
} from './binding.schema';

/** A property named by the binding. */
export interface BoundProperty {
  /** The canonical form: properties are looked up and compared by it. */
  readonly id: PropertyId;
  /** How the ID is written in the file: a binding error refers to it as the file spells it. */
  readonly spelled: string;
}

/** What represents a canonical semantic in this workspace. */
export type Carrier =
  | { readonly kind: 'native'; readonly property: BoundProperty }
  | {
      readonly kind: 'relation';
      readonly property: BoundProperty;
      readonly dataSourceId: string;
      readonly twoWay: boolean;
      readonly synced?: BoundProperty;
    }
  | { readonly kind: 'traversed'; readonly via: BoundProperty; readonly rule: string }
  | { readonly kind: 'page_body' }
  | { readonly kind: 'gbrain' }
  | { readonly kind: 'absent'; readonly reason: string };

/**
 * Returns the property that carries the semantic. Carriers `native` and `relation` have one; the
 * other carriers have no property. The `via` of a traversal deliberately shares its ID with the
 * relation, and `synced` lives in another data source, so neither of them is the property that
 * carries the semantic.
 */
export function propertyOf(carrier: Carrier | undefined): BoundProperty | undefined {
  return carrier?.kind === 'native' || carrier?.kind === 'relation' ? carrier.property : undefined;
}

export interface BoundField {
  readonly type: CanonicalType;
  /** The field's name within the type: `deadline`. */
  readonly field: string;
  /** The full name of the slot: `task.deadline`. Errors refer to the slot by the same name. */
  readonly slot: string;
  readonly carrier: Carrier;
}

interface BoundSignal {
  readonly type: CanonicalType;
  readonly slot: SignalSlot;
  readonly property: BoundProperty;
}

/** A pair “canonical name → option id”. */
export type OptionEntry = readonly [name: string, optionId: string];

/**
 * A slot's option ids in a form suited to lookup **by id**.
 *
 * Lookup is by id, not by name, because the option id is a contract, while a display name is
 * renamed in the UI with no trace in the schema.
 */
export interface OptionSet {
  readonly canonical: readonly OptionEntry[];
  readonly knownNonCanonical: readonly OptionEntry[];
}

/**
 * The binding, read once. Its IDs are already canonical, and after this point it can be read only
 * in canonical form. The file format remains the schema's job (`binding.schema.ts`).
 *
 * The class is only a DI token, because an interface does not exist at runtime. `bindingOf` builds
 * the instance, and whoever received the token reads it. The binding is read once at startup. An
 * App that does not know which database is `Task` will do nothing useful, so failing here is
 * better than working blind.
 */
export abstract class Binding {
  /** All fields of all types, in binding order. */
  abstract readonly fields: readonly BoundField[];
  abstract readonly signals: readonly BoundSignal[];
  abstract fieldsOf(type: CanonicalType): readonly BoundField[];
  /** Returns a type's field by name; `undefined` means the type has no such field. */
  abstract field(type: CanonicalType, name: string): BoundField | undefined;
  /**
   * Returns the field of the type that the property carries; the comparison is by canonical ID.
   * `undefined` means the property carries no canonical field of this type.
   */
  abstract fieldCarrying(type: CanonicalType, propertyId: PropertyId): BoundField | undefined;
  abstract signalsOf(type: CanonicalType): readonly BoundSignal[];
  abstract dataSource(type: CanonicalType): string;
  /** Returns the type whose pages live in this data source, whatever form the id is given in. */
  abstract typeOf(dataSourceId: string): CanonicalType | undefined;
  abstract optionSet(slot: string): OptionSet | undefined;
}

/** Slots that have an option id set: the keys of the schema's `options` block. */
const OPTION_SET_SLOTS: readonly string[] = bindingFileSchema.shape.options.keyof().options;

/** The option ids of one set, as the file lists them. */
interface OptionIds {
  readonly canonical: Readonly<Record<string, string>>;
  readonly known_non_canonical?: Readonly<Record<string, string | undefined>>;
}

/**
 * Builds the binding from a file the schema accepted, or refuses that file with the full list of
 * problems.
 *
 * `bindingOf` checks what the format check does not see. An ID must decode. Two fields of one type
 * cannot name the same property once the IDs are in canonical form (the schema compares
 * spellings, so it lets `K%7BhG` and `K{hG` through as different). Rules that span blocks of the
 * file (the option id set, the data source) belong to the model, not to the form.
 */
export function bindingOf(file: BindingFile, origin: string): Binding {
  const problems: string[] = [];

  const bound = (spelled: string, at: string): BoundProperty => {
    const id = propertyIdFromBinding(spelled);
    if (id === null) {
      problems.push(`${at} :: property id ${spelled} is not valid percent-encoding`);
    }

    // A malformed ID only goes into the list of problems, and a binding with it is not returned.
    return { id: id ?? propertyIdFromCanonical(spelled), spelled };
  };

  const fields = CANONICAL_TYPES.flatMap((type) => {
    const slots: Readonly<Record<string, Representation>> = file.fields[type];

    return Object.entries(slots).map(([field, representation]): BoundField => {
      const slot = `${type}.${field}`;

      return { type, field, slot, carrier: carrierOf(representation, slot, bound) };
    });
  });

  const signals = CANONICAL_TYPES.flatMap((type) =>
    SIGNAL_SLOTS.filter((slot) => slot.startsWith(`${type}.`)).flatMap((slot) => {
      const spelled = file.signals?.[slot];

      return spelled === undefined
        ? []
        : [{ type, slot, property: bound(spelled, slot) } satisfies BoundSignal];
    }),
  );

  const optionSets = optionSetsOf(file.options);

  problems.push(
    ...unmatchedOptionSets(fields, optionSets),
    ...sharedOptionIds(optionSets),
    ...sharedProperties(fields),
  );

  const types = typesByDataSource(file.data_sources, problems);

  if (problems.length > 0) throw new BindingError(origin, problems);

  return {
    fields,
    signals,
    fieldsOf: (type) => fields.filter((field) => field.type === type),
    field: (type, name) => fields.find((field) => field.type === type && field.field === name),
    fieldCarrying: (type, propertyId) =>
      fields.find((field) => field.type === type && propertyOf(field.carrier)?.id === propertyId),
    signalsOf: (type) => signals.filter((signal) => signal.type === type),
    dataSource: (type) => file.data_sources[type],
    typeOf: (dataSourceId) => types.get(canonicalNotionId(dataSourceId)),
    optionSet: (slot) => optionSets.get(slot),
  };
}

/** Builds the option id sets of the slots the file filled in, in slot order. */
function optionSetsOf(
  options: Readonly<Record<string, OptionIds | undefined>>,
): ReadonlyMap<string, OptionSet> {
  return new Map(
    OPTION_SET_SLOTS.flatMap((slot) => {
      const ids = options[slot];

      return ids === undefined
        ? []
        : [
            [
              slot,
              {
                canonical: Object.entries(ids.canonical),
                knownNonCanonical: Object.entries(ids.known_non_canonical ?? {}).flatMap(
                  ([name, id]): OptionEntry[] => (id === undefined ? [] : [[name, id]]),
                ),
              },
            ] as const,
          ];
    }),
  );
}

/**
 * Checks that an option id set exists if and only if the field is bound as `native`.
 *
 * For `page_body` the value is recognized by the section's text, not by id, so a filled-in set
 * would assert something the schema does not have. For `native`, conversely, reading the status is
 * impossible without ids, because Notion maps them only per option id.
 */
function unmatchedOptionSets(
  fields: readonly BoundField[],
  optionSets: ReadonlyMap<string, OptionSet>,
): string[] {
  return OPTION_SET_SLOTS.flatMap((slot) => {
    const kind = fields.find((field) => field.slot === slot)?.carrier.kind;
    const present = optionSets.has(slot);

    if (kind === 'native' && !present) {
      return [`options :: ${slot} is bound as native and needs its option ids`];
    }

    if (kind !== 'native' && present) {
      return [`options :: ${slot} is bound as ${kind} and has no option ids`];
    }

    return [];
  });
}

/** One option id under two values makes them indistinguishable on read. */
function sharedOptionIds(optionSets: ReadonlyMap<string, OptionSet>): string[] {
  const problems: string[] = [];

  for (const [slot, { canonical, knownNonCanonical }] of optionSets) {
    const owners = new Map<string, string>();

    for (const [value, id] of [...canonical, ...knownNonCanonical]) {
      const owner = owners.get(id);

      if (owner === undefined) owners.set(id, value);
      else problems.push(`options :: ${slot}: option ${id} stands for both ${owner} and ${value}`);
    }
  }

  return problems;
}

/**
 * Maps each data source to its canonical type. A page belongs to a type by where it lives, so a
 * data source shared by two types leaves the type of each of its pages undetermined, and a
 * binding with it is not accepted.
 */
function typesByDataSource(
  dataSources: BindingFile['data_sources'],
  problems: string[],
): ReadonlyMap<string, CanonicalType> {
  const types = new Map<string, CanonicalType>();

  for (const type of CANONICAL_TYPES) {
    const dataSourceId = dataSources[type];
    const id = canonicalNotionId(dataSourceId);
    const bound = types.get(id);

    if (bound) {
      problems.push(
        `data_sources.${type} :: data source ${dataSourceId} is already bound to ${bound} — ` +
          'a page belongs to one canonical type by the data source it lies in',
      );
    } else {
      types.set(id, type);
    }
  }

  return types;
}

function carrierOf(
  representation: Representation,
  slot: string,
  bound: (spelled: string, at: string) => BoundProperty,
): Carrier {
  switch (representation.kind) {
    case 'native':
      return { kind: 'native', property: bound(representation.propertyId, slot) };
    case 'relation':
      return {
        kind: 'relation',
        property: bound(representation.propertyId, slot),
        dataSourceId: representation.dataSourceId,
        twoWay: representation.twoWay,
        ...(representation.syncedPropertyId === undefined
          ? {}
          : { synced: bound(representation.syncedPropertyId, `${slot}.syncedPropertyId`) }),
      };
    case 'traversed':
      return {
        kind: 'traversed',
        via: bound(representation.via, `${slot}.via`),
        rule: representation.rule,
      };
    case 'page_body':
      return { kind: 'page_body' };
    case 'gbrain':
      return { kind: 'gbrain' };
    case 'absent':
      return { kind: 'absent', reason: representation.reason };
  }
}

/**
 * Reports two fields of one type that name the same property in canonical form.
 *
 * Two canonical semantics on one property would mean that writing one silently erases the other:
 * one property carries one semantic (ADR 0010). Canonical IDs are compared, so the comparison does
 * not depend on spelling.
 */
function sharedProperties(fields: readonly BoundField[]): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];

  for (const { type, slot, carrier } of fields) {
    const property = propertyOf(carrier);
    if (!property) {
      continue;
    }

    const key = `${type}:${property.id}`;
    const other = seen.get(key);

    if (other === undefined) seen.set(key, slot);
    else {
      problems.push(`${slot} :: names the same property as ${other} (${property.spelled})`);
    }
  }

  return problems;
}
