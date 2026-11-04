import { stringify } from 'yaml';
import {
  TASK_STATUS_ID,
  TASK_STATUS_SPELLED,
  VALID_BINDING_FILE,
} from '../../../test/fixtures/notion-mapping.fixture';
import { Binding } from './binding';
import { BindingError } from './binding.error';
import { loadBinding } from './load-binding';

interface Patch {
  readonly path: readonly string[];
  /** An omitted value means the key is deleted. */
  readonly value?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Corrupts a known-valid binding at the named places.
 *
 * A patch is described by a path and a value, not by a typed object, because an unusable binding
 * is by definition not of type `BindingFile`, and pretending otherwise would require a cast.
 */
function yamlWith(...patches: readonly Patch[]): string {
  const root: unknown = JSON.parse(JSON.stringify(VALID_BINDING_FILE));

  if (!isRecord(root)) throw new Error('the fixture is not a block of keys');

  for (const { path, value } of patches) {
    let node: Record<string, unknown> = root;

    for (const key of path.slice(0, -1)) {
      const next = node[key];

      if (!isRecord(next)) throw new Error(`the fixture has no ${path.join(' -> ')}`);

      node = next;
    }

    const leaf = path[path.length - 1];

    if ('value' in { value }) node[leaf] = value;
    if (value === undefined) delete node[leaf];
  }

  return stringify(root);
}

describe('loadBinding', () => {
  function problemsOf(text: string): string[] {
    try {
      loadBinding(text, 'test');
    } catch (error) {
      if (error instanceof BindingError) return [...error.problems];
      throw error;
    }

    throw new Error('expected the file to be rejected');
  }

  /** Returns the carrier of a field as the model sees it: from this file, not from the text. */
  function carrierOf(
    binding: Binding,
    type: 'task' | 'identity' | 'area_of_focus' | 'objective',
    field: string,
  ): unknown {
    return binding.fieldsOf(type).find((candidate) => candidate.field === field)?.carrier;
  }

  describe('a complete file', () => {
    it('is accepted and keeps the carrier of every field', () => {
      const binding = loadBinding(stringify(VALID_BINDING_FILE), 'fixture');

      expect(binding.dataSource('key_result')).toBe('ds_key_result');
      // Converting the ID is the model's job: the carrier holds both the canonical form and the
      // spelling from the file.
      expect(carrierOf(binding, 'task', 'status')).toEqual({
        kind: 'native',
        property: { id: TASK_STATUS_ID, spelled: TASK_STATUS_SPELLED },
      });
      expect(carrierOf(binding, 'task', 'date')).toMatchObject({
        kind: 'native',
        property: { spelled: 'p_task_date' },
      });
      expect(carrierOf(binding, 'task', 'deadline')).toMatchObject({
        kind: 'native',
        property: { spelled: 'p_task_deadline' },
      });
      expect(binding.optionSet('task.status')?.canonical).toContainEqual(['Failed', 'opt_failed']);
      expect(binding.optionSet('task.status')?.knownNonCanonical).toEqual([
        ['Hidden', 'opt_hidden'],
      ]);
    });

    it('keeps every representation kind distinguishable', () => {
      const binding = loadBinding(stringify(VALID_BINDING_FILE), 'fixture');

      expect(carrierOf(binding, 'identity', 'meaning')).toEqual({ kind: 'page_body' });
      expect(carrierOf(binding, 'area_of_focus', 'standard')).toEqual({ kind: 'gbrain' });
      expect(carrierOf(binding, 'objective', 'supporting_projects')).toMatchObject({
        kind: 'traversed',
        via: { spelled: 'aFBO' },
        rule: 'through_key_results',
      });
      expect(carrierOf(binding, 'task', 'project')).toMatchObject({ kind: 'relation' });
    });

    /** A block that exists only for compatibility leaves no entries without an id in the model. */
    it('keeps no entry for a known non-canonical value the file does not name', () => {
      const binding = loadBinding(
        yamlWith({ path: ['options', 'task.status', 'known_non_canonical'], value: {} }),
        'fixture',
      );

      expect(binding.optionSet('task.status')?.knownNonCanonical).toEqual([]);
    });
  });

  describe('a single field', () => {
    it('rejects an unfilled slot', () => {
      const problems = problemsOf(yamlWith({ path: ['fields', 'task', 'name'], value: null }));

      expect(problems).toEqual([expect.stringMatching(/^fields\.task\.name :: /)]);
    });

    it('rejects an unknown representation kind', () => {
      const problems = problemsOf(
        yamlWith({ path: ['fields', 'task', 'name'], value: { kind: 'formula', propertyId: 'x' } }),
      );

      expect(problems).toEqual([expect.stringMatching(/^fields\.task\.name\.kind :: /)]);
    });

    it('rejects a payload that does not belong to the declared kind', () => {
      const problems = problemsOf(
        yamlWith({ path: ['fields', 'task', 'name'], value: { kind: 'native', section: 'Name' } }),
      );

      expect(problems).toEqual([
        expect.stringMatching(/^fields\.task\.name\.propertyId :: /),
        'fields.task.name.section :: Unrecognized key',
      ]);
    });

    it('rejects an unknown traversal rule', () => {
      const problems = problemsOf(
        yamlWith({
          path: ['fields', 'objective', 'supporting_projects', 'rule'],
          value: 'nearest',
        }),
      );

      expect(problems).toEqual([
        expect.stringMatching(/^fields\.objective\.supporting_projects\.rule :: /),
      ]);
    });

    it('rejects a missing key and an extra one', () => {
      const problems = problemsOf(
        yamlWith(
          { path: ['fields', 'task', 'status'] },
          { path: ['fields', 'task', 'priority'], value: { kind: 'native', propertyId: 'p' } },
        ),
      );

      expect(problems).toEqual([
        expect.stringMatching(/^fields\.task\.status :: /),
        'fields.task.priority :: Unrecognized key',
      ]);
    });
  });

  describe('rules spanning more than one field', () => {
    it('requires an option id set for a native field', () => {
      const problems = problemsOf(yamlWith({ path: ['options', 'task.status'] }));

      expect(problems).toEqual([
        'options :: task.status is bound as native and needs its option ids',
      ]);
    });

    it('forbids an option id set for a page-body field', () => {
      const problems = problemsOf(
        yamlWith({ path: ['fields', 'area_of_focus', 'mode'], value: { kind: 'page_body' } }),
      );

      expect(problems).toEqual([
        'options :: area_of_focus.mode is bound as page_body and has no option ids',
      ]);
    });

    it('rejects one option id standing for two values', () => {
      const problems = problemsOf(
        yamlWith({ path: ['options', 'task.status', 'canonical', 'Done'], value: 'opt_canceled' }),
      );

      expect(problems).toEqual([
        'options :: task.status: option opt_canceled stands for both Done and Canceled',
      ]);
    });

    it('rejects an option id shared by a canonical and a known non-canonical value', () => {
      const problems = problemsOf(
        yamlWith({
          path: ['options', 'task.status', 'known_non_canonical', 'Hidden'],
          value: 'opt_done',
        }),
      );

      expect(problems).toEqual([
        'options :: task.status: option opt_done stands for both Done and Hidden',
      ]);
    });

    it('rejects an unregistered known non-canonical value', () => {
      const problems = problemsOf(
        yamlWith({
          path: ['options', 'task.status', 'known_non_canonical', 'Archived'],
          value: 'opt_archived',
        }),
      );

      expect(problems).toEqual([
        'options.task.status.known_non_canonical.Archived :: Unrecognized key',
      ]);
    });
  });

  /**
   * The rest of the format rules: a block the file does not know, a value of the wrong type,
   * `null` in place of a value and an empty file.
   */
  describe('the rest of the format', () => {
    const rejected: [string, string, string][] = [
      [
        'an unknown block of the file',
        yamlWith({ path: ['extra'], value: 1 }),
        'extra :: Unrecognized key',
      ],
      [
        'an unknown canonical type among the data sources',
        yamlWith({ path: ['data_sources', 'extra'], value: 'ds_x' }),
        'data_sources.extra :: Unrecognized key',
      ],
      [
        'a data source that is not a string',
        yamlWith({ path: ['data_sources', 'task'], value: 7 }),
        'data_sources.task :: ',
      ],
      [
        'a two-way flag that is not a boolean',
        yamlWith({
          path: ['fields', 'task', 'project'],
          value: { kind: 'relation', propertyId: 'r', dataSourceId: 'd', twoWay: 'yes' },
        }),
        'fields.task.project.twoWay :: ',
      ],
      [
        'an absent field without a reason',
        yamlWith({ path: ['fields', 'task', 'waiting_for'], value: { kind: 'absent' } }),
        'fields.task.waiting_for.reason :: ',
      ],
      [
        'a payload on a page-body field',
        yamlWith({
          path: ['fields', 'task', 'waiting_for'],
          value: { kind: 'page_body', section: 'S' },
        }),
        'fields.task.waiting_for.section :: Unrecognized key',
      ],
      [
        'an option set of a slot the contract does not know',
        yamlWith({ path: ['options', 'task.name'], value: { canonical: {} } }),
        'options.task.name :: Unrecognized key',
      ],
      [
        'a canonical option the contract does not name',
        yamlWith({ path: ['options', 'task.status', 'canonical', 'Bogus'], value: 'opt_b' }),
        'options.task.status.canonical.Bogus :: Unrecognized key',
      ],
      [
        'a signal the contract does not name',
        yamlWith({ path: ['signals', 'task.bogus'], value: 'f_x' }),
        'signals.task.bogus :: the contract declares no such signal',
      ],
      [
        'a signal that names no property',
        yamlWith({ path: ['signals', 'task.blocked'], value: '   ' }),
        'signals.task.blocked :: ',
      ],
      [
        'an id made of spaces only',
        yamlWith({ path: ['fields', 'task', 'name'], value: { kind: 'native', propertyId: ' ' } }),
        'fields.task.name.propertyId :: ',
      ],
      [
        'null where an optional value would stand',
        yamlWith({ path: ['signals'], value: null }),
        'signals :: ',
      ],
      [
        'null for the synced property of a relation',
        yamlWith({
          path: ['fields', 'task', 'project'],
          value: {
            kind: 'relation',
            propertyId: 'r',
            dataSourceId: 'd',
            twoWay: true,
            syncedPropertyId: null,
          },
        }),
        'fields.task.project.syncedPropertyId :: ',
      ],
      ['an empty file', '', '(file) :: '],
    ];

    it.each(rejected)('rejects %s', (_, text, problem) => {
      const problems = problemsOf(text);

      expect(problems).toEqual([expect.stringContaining(problem)]);
    });
  });

  describe('the document as a whole', () => {
    it('catches a duplicate key that YAML itself does not treat as an error', () => {
      const problems = problemsOf(`${stringify(VALID_BINDING_FILE)}\nworkspace: second\n`);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^yaml :: Map keys must be unique at line \d+, column \d+$/);
    });

    it('reports every problem of the format in a single pass', () => {
      const problems = problemsOf(
        yamlWith(
          { path: ['workspace'], value: null },
          { path: ['data_sources', 'task'], value: null },
          { path: ['fields', 'task', 'name'], value: null },
        ),
      );

      expect(problems).toHaveLength(3);
    });

    /** The model checks the rules between blocks once the format is accepted. */
    it('reports the rules between blocks together, after the format is accepted', () => {
      const problems = problemsOf(
        yamlWith(
          { path: ['options', 'task.status'] },
          { path: ['fields', 'task', 'date'], value: { kind: 'native', propertyId: '%zz' } },
        ),
      );

      expect(problems).toEqual([
        'task.date :: property id %zz is not valid percent-encoding',
        'options :: task.status is bound as native and needs its option ids',
      ]);
    });
  });
});
