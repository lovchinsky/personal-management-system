import { liveSchemasOf } from '../../../test/fixtures/live-schemas.fixture';
import {
  TASK_STATUS_ID,
  TASK_STATUS_SPELLED,
  VALID_BINDING_FILE,
} from '../../../test/fixtures/notion-mapping.fixture';
import { bindingOf } from '../binding/binding';
import { CANONICAL_TYPES } from '../binding/binding.schema';
import { MAX_NAME_CHARS, schemaMappingOf, SchemaMappingWire, SemanticWire } from './schema-mapping';

const binding = bindingOf(VALID_BINDING_FILE, 'fixture');
const named = (id: string): string => `назва ${id}`;
const live = liveSchemasOf(binding, named);

function semantic(wire: SchemaMappingWire, slot: string): SemanticWire | undefined {
  return wire.types.flatMap((mapped) => mapped.semantics).find((found) => found.slot === slot);
}

describe('the mapping for the model', () => {
  const wire = schemaMappingOf(binding, live);

  it('every canonical field of every type has its own carrier', () => {
    const slots = wire.types.flatMap((mapped) => mapped.semantics.map(({ slot }) => slot));
    const declared = Object.values(VALID_BINDING_FILE.fields).reduce<number>(
      (total, type) => total + Object.keys(type).length,
      0,
    );

    expect(slots).toHaveLength(declared);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots).toContain('task.deadline');
  });

  it('every canonical type has its own data source', () => {
    expect(wire.types.map((mapped) => mapped.type)).toEqual([...CANONICAL_TYPES]);
    expect(wire.types.every((mapped) => mapped.data_source_id.length > 0)).toBe(true);
  });

  /**
   * A model that saw an encoded ID would compose a proposal with it, and the input would reject
   * the proposal, so only the canonical form is exposed.
   */
  it('the carrier is named by the canonical ID and a name, not by the spelling from the file', () => {
    expect(semantic(wire, 'task.status')?.carrier).toEqual({
      kind: 'native',
      property_id: TASK_STATUS_ID,
      name: named(TASK_STATUS_ID),
    });
    expect(JSON.stringify(wire)).not.toContain(TASK_STATUS_SPELLED);
  });

  it('a slot with a set of option ids includes both the set and the label of each option', () => {
    const set = VALID_BINDING_FILE.options['task.status'];
    const options = semantic(wire, 'task.status')?.options;
    const ids: Record<string, string> = { ...set?.canonical, ...set?.known_non_canonical };

    expect(options?.canonical).toEqual(set?.canonical);
    expect(options?.labels).toEqual(
      Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, named(id)])),
    );
  });

  it('the synced side of a relation and the traversal property come with names', () => {
    const relation = semantic(wire, 'task.project')?.carrier;
    const traversed = wire.types
      .flatMap((mapped) => mapped.semantics)
      .find((found) => found.carrier.kind === 'traversed')?.carrier;

    expect(relation).toMatchObject({ name: expect.any(String), synced_name: expect.any(String) });
    expect(traversed).toMatchObject({ via_name: expect.any(String) });
  });
});

describe('names the live schema does not supply', () => {
  it('a data source that Notion did not return has no names; the other types are named', () => {
    const withoutTasks = new Map([...live].filter(([id]) => id !== binding.dataSource('task')));
    const wire = schemaMappingOf(binding, withoutTasks);

    expect(semantic(wire, 'task.status')?.carrier).toEqual({
      kind: 'native',
      property_id: TASK_STATUS_ID,
    });
    expect(semantic(wire, 'task.status')?.options?.labels).toEqual({});
    expect(semantic(wire, 'project.status')?.carrier).toMatchObject({ name: expect.any(String) });
  });

  it(`the response includes no name longer than ${MAX_NAME_CHARS} characters`, () => {
    const wire = schemaMappingOf(
      binding,
      liveSchemasOf(binding, (id) => (id === TASK_STATUS_ID ? 'ш'.repeat(MAX_NAME_CHARS + 1) : id)),
    );

    expect(semantic(wire, 'task.status')?.carrier).not.toHaveProperty('name');
    expect(semantic(wire, 'task.deadline')?.carrier).toHaveProperty('name');
  });
});
