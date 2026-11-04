import { Binding, BoundField, BoundProperty, Carrier, propertyOf } from '../binding/binding';
import { CANONICAL_TYPES, CanonicalType } from '../binding/binding.schema';
import type { LiveProperty } from '../client/live-schema';
import { canonicalNotionId } from '../client/notion-id';
import type { PropertyId } from '../client/property-id';

/**
 * The longest name or label the response includes. This limit bounds the size of the response
 * independently of the workspace (`INV-303`). The response includes nothing longer, and the model
 * will not match a field whose name is longer.
 */
export const MAX_NAME_CHARS = 100;

/**
 * The properties of the data sources as they currently are in the workspace, keyed by canonical
 * data source id.
 */
export type LiveSchemas = ReadonlyMap<string, ReadonlyMap<PropertyId, LiveProperty>>;

/**
 * The carrier of a semantic on the App MCP wire: the same kinds as in the binding, with wire names
 * and canonical IDs only. The spelling from the binding file does not appear here, because it is a
 * detail of the format. A model that saw an encoded ID would compose a proposal with it, and the
 * input would reject the proposal. Each property ID has its name next to it.
 */
type CarrierWire =
  | { readonly kind: 'native'; readonly property_id: string; readonly name?: string }
  | {
      readonly kind: 'relation';
      readonly property_id: string;
      readonly name?: string;
      readonly data_source_id: string;
      readonly two_way: boolean;
      readonly synced_property_id?: string;
      readonly synced_name?: string;
    }
  | {
      readonly kind: 'traversed';
      readonly via: string;
      readonly via_name?: string;
      readonly rule: string;
    }
  | { readonly kind: 'page_body' }
  | { readonly kind: 'gbrain' }
  | { readonly kind: 'absent'; readonly reason: string };

/**
 * A slot's set of option ids (the canonical names and the known but non-canonical ones) and the
 * option labels.
 */
interface OptionsWire {
  readonly canonical: Readonly<Record<string, string>>;
  readonly known_non_canonical: Readonly<Record<string, string>>;
  /** An option name from the sets above → the label the workspace currently shows. */
  readonly labels: Readonly<Record<string, string>>;
}

export interface SemanticWire {
  readonly slot: string;
  readonly carrier: CarrierWire;
  readonly options?: OptionsWire;
}

interface SignalWire {
  readonly slot: string;
  readonly property_id: string;
  readonly name?: string;
}

interface MappedTypeWire {
  readonly type: CanonicalType;
  readonly data_source_id: string;
  readonly semantics: readonly SemanticWire[];
  readonly signals: readonly SignalWire[];
}

/**
 * The installation's mapping as the model sees it (`get_schema_mapping`): the data source of each
 * type, the carrier of each canonical semantic, option ids and signals. The IDs are canonical
 * (`docs/2-system.md` § “App MCP”), and next to each property and option ID is the name the
 * workspace currently shows (`INV-038`). The Notion MCP refers to properties and options by name,
 * and the binding refers to them by ID. A name only leads to the carrier and holds no value. A
 * property the live schema does not have stays without a name.
 *
 * The capability is not part of the mapping, because for prose semantics it is visible only when
 * a specific record is read (`INV-002`). The size is bounded by the binding and `MAX_NAME_CHARS`,
 * not by the workspace: however many pages there are, the response is the same.
 */
export interface SchemaMappingWire {
  readonly types: readonly MappedTypeWire[];
}

export function schemaMappingOf(binding: Binding, live: LiveSchemas): SchemaMappingWire {
  return {
    types: CANONICAL_TYPES.map((type) => {
      const dataSourceId = binding.dataSource(type);
      const names = new LiveNames(live, dataSourceId);

      return {
        type,
        data_source_id: dataSourceId,
        semantics: binding.fieldsOf(type).map((field) => semanticOf(binding, field, names)),
        signals: binding.signalsOf(type).map(({ slot, property }) => ({
          slot,
          property_id: property.id,
          ...named(names.of(property)),
        })),
      };
    }),
  };
}

/**
 * The property names and option labels of one data source and of the data sources related to it.
 */
class LiveNames {
  constructor(
    private readonly live: LiveSchemas,
    private readonly dataSourceId: string,
  ) {}

  of(property: BoundProperty, dataSourceId = this.dataSourceId): string | undefined {
    return within(this.property(property, dataSourceId)?.name);
  }

  label(property: BoundProperty, optionId: string): string | undefined {
    return within(this.property(property, this.dataSourceId)?.optionNames?.get(optionId));
  }

  private property(property: BoundProperty, dataSourceId: string): LiveProperty | undefined {
    return this.live.get(canonicalNotionId(dataSourceId))?.get(property.id);
  }
}

function within(name: string | undefined): string | undefined {
  return name !== undefined && name.length <= MAX_NAME_CHARS ? name : undefined;
}

function named(name: string | undefined): { readonly name?: string } {
  return name === undefined ? {} : { name };
}

function semanticOf(
  binding: Binding,
  { slot, carrier }: BoundField,
  names: LiveNames,
): SemanticWire {
  const options = binding.optionSet(slot);
  const property = propertyOf(carrier);

  return {
    slot,
    carrier: carrierWireOf(carrier, names),
    ...(options
      ? {
          options: {
            canonical: Object.fromEntries(options.canonical),
            known_non_canonical: Object.fromEntries(options.knownNonCanonical),
            labels: Object.fromEntries(
              [...options.canonical, ...options.knownNonCanonical].flatMap(([name, optionId]) => {
                const label = property && names.label(property, optionId);

                return label === undefined ? [] : [[name, label]];
              }),
            ),
          },
        }
      : {}),
  };
}

function carrierWireOf(carrier: Carrier, names: LiveNames): CarrierWire {
  switch (carrier.kind) {
    case 'native':
      return {
        kind: 'native',
        property_id: carrier.property.id,
        ...named(names.of(carrier.property)),
      };

    case 'relation': {
      const syncedName = carrier.synced && names.of(carrier.synced, carrier.dataSourceId);

      return {
        kind: 'relation',
        property_id: carrier.property.id,
        ...named(names.of(carrier.property)),
        data_source_id: carrier.dataSourceId,
        two_way: carrier.twoWay,
        ...(carrier.synced
          ? {
              synced_property_id: carrier.synced.id,
              ...(syncedName === undefined ? {} : { synced_name: syncedName }),
            }
          : {}),
      };
    }

    case 'traversed': {
      const viaName = names.of(carrier.via);

      return {
        kind: 'traversed',
        via: carrier.via.id,
        ...(viaName === undefined ? {} : { via_name: viaName }),
        rule: carrier.rule,
      };
    }

    case 'page_body':
    case 'gbrain':
      return { kind: carrier.kind };

    case 'absent':
      return { kind: 'absent', reason: carrier.reason };
  }
}
