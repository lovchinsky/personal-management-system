import { Binding } from '../../src/notion/binding/binding';
import { CANONICAL_TYPES } from '../../src/notion/binding/binding.schema';
import { LiveProperty } from '../../src/notion/client/live-schema';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { PropertyId } from '../../src/notion/client/property-id';
import type { LiveSchemas } from '../../src/notion/semantics/schema-mapping';

/**
 * Builds a live schema that has every property and every option the binding names: carriers,
 * synced sides of relations, traversal properties and signals. The name of a property or the label
 * of an option is `named(id)`.
 */
export function liveSchemasOf(binding: Binding, named: (id: string) => string): LiveSchemas {
  const schemas = new Map<string, Map<PropertyId, LiveProperty>>();

  const put = (dataSourceId: string, id: PropertyId, optionIds: readonly string[] = []): void => {
    const properties =
      schemas.get(canonicalNotionId(dataSourceId)) ?? new Map<PropertyId, LiveProperty>();
    const options = [...(properties.get(id)?.options ?? []), ...optionIds];

    properties.set(id, {
      type: options.length > 0 ? 'status' : 'relation',
      name: named(id),
      ...(options.length > 0
        ? {
            options,
            optionNames: new Map(
              options.map((option): [string, string] => [option, named(option)]),
            ),
          }
        : {}),
    });
    schemas.set(canonicalNotionId(dataSourceId), properties);
  };

  for (const type of CANONICAL_TYPES) {
    const dataSourceId = binding.dataSource(type);

    for (const { slot, carrier } of binding.fieldsOf(type)) {
      const set = binding.optionSet(slot);
      const optionIds = set ? [...set.canonical, ...set.knownNonCanonical].map(([, id]) => id) : [];

      if (carrier.kind === 'native' || carrier.kind === 'relation') {
        put(dataSourceId, carrier.property.id, optionIds);
      }
      if (carrier.kind === 'relation' && carrier.synced) {
        put(carrier.dataSourceId, carrier.synced.id);
      }
      if (carrier.kind === 'traversed') put(dataSourceId, carrier.via.id);
    }

    for (const { property } of binding.signalsOf(type)) put(dataSourceId, property.id);
  }

  return schemas;
}
