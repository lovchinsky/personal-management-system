import type { DataSourceObjectResponse } from '@notionhq/client';
import {
  plainProperty,
  type LivePropertyConfig,
} from '../../../test/fixtures/notion-data-source.fixture';
import {
  formulaOf,
  relationTo,
  selectOf,
  titledDataSource,
} from '../../../test/fixtures/notion-workspace.fixture';
import {
  differences,
  readDataSources,
  readWorkspace,
  workspaceOf,
  type DatabaseShape,
} from './workspace-schema';

type Properties = readonly LivePropertyConfig[];

/** A change to the properties of the tasks database: replace, remove or add. */
type Change = (properties: Properties) => Properties;

const same: Change = (properties) => properties;
const replacing =
  (property: LivePropertyConfig): Change =>
  (properties) =>
    properties.map((current) => (current.name === property.name ? property : current));
const without =
  (name: string): Change =>
  (properties) =>
    properties.filter((current) => current.name !== name);
const adding =
  (property: LivePropertyConfig): Change =>
  (properties) => [...properties, property];

/**
 * Builds Tasks with a project and tags: a two-way relation, a one-way relation to a reference
 * database, a formula.
 */
function tasks(id: string, change: Change = same): DataSourceObjectResponse {
  return titledDataSource(
    id,
    'Tasks',
    change([
      plainProperty(`${id}-title`, 'Name', 'title'),
      relationTo(`${id}-project`, 'Project', `${id}-projects`, 'Tasks'),
      relationTo(`${id}-tags`, 'Tags', `${id}-tag-base`),
      selectOf(`${id}-effort`, 'Effort', [
        ['1', 'gray'],
        ['2', 'blue'],
      ]),
      formulaOf(`${id}-count`, 'Count', 'prop("Project").length()'),
    ]),
  );
}

/** Builds the tasks, projects and tags of one workspace; the ids start with `prefix`. */
function world(prefix: string, change: Change = same): Map<string, DataSourceObjectResponse> {
  return new Map<string, DataSourceObjectResponse>([
    [prefix, tasks(prefix, change)],
    [
      `${prefix}-projects`,
      titledDataSource(`${prefix}-projects`, 'Projects', [
        plainProperty(`${prefix}-projects-title`, 'Name', 'title'),
        relationTo(`${prefix}-projects-tasks`, 'Tasks', prefix, 'Project'),
      ]),
    ],
    [
      `${prefix}-tag-base`,
      titledDataSource(`${prefix}-tag-base`, 'Tags', [
        plainProperty(`${prefix}-tag-title`, 'Name', 'title'),
      ]),
    ],
  ]);
}

describe('the workspace schema', () => {
  it('is read together with the databases its relations lead to: a reference database is part of the schema', async () => {
    const responses = world('live');
    const read = jest.fn((id: string) => {
      const response = responses.get(id);

      return response ? Promise.resolve(response) : Promise.reject(new Error(id));
    });
    const workspace = await readWorkspace(read, ['live']);

    expect([...workspace.values()].map(({ shape }) => shape.title).sort()).toEqual([
      'Projects',
      'Tags',
      'Tasks',
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('a relation names its target by the database title and its pair by the property name', () => {
    const shape = workspaceOf(world('live')).get('live')?.shape;

    expect(shape?.properties.get('Project')).toEqual({
      description: null,
      type: 'relation',
      target: 'Projects',
      synced: 'Tasks',
    });
    expect(shape?.properties.get('Tags')).toEqual({
      description: null,
      type: 'relation',
      target: 'Tags',
      synced: null,
    });
  });

  it('`listed` reads only the named databases, `linked` also the databases its relations lead to', async () => {
    const responses = world('live');
    const read = (id: string) => {
      const response = responses.get(id);

      return response ? Promise.resolve(response) : Promise.reject(new Error(id));
    };

    expect([...(await readDataSources(read, ['live'], 'listed')).keys()]).toEqual(['live']);
    expect([...(await readDataSources(read, ['live'], 'linked')).keys()].sort()).toEqual([
      'live',
      'live-projects',
      'live-tag-base',
    ]);
  });

  it('refuses repeated database titles, because a relation target could not be named', () => {
    const responses = world('live');

    responses.set('twin', titledDataSource('twin', 'Tags', []));

    expect(() => workspaceOf(responses)).toThrow(/titles repeat \(Tags\)/);
  });

  it('refuses a relation that points outside what was read, naming the property', () => {
    expect(() => workspaceOf(new Map([['live', tasks('live')]]))).toThrow(
      /Tasks\."Project" relates to a data source outside the schema/,
    );
  });
});

/**
 * Returns the target: databases without ids, the shape of a live workspace whose ids do not matter.
 */
function targetOf(responses: Map<string, DataSourceObjectResponse>): DatabaseShape[] {
  return [...workspaceOf(responses).values()].map(({ shape }) => shape);
}

describe('schema differences', () => {
  const target = targetOf(world('target'));

  it('are empty for the same schema with other ids', () => {
    expect(differences(target, workspaceOf(world('live')))).toEqual([]);
  });

  it('name a missing, an extra and a differing property', () => {
    const live = world('live', (properties) =>
      adding(plainProperty('live-extra', 'Extra', 'rich_text'))(
        without('Count')(
          replacing(selectOf('live-effort', 'Effort', [['1', 'green']]))(properties),
        ),
      ),
    );

    expect(differences(target, workspaceOf(live))).toEqual([
      expect.stringMatching(/^Tasks\."Effort" differs/),
      'Tasks."Count" is missing',
      'Tasks."Extra" is not in the target',
    ]);
  });

  it('do not include option order, because status groups set it and REST does not set them', () => {
    const live = world(
      'live',
      replacing(
        selectOf('live-effort', 'Effort', [
          ['2', 'blue'],
          ['1', 'gray'],
        ]),
      ),
    );

    expect(differences(target, workspaceOf(live))).toEqual([]);
  });

  it('do not count a formula expression as a difference, but do count its type', () => {
    const empty = world('live', replacing(formulaOf('live-count', 'Count', '')));
    const typed = world('live', replacing(plainProperty('live-count', 'Count', 'rich_text')));

    expect(differences(target, workspaceOf(empty))).toEqual([]);
    expect(differences(target, workspaceOf(typed))).toEqual([
      expect.stringMatching(/^Tasks\."Count" differs/),
    ]);
  });
});
