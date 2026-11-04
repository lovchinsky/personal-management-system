import { parse } from 'yaml';
import { bindingFileSchema } from '../../src/notion/binding/binding.schema';
import { loadBinding } from '../../src/notion/binding/load-binding';
import { generateBinding } from '../../src/notion/workspace/workspace-binding';
import {
  loadWorkspaceContract,
  type NamedRepresentation,
} from '../../src/notion/workspace/workspace-contract';
import type { DatabaseShape } from '../../src/notion/workspace/workspace-schema';
import { liveWorkspaceOf } from '../fixtures/fake-notion-workspace.fixture';
import { CAPTURE_PROPERTY } from '../gate/workspace/capture-overlay';
import { canonical, repoFile } from './contracts';

const PATH = 'contracts/notion-workspace.yaml';

/**
 * `contracts/notion-workspace.yaml` is the physical Notion schema and the binding of the canonical
 * model to it by name (ADR 0048). The `notion build` command and the gate build the workspace from
 * it, so the file must be consistent with itself and with `contracts/canonical.yaml`: a slot the
 * binding does not name, or a name the schema does not have, would surface during the build, not
 * earlier.
 */
describe('the workspace contract', () => {
  const text = repoFile(PATH);
  const contract = loadWorkspaceContract(text, PATH);
  const byTitle = new Map(contract.databases.map((database) => [database.title, database]));
  const binding = contract.binding;
  const databaseOf = (type: string): DatabaseShape => {
    const database = byTitle.get(
      Object.entries(binding.data_sources).find(([key]) => key === type)?.[1] ?? '',
    );

    if (database === undefined) throw new Error(`${type} is bound to no database`);

    return database;
  };
  const fieldsOf = new Map(Object.entries(binding.fields));
  const slots = Object.entries(binding.fields).flatMap(([type, fields]) =>
    Object.entries(fields).map(([field, representation]) => ({ type, field, representation })),
  );

  it('parses, and a key the schema does not know is refused', () => {
    expect(contract.databases.length).toBeGreaterThan(0);
    expect(() => loadWorkspaceContract(`${text}\nextra: true\n`, PATH)).toThrow(/Unrecognized key/);
  });

  describe('the database schema', () => {
    it('database names are unique', () => {
      expect(byTitle.size).toBe(contract.databases.length);
    });

    /** A relation is named on both sides; without its pair a two-way relation cannot be rebuilt. */
    it('relations are paired: `synced` points back, and the target exists', () => {
      const unpaired = contract.databases.flatMap((database) =>
        [...database.properties].flatMap(([name, property]) => {
          if (property.type !== 'relation') return [];

          const target = byTitle.get(property.target);
          const back = property.synced === null ? null : target?.properties.get(property.synced);

          if (target === undefined) return [`${database.title}."${name}" has no target`];
          if (property.synced === null) return [];

          return back?.type === 'relation' && back.target === database.title && back.synced === name
            ? []
            : [`${database.title}."${name}" is not paired`];
        }),
      );

      expect(unpaired).toEqual([]);
    });

    /**
     * The rule applies even when the contract has no rollups: each one must have something to point
     * at.
     */
    it('a rollup refers to real properties', () => {
      const dangling = contract.databases.flatMap((database) =>
        [...database.properties].flatMap(([name, property]) => {
          if (property.type !== 'rollup') return [];

          const relation = database.properties.get(property.relation);
          const target = relation?.type === 'relation' ? byTitle.get(relation.target) : undefined;

          return target?.properties.has(property.rollup) ? [] : [`${database.title}."${name}"`];
        }),
      );

      expect(dangling).toEqual([]);
    });

    it('a formula has an expression: an empty column comes from the build, not the contract', () => {
      const empty = contract.databases.flatMap((database) =>
        [...database.properties]
          .filter(
            ([, property]) => property.type === 'formula' && property.expression.trim() === '',
          )
          .map(([name]) => `${database.title}."${name}"`),
      );

      expect(empty).toEqual([]);
    });
  });

  describe('the binding', () => {
    it('every reference of the binding leads to an existing database and property', () => {
      const dangling = slots.flatMap(({ type, field, representation }) =>
        referencesOf(representation, databaseOf(type), byTitle)
          .filter((reference) => !reference.exists)
          .map((reference) => `${type}.${field}: ${reference.what}`),
      );

      expect(dangling).toEqual([]);
      expect(Object.values(binding.data_sources).every((title) => byTitle.has(title))).toBe(true);
      expect(slots.some(({ representation }) => representation.kind === 'native')).toBe(true);
    });

    it('every canonical slot is bound, and there is nothing extra', () => {
      const fieldContract = canonical.fieldContract();

      expect(Object.keys(binding.data_sources)).toEqual(Object.keys(fieldContract));
      expect(Object.keys(binding.fields)).toEqual(Object.keys(fieldContract));

      for (const [type, fields] of Object.entries(fieldContract)) {
        expect(Object.keys(fieldsOf.get(type) ?? {})).toEqual(Object.keys(fields));
      }
    });

    /** A field with a closed set is written by the contract as `Advance | Maintain | Minimum`. */
    it('closed sets have options that exist in the property', () => {
      const closed = Object.entries(canonical.fieldContract()).flatMap(([type, fields]) =>
        Object.entries(fields)
          .filter(([, value]) => value.includes(' | '))
          .map(([field, value]) => ({ slot: `${type}.${field}`, values: value.split(' | ') })),
      );

      expect(closed.length).toBeGreaterThan(0);
      expect(Object.keys(binding.options).sort()).toEqual(closed.map(({ slot }) => slot).sort());

      for (const { slot, values } of closed) {
        const [type = '', field = ''] = slot.split('.');
        const representation = fieldsOf.get(type)?.[field];
        const property =
          representation?.kind === 'native'
            ? databaseOf(type).properties.get(representation.property)
            : undefined;
        const names =
          property && 'options' in property ? property.options.map(({ name }) => name) : [];
        const set = binding.options[slot];

        expect(Object.keys(set?.canonical ?? {})).toEqual(values);
        expect(Object.values(set?.canonical ?? {}).filter((name) => !names.includes(name))).toEqual(
          [],
        );
        expect(
          Object.values(set?.known_non_canonical ?? {}).filter((name) => !names.includes(name)),
        ).toEqual([]);
      }

      const nonCanonical = canonical.knownNonCanonical().map(({ value }) => value);

      expect(Object.keys(binding.options['task.status']?.known_non_canonical ?? {})).toEqual(
        nonCanonical,
      );
    });

    it('the signals are those in the model contract, and each names a formula', () => {
      expect(Object.keys(binding.signals)).toEqual(Object.keys(canonical.signals()));

      const notFormulas = Object.entries(binding.signals).filter(([slot, property]) => {
        const shape = databaseOf(slot.split('.')[0] ?? '').properties.get(property);

        return shape?.type !== 'formula';
      });

      expect(notFormulas).toEqual([]);
    });
  });

  describe('the binding from a live workspace', () => {
    const live = liveWorkspaceOf(contract.databases);
    const generated = generateBinding({
      named: binding,
      live,
      workspace: 'synthetic',
      command: 'test',
    });

    it('a synthetic workspace built from the contract yields a binding that `loadBinding` accepts', () => {
      const loaded = loadBinding(generated.text, 'generated');
      const file = bindingFileSchema.parse(parse(generated.text));

      expect(file.workspace).toBe('synthetic');
      expect(loaded.fields.length).toBe(slots.length);
      expect(loaded.signals.map(({ slot }) => slot).sort()).toEqual(
        Object.keys(binding.signals).sort(),
      );
      expect(generated.unbound).toEqual([]);
    });

    it('every id in the binding is the id of a property or a database of this workspace', () => {
      const file = bindingFileSchema.parse(parse(generated.text));
      const dataSources = new Set([...live.values()].map(({ dataSourceId }) => dataSourceId));

      expect(Object.values(file.data_sources).every((id) => dataSources.has(id))).toBe(true);
      expect(file.fields.task.status).toEqual({
        kind: 'native',
        propertyId: live.get(file.data_sources.task)?.propertyIds.get('Status'),
      });
    });
  });

  /**
   * The gate overlay (`test/gate/workspace/capture-overlay.ts`) adds its own date to the Inbox. A
   * name the contract already has would collide with it: the gate would refuse to build the
   * workspace.
   */
  it('the contract lacks the name the gate overlay uses, and the capture time is a native property', () => {
    const inbox = databaseOf('inbox_item');
    const capturedAt = fieldsOf.get('inbox_item')?.captured_at;

    expect(inbox.properties.has(CAPTURE_PROPERTY)).toBe(false);
    expect(capturedAt?.kind).toBe('native');
  });
});

/** Lists what a slot refers to by name, and whether each reference exists in the schema. */
function referencesOf(
  representation: NamedRepresentation,
  database: DatabaseShape,
  byTitle: ReadonlyMap<string, DatabaseShape>,
): { what: string; exists: boolean }[] {
  switch (representation.kind) {
    case 'native':
      return [
        { what: representation.property, exists: database.properties.has(representation.property) },
      ];

    case 'traversed':
      return [{ what: representation.via, exists: database.properties.has(representation.via) }];

    case 'relation': {
      const target = byTitle.get(representation.database);

      return [
        { what: representation.property, exists: database.properties.has(representation.property) },
        { what: representation.database, exists: target !== undefined },
        ...(representation.syncedProperty === undefined
          ? []
          : [
              {
                what: representation.syncedProperty,
                exists: target?.properties.has(representation.syncedProperty) ?? false,
              },
            ]),
      ];
    }

    default:
      return [];
  }
}
