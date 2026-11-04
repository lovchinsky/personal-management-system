import {
  TASK_STATUS_ID,
  TASK_STATUS_SPELLED,
  VALID_BINDING_FILE,
} from '../../../test/fixtures/notion-mapping.fixture';
import { Binding, bindingOf, BoundProperty } from './binding';
import { BindingError } from './binding.error';
import { BindingFile } from './binding.schema';

/** Returns a binding with a different carrier for the Task date, to corrupt exactly one place. */
function withTaskDate(propertyId: string): BindingFile {
  return {
    ...VALID_BINDING_FILE,
    fields: {
      ...VALID_BINDING_FILE.fields,
      task: { ...VALID_BINDING_FILE.fields.task, date: { kind: 'native', propertyId } },
    },
  };
}

function problemsOf(build: () => Binding): readonly string[] {
  try {
    build();
  } catch (error) {
    if (error instanceof BindingError) return error.problems;

    throw error;
  }

  throw new Error('the binding accepted a file it had to reject');
}

describe('a binding read once', () => {
  const binding = bindingOf(VALID_BINDING_FILE, 'fixture');

  /**
   * The ID is canonical so that it can be compared; the spelling is there so that an error can
   * refer to the property as the file spells it.
   */
  it('the carrier holds the canonical ID and the spelling from the file', () => {
    const status = binding.fieldsOf('task').find(({ field }) => field === 'status');
    const expected: BoundProperty = { id: TASK_STATUS_ID, spelled: TASK_STATUS_SPELLED };

    expect(status?.carrier).toEqual({ kind: 'native', property: expected });
  });

  it('a signal is converted the same way as a field', () => {
    const blocked = binding.signalsOf('task').find(({ slot }) => slot === 'task.blocked');

    expect(blocked?.property).toEqual({ id: 'f_task?blocked', spelled: 'f_task%3Fblocked' });
  });

  it('the data source is the one the file names', () => {
    expect(binding.dataSource('task')).toBe('ds_task');
  });

  /**
   * Notion returns ids with hyphens, while the file may keep them without. The type does not
   * depend on the form.
   */
  it('the type of a page comes from its data source, in any form of id', () => {
    const dashed = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
    const inUuid = bindingOf(
      {
        ...VALID_BINDING_FILE,
        data_sources: { ...VALID_BINDING_FILE.data_sources, task: dashed.replaceAll('-', '') },
      },
      'fixture',
    );

    expect(inUuid.typeOf(dashed)).toBe('task');
    expect(binding.typeOf('ds_inbox_item')).toBe('inbox_item');
    expect(binding.typeOf('ds_elsewhere')).toBeUndefined();
  });

  it('a data source shared by two types is refused because the type of its pages is undetermined', () => {
    const shared: BindingFile = {
      ...VALID_BINDING_FILE,
      data_sources: { ...VALID_BINDING_FILE.data_sources, inbox_item: 'ds_task' },
    };

    expect(problemsOf(() => bindingOf(shared, 'fixture'))).toEqual([
      'data_sources.inbox_item :: data source ds_task is already bound to task — ' +
        'a page belongs to one canonical type by the data source it lies in',
    ]);
  });

  it('a malformed sequence in an ID is refused with the slot name', () => {
    expect(problemsOf(() => bindingOf(withTaskDate('%zz'), 'fixture'))).toEqual([
      'task.date :: property id %zz is not valid percent-encoding',
    ]);
  });

  /**
   * The format check compares spellings and does not see a pair like this: `%7B` and `{` are
   * different strings but one property.
   */
  it('two fields that name one property in canonical form are refused', () => {
    expect(problemsOf(() => bindingOf(withTaskDate(TASK_STATUS_ID), 'fixture'))).toEqual([
      `task.date :: names the same property as task.status (${TASK_STATUS_ID})`,
    ]);
  });

  /** A relation and a field of one type cannot name the same property, just like two fields. */
  it('a field that coincides with a relation in canonical form is refused', () => {
    expect(problemsOf(() => bindingOf(withTaskDate('r_task{dependencies'), 'fixture'))).toEqual([
      'task.date :: names the same property as task.dependencies (r_task{dependencies)',
    ]);
  });

  it('a traversal carrier is converted the same way as a field', () => {
    const traversal = binding
      .fieldsOf('key_result')
      .find(({ field }) => field === 'supporting_projects');

    expect(traversal?.carrier).toEqual({
      kind: 'traversed',
      via: { id: 'dN{H', spelled: 'dN%7BH' },
      rule: 'through_key_results',
    });
  });
});
