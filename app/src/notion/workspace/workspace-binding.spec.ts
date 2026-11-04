import { parse } from 'yaml';
import {
  namedStatusProperty,
  plainProperty,
  type LivePropertyConfig,
} from '../../../test/fixtures/notion-data-source.fixture';
import { VALID_BINDING_FILE } from '../../../test/fixtures/notion-mapping.fixture';
import {
  formulaOf,
  relationTo,
  titledDataSource,
} from '../../../test/fixtures/notion-workspace.fixture';
import {
  bindingFileSchema,
  type BindingFile,
  type CanonicalType,
  type Representation,
} from '../binding/binding.schema';
import { loadBinding } from '../binding/load-binding';
import { propertyIdFromBinding, propertyIdFromNotion } from '../client/property-id';
import { generateBinding } from './workspace-binding';
import type { NamedBinding, NamedRepresentation } from './workspace-contract';
import { workspaceOf, type Workspace } from './workspace-schema';

/**
 * An id in the live workspace. The `title` property always has the id `title`, as in any
 * workspace.
 */
const liveId = (id: string): string => (id === 'title' ? id : `${id}~live`);

/**
 * Names in the live workspace: a property is named after its id, a database after the id of its
 * data source.
 */
const propertyName = (property: string): string => `property ${decodeURIComponent(property)}`;
const databaseName = (dataSource: string): string => `base ${dataSource}`;

/** The data source that traversals lead to: in the world they have to lead somewhere. */
const ELSEWHERE = 'ds_elsewhere';

/**
 * Builds a live workspace in which every slot of the binding exists. A property is named after its
 * id, a database after the id of its data source. The ids of this workspace are the binding's ids
 * mapped through `liveId`.
 */
function workspaceFor(file: BindingFile, formulas = '1'): Workspace {
  const id = liveId;
  const bases = new Map<string, Map<string, LivePropertyConfig>>();
  const base = (dataSource: string): Map<string, LivePropertyConfig> => {
    const known = bases.get(dataSource) ?? new Map<string, LivePropertyConfig>();

    bases.set(dataSource, known);

    return known;
  };
  const put = (dataSource: string, property: string, config: LivePropertyConfig): void => {
    base(dataSource).set(property, config);
  };
  const name = propertyName;
  const options = optionIdsOf(file);
  const dataSources = new Map(Object.entries(file.data_sources));

  base(ELSEWHERE);

  for (const [type, slots] of Object.entries(file.fields)) {
    const dataSource = dataSources.get(type) ?? type;

    for (const [field, representation] of Object.entries(slots)) {
      const slot: Representation = representation;
      const set = options.get(`${type}.${field}`);

      if (slot.kind === 'native') {
        put(
          dataSource,
          slot.propertyId,
          slot.propertyId === 'title'
            ? plainProperty('title', name('title'), 'title')
            : set
              ? namedStatusProperty(
                  id(slot.propertyId),
                  name(slot.propertyId),
                  Object.fromEntries(set.map((option) => [id(option), option])),
                )
              : plainProperty(id(slot.propertyId), name(slot.propertyId), 'date'),
        );
      }

      if (slot.kind === 'relation') {
        const synced = slot.syncedPropertyId;

        put(
          dataSource,
          slot.propertyId,
          relationTo(
            id(slot.propertyId),
            name(slot.propertyId),
            id(slot.dataSourceId),
            synced && name(synced),
          ),
        );
        if (synced) {
          put(
            slot.dataSourceId,
            synced,
            relationTo(id(synced), name(synced), id(dataSource), name(slot.propertyId)),
          );
        }
      }

      if (slot.kind === 'traversed') {
        put(dataSource, slot.via, relationTo(id(slot.via), name(slot.via), id(ELSEWHERE)));
      }
    }
  }

  for (const [slot, property] of Object.entries(file.signals ?? {})) {
    const dataSource = dataSources.get(slot.split('.')[0]) ?? slot;

    put(dataSource, property, formulaOf(id(property), name(property), formulas));
  }

  return workspaceOf(
    new Map(
      [...bases].map(([dataSource, properties]) => [
        id(dataSource),
        titledDataSource(id(dataSource), databaseName(dataSource), [...properties.values()]),
      ]),
    ),
  );
}

/** The option groups of one set: `canonical` and `known_non_canonical`, name → option id. */
type OptionGroups = Readonly<
  Record<string, Readonly<Record<string, string | undefined>> | undefined>
>;

/** Returns the option ids of each set. An option's name is its id, so the name identifies it. */
function optionIdsOf(file: BindingFile): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const [slot, sets] of Object.entries<OptionGroups | undefined>(file.options)) {
    for (const set of Object.values(sets ?? {})) {
      for (const option of Object.values(set ?? {})) {
        if (option !== undefined) found.set(slot, [...(found.get(slot) ?? []), option]);
      }
    }
  }

  return found;
}

/** Returns the binding with its ids replaced by the names `workspaceFor` knows them by. */
function namedFrom(file: BindingFile): NamedBinding {
  const named = (representation: Representation): NamedRepresentation => {
    switch (representation.kind) {
      case 'native':
        return { kind: 'native', property: propertyName(representation.propertyId) };
      case 'relation':
        return {
          kind: 'relation',
          twoWay: representation.twoWay,
          property: propertyName(representation.propertyId),
          database: databaseName(representation.dataSourceId),
          ...(representation.syncedPropertyId === undefined
            ? {}
            : { syncedProperty: propertyName(representation.syncedPropertyId) }),
        };
      case 'traversed':
        return {
          kind: 'traversed',
          rule: representation.rule,
          via: propertyName(representation.via),
        };
      default:
        return representation;
    }
  };

  const fieldsOf = (type: CanonicalType): Record<string, NamedRepresentation> =>
    Object.fromEntries(
      Object.entries<Representation>(file.fields[type]).map(([field, representation]) => [
        field,
        named(representation),
      ]),
    );
  const byType = <V>(make: (type: CanonicalType) => V): Record<CanonicalType, V> => ({
    identity: make('identity'),
    area_of_focus: make('area_of_focus'),
    objective: make('objective'),
    key_result: make('key_result'),
    project: make('project'),
    behavior_system: make('behavior_system'),
    task: make('task'),
    inbox_item: make('inbox_item'),
  });
  const defined = (
    set: Readonly<Record<string, string | undefined>> = {},
  ): Record<string, string> =>
    Object.fromEntries(
      Object.entries(set).flatMap(([key, id]) => (id === undefined ? [] : [[key, id]])),
    );

  return {
    data_sources: byType((type) => databaseName(file.data_sources[type])),
    fields: byType(fieldsOf),
    options: Object.fromEntries(
      Object.entries<OptionGroups | undefined>(file.options).map(([slot, sets]) => [
        slot,
        {
          canonical: defined(sets?.canonical),
          ...(sets?.known_non_canonical
            ? { known_non_canonical: defined(sets.known_non_canonical) }
            : {}),
        },
      ]),
    ),
    signals: Object.fromEntries(
      Object.entries(file.signals ?? {}).map(([slot, property]) => [slot, propertyName(property)]),
    ),
  };
}

/** Returns the same binding with live-workspace ids in every slot that has an id. */
function translated(file: BindingFile, workspace: string): unknown {
  const each = <T, U>(record: Readonly<Record<string, T>>, map: (value: T) => U) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]));
  const slot = (representation: Representation): Representation => {
    switch (representation.kind) {
      case 'native':
        return { ...representation, propertyId: liveId(representation.propertyId) };
      case 'relation':
        return {
          ...representation,
          propertyId: liveId(representation.propertyId),
          dataSourceId: liveId(representation.dataSourceId),
          ...(representation.syncedPropertyId && {
            syncedPropertyId: liveId(representation.syncedPropertyId),
          }),
        };
      case 'traversed':
        return { ...representation, via: liveId(representation.via) };
      default:
        return representation;
    }
  };

  const ids = (set: Readonly<Record<string, string | undefined>>) =>
    Object.fromEntries(
      Object.entries(set).flatMap(([key, id]) => (id === undefined ? [] : [[key, liveId(id)]])),
    );

  return {
    workspace,
    data_sources: ids(file.data_sources),
    fields: each(file.fields, (slots: Readonly<Record<string, Representation>>) =>
      each(slots, slot),
    ),
    options: Object.fromEntries(
      Object.entries<OptionGroups | undefined>(file.options).map(([key, sets]) => [
        key,
        Object.fromEntries(
          Object.entries(sets ?? {}).map(([group, set]) => [group, ids(set ?? {})]),
        ),
      ]),
    ),
    signals: ids(file.signals ?? {}),
  };
}

const COMMAND = 'notion build';

describe('the binding by names', () => {
  const named = namedFrom(VALID_BINDING_FILE);
  const live = workspaceFor(VALID_BINDING_FILE);
  const generate = (overrides?: Readonly<Record<string, Representation>>) =>
    generateBinding({ named, live, workspace: 'live-workspace', command: COMMAND, overrides });

  it('turns every name into a live-workspace id while the slots and decisions stay the same', () => {
    const { text, unbound } = generate();

    expect(parse(text)).toEqual(translated(VALID_BINDING_FILE, 'live-workspace'));
    expect(unbound).toEqual([]);
    expect(() => loadBinding(text, 'generated')).not.toThrow();
  });

  it('is marked as generated, so it is not edited by hand', () => {
    expect(generate().text).toMatch(/^# .*\n# Generated by `notion build`/);
  });

  /** The id is written in the form that REST returns, and read through `property-id.ts`. */
  it('a property id is in the REST form, and the binding reads it as the same id', () => {
    const binding = loadBinding(generate().text, 'generated');
    const status = binding.field('task', 'status');
    const live_ = workspaceFor(VALID_BINDING_FILE).get('ds_task~live');
    const wire = live_?.propertyIds.get(propertyName('p_task%7Bstatus'));

    expect(wire).toBe('p_task%7Bstatus~live');
    expect(status?.carrier.kind === 'native' && status.carrier.property.spelled).toBe(wire);
    expect(status?.carrier.kind === 'native' && status.carrier.property.id).toBe(
      propertyIdFromNotion(wire ?? ''),
    );
    expect(propertyIdFromBinding(wire ?? '')).toBe(propertyIdFromNotion(wire ?? ''));
  });

  it('an overridden slot takes the specified representation and the rest of the binding stays the same', () => {
    const override: Representation = { kind: 'native', propertyId: 'live-formula' };
    const fieldsOf = (text: string): BindingFile['fields'] =>
      bindingFileSchema.parse(parse(text)).fields;
    const plain = fieldsOf(generate().text);
    const overridden = fieldsOf(generate({ 'inbox_item.captured_at': override }).text);

    expect(overridden.inbox_item.captured_at).toEqual(override);
    expect({
      ...overridden,
      inbox_item: { ...overridden.inbox_item, captured_at: override },
    }).toEqual({
      ...plain,
      inbox_item: { ...plain.inbox_item, captured_at: override },
    });
  });

  it('refuses a property missing from the live workspace, with its name', () => {
    const missing = workspaceFor({ ...VALID_BINDING_FILE, signals: {} });

    expect(() =>
      generateBinding({ named, live: missing, workspace: 'w', command: COMMAND }),
    ).toThrow(/"property f_task\?blocked" is missing in the workspace/);
  });

  it('keeps a signal with an empty formula out of the binding', () => {
    const { text, unbound } = generateBinding({
      named,
      live: workspaceFor(VALID_BINDING_FILE, ''),
      workspace: 'w',
      command: COMMAND,
    });
    const file = bindingFileSchema.parse(parse(text));

    expect(file.signals).toEqual({});
    expect(unbound).toEqual(Object.keys(VALID_BINDING_FILE.signals ?? {}));
    expect(() => loadBinding(text, 'generated')).not.toThrow();
  });

  it('treats a formula whose expression is only whitespace as empty too', () => {
    const { unbound } = generateBinding({
      named,
      live: workspaceFor(VALID_BINDING_FILE, ' \n '),
      workspace: 'w',
      command: COMMAND,
    });

    expect(unbound).toHaveLength(Object.keys(VALID_BINDING_FILE.signals ?? {}).length);
  });
});
