import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument, type Document } from 'yaml';
import { loadWorkspaceContract, readWorkspaceContract } from './workspace-contract';

const FILE = resolve(__dirname, '../../../../contracts/notion-workspace.yaml');

const TEXT = readFileSync(FILE, 'utf8');

const CONTRACT = readWorkspaceContract(FILE);

/**
 * Returns the contract read from the file and changed to have the problem the test wants to show.
 */
function mutated(change: (document: Document) => void): string {
  const document = parseDocument(TEXT);

  change(document);

  return String(document);
}

const load = (text: string) => loadWorkspaceContract(text, 'contract');

/** Returns the path to a database property in the document. */
const property = (title: string, name: string, ...rest: string[]): (string | number)[] => [
  'databases',
  CONTRACT.databases.findIndex((candidate) => candidate.title === title),
  'properties',
  name,
  ...rest,
];

describe('the workspace contract', () => {
  it('the repository file is read: databases with properties by name and a binding by names', () => {
    const contract = CONTRACT;
    const tasks = contract.databases.find(({ title }) => title === 'Tasks');

    expect(contract.databases).toHaveLength(11);
    expect(tasks?.icon).toEqual({ type: 'emoji', emoji: '⚡' });
    expect(tasks?.properties.get('Blocked by')).toEqual({
      description: null,
      type: 'relation',
      target: 'Tasks',
      synced: 'Blocking',
    });
    expect(contract.binding.data_sources.task).toBe('Tasks');
    expect(contract.binding.signals['task.blocked']).toBe('Blocked');
  });

  describe('the schema is strict: nothing unknown passes silently', () => {
    it.each([
      [
        'a key at the root',
        (document: Document) => {
          document.set('extra', 1);
        },
        /extra :: Unrecognized key/,
      ],
      [
        'a key in a property',
        (document: Document) => {
          document.setIn(property('Tasks', 'Date', 'format'), 'number');
        },
        /databases\.\d+\.properties\.Date\.format :: Unrecognized key/,
      ],
      [
        'a type the schema does not know',
        (document: Document) => {
          document.setIn(property('Tasks', 'Date', 'type'), 'telepathy');
        },
        /databases\.\d+\.properties\.Date/,
      ],
      [
        'a canonical type outside the model',
        (document: Document) => {
          document.setIn(['binding', 'data_sources', 'invented'], 'Tasks');
        },
        /binding\.data_sources/,
      ],
      [
        'a representation kind that does not exist',
        (document: Document) => {
          document.setIn(['binding', 'fields', 'task', 'name'], { kind: 'telepathy' });
        },
        /binding\.fields\.task\.name/,
      ],
      [
        'a signal the model contract does not name',
        (document: Document) => {
          document.setIn(['binding', 'signals', 'task.invented'], 'Blocked');
        },
        /binding\.signals/,
      ],
    ])('%s', (_, change, says) => {
      expect(() => load(mutated(change))).toThrow(says);
    });

    it('refuses a duplicated YAML key instead of letting the last one win', () => {
      expect(() => load(`${TEXT}\ndatabases: []\n`)).toThrow(/yaml ::/);
    });
  });

  describe('the schema is internally consistent', () => {
    it.each([
      [
        'a repeated database title',
        (document: Document) => {
          document.setIn(
            ['databases', CONTRACT.databases.findIndex(({ title }) => title === 'Tags'), 'title'],
            'Context',
          );
        },
        /title Context repeats/,
      ],
      [
        'a database without a title property',
        (document: Document) => {
          document.deleteIn(property('Trigger', 'Name'));
        },
        /Trigger :: needs exactly one title property/,
      ],
      [
        'a relation to a database that does not exist',
        (document: Document) => {
          document.setIn(property('Tasks', 'Context', 'target'), 'Nowhere');
        },
        /Tasks\."Context" :: relates to Nowhere/,
      ],
      [
        'a relation whose pair does not lead back',
        (document: Document) => {
          document.setIn(property('Tasks', 'Blocked by', 'synced'), 'Context');
        },
        /Tasks\."Blocked by" :: Tasks\."Context" is not its pair/,
      ],
      [
        'a rollup over a property that is not a relation',
        (document: Document) => {
          document.setIn(property('Tasks', 'Total'), {
            type: 'rollup',
            relation: 'Date',
            rollup: 'Name',
            function: 'count',
          });
        },
        /Tasks\."Total" :: rollup names Date, which is not a relation/,
      ],
      [
        'a rollup over a property missing from the target database',
        (document: Document) => {
          document.setIn(property('Tasks', 'Total'), {
            type: 'rollup',
            relation: 'Context',
            rollup: 'Nothing',
            function: 'count',
          });
        },
        /Tasks\."Total" :: rollup names Context\."Nothing"/,
      ],
    ])('%s', (_, change, says) => {
      expect(() => load(mutated(change))).toThrow(says);
    });
  });

  describe('the binding names only what exists in the schema', () => {
    it.each([
      [
        'a database that does not exist',
        (document: Document) => {
          document.setIn(['binding', 'data_sources', 'task'], 'Nowhere');
        },
        /binding\.data_sources\.task :: database Nowhere is not there/,
      ],
      [
        'one database for two types',
        (document: Document) => {
          document.setIn(['binding', 'data_sources', 'project'], 'Tasks');
        },
        /binding\.data_sources\.task :: Tasks is also project/,
      ],
      [
        'a property that does not exist',
        (document: Document) => {
          document.setIn(['binding', 'fields', 'task', 'status', 'property'], 'Nothing');
        },
        /binding\.fields\.task\.status :: Tasks\."Nothing" is not there/,
      ],
      [
        'a traversal through a property that is not a relation',
        (document: Document) => {
          document.setIn(['binding', 'fields', 'behavior_system', 'tracking', 'via'], 'Lifecycle');
        },
        /binding\.fields\.behavior_system\.tracking :: Habits\."Lifecycle" is not a relation/,
      ],
      [
        'a relation to the wrong database',
        (document: Document) => {
          document.setIn(['binding', 'fields', 'task', 'project', 'database'], 'Habits');
        },
        /binding\.fields\.task\.project :: Tasks\."🚀 Projects" is not a relation to Habits/,
      ],
      [
        'a two-way slot without a pair',
        (document: Document) => {
          document.deleteIn(['binding', 'fields', 'task', 'project', 'syncedProperty']);
        },
        /binding\.fields\.task\.project :: a two-way slot names its pair/,
      ],
      [
        'a pair that is not a pair',
        (document: Document) => {
          document.setIn(['binding', 'fields', 'task', 'project', 'syncedProperty'], '🦥 Habits');
        },
        /binding\.fields\.task\.project :: Projects\."🦥 Habits" is not the pair/,
      ],
      [
        'an option the property does not have',
        (document: Document) => {
          document.setIn(['binding', 'options', 'task.status', 'canonical', 'Done'], 'Finished');
        },
        /binding\.options\.task\.status :: Status has no option Finished/,
      ],
      [
        'an option set for a field that is not native',
        (document: Document) => {
          document.setIn(['binding', 'options', 'task.waiting_for'], {
            canonical: { Done: 'Done' },
          });
        },
        /binding\.options\.task\.waiting_for :: task\.waiting_for is not a native field/,
      ],
      [
        'a signal that is not a formula',
        (document: Document) => {
          document.setIn(['binding', 'signals', 'task.blocked'], 'Date');
        },
        /binding\.signals\.task\.blocked :: Date is not a formula of its database/,
      ],
    ])('%s', (_, change, says) => {
      expect(() => load(mutated(change))).toThrow(says);
    });

    it('lists all the problems together', () => {
      const text = mutated((document: Document) => {
        document.setIn(['binding', 'data_sources', 'task'], 'Nowhere');
        document.setIn(['binding', 'signals', 'task.blocked'], 'Date');
      });

      expect(() => load(text)).toThrow(/Nowhere[\s\S]*Date is not a formula/);
    });
  });
});
