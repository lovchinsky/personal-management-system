import type { DatabaseShape, PropertyShape } from './workspace-schema';
import { requestsOf } from './workspace-sync';

const title: PropertyShape = { description: null, type: 'title' };

function database(
  name: string,
  properties: Readonly<Record<string, PropertyShape>>,
): DatabaseShape {
  return {
    title: name,
    icon: null,
    description: '',
    properties: new Map(Object.entries(properties)),
  };
}

/** The id of a data source in the live workspace, derived from the database's name. */
const idOf = (name: string): string => `ds-${name}`;

const effort: PropertyShape = {
  description: null,
  type: 'select',
  options: [
    { name: '1', color: 'gray', description: null },
    { name: '2', color: 'blue', description: null },
  ],
};

describe('the sync requests', () => {
  it('remove everything extra except the title property, because a database cannot exist without one', () => {
    const target = database('Tasks', { Name: title });
    const live = database('Tasks', { Title: title, Extra: { description: null, type: 'date' } });

    expect(requestsOf('remove', target, live, idOf)).toEqual({ Extra: null });
  });

  it('rename the title property, set what is missing or different and leave what is identical alone', () => {
    const target = database('Tasks', {
      Name: title,
      Effort: effort,
      Deadline: { description: null, type: 'date' },
    });
    const live = database('Tasks', {
      Title: title,
      Deadline: { description: null, type: 'date' },
    });

    expect(requestsOf('scalar', target, live, idOf)).toEqual({
      Title: { name: 'Name' },
      Effort: {
        description: null,
        select: {
          options: [
            { name: '1', color: 'gray', description: null },
            { name: '2', color: 'blue', description: null },
          ],
        },
      },
    });
  });

  it("point a relation at the target database's data source, a two-way one with the pair's name", () => {
    const target = database('Tasks', {
      Name: title,
      Project: { description: null, type: 'relation', target: 'Projects', synced: 'Tasks' },
      Tags: { description: null, type: 'relation', target: 'Tags', synced: null },
    });

    expect(requestsOf('relation', target, database('Tasks', { Name: title }), idOf)).toEqual({
      Project: {
        description: null,
        relation: {
          data_source_id: 'ds-Projects',
          type: 'dual_property',
          dual_property: { synced_property_name: 'Tasks' },
        },
      },
      Tags: {
        description: null,
        relation: { data_source_id: 'ds-Tags', type: 'single_property', single_property: {} },
      },
    });
  });

  it("make one request per pair for a database's relation to itself, because Notion creates the second property", () => {
    const target = database('Tasks', {
      Name: title,
      Blocking: { description: null, type: 'relation', target: 'Tasks', synced: 'Blocked by' },
      'Blocked by': { description: null, type: 'relation', target: 'Tasks', synced: 'Blocking' },
    });

    expect(
      Object.keys(requestsOf('relation', target, database('Tasks', { Name: title }), idOf)),
    ).toEqual(['Blocking']);
  });

  it('only create a formula, with an empty expression, and leave an entered expression untouched', () => {
    const target = database('Tasks', {
      Name: title,
      Count: { description: null, type: 'formula', expression: 'prop("Project").length()' },
      Late: { description: null, type: 'formula', expression: 'prop("Deadline") < now()' },
    });
    const live = database('Tasks', {
      Name: title,
      Late: { description: null, type: 'formula', expression: 'anything entered' },
    });

    expect(requestsOf('formula', target, live, idOf)).toEqual({
      Count: { description: null, formula: { expression: '' } },
    });
  });

  it('put each property in its own stage', () => {
    const target = database('Tasks', {
      Name: title,
      Effort: effort,
      Project: { description: null, type: 'relation', target: 'Projects', synced: 'Tasks' },
      Count: { description: null, type: 'formula', expression: '1' },
      Total: {
        description: null,
        type: 'rollup',
        relation: 'Project',
        rollup: 'Name',
        function: 'count',
      },
    });
    const live = database('Tasks', { Name: title });
    const stages = (['scalar', 'relation', 'formula', 'rollup'] as const).map((stage) =>
      Object.keys(requestsOf(stage, target, live, idOf)),
    );

    expect(stages).toEqual([['Effort'], ['Project'], ['Count'], ['Total']]);
  });
});
