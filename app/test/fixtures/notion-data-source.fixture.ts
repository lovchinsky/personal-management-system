import {
  Client,
  type DataSourceObjectResponse,
  type GetDataSourceResponse,
  type PartialDataSourceObjectResponse,
} from '@notionhq/client';

/** A property of the live schema, as `dataSources.retrieve` returns it. */
export type LivePropertyConfig = DataSourceObjectResponse['properties'][string];

/** The type of a property that has no settings of its own. */
type PlainType = 'title' | 'rich_text' | 'date';

export function plainProperty(id: string, name: string, type: PlainType): LivePropertyConfig {
  switch (type) {
    case 'title':
      return { id, name, description: null, type, title: {} };

    case 'rich_text':
      return { id, name, description: null, type, rich_text: {} };

    case 'date':
      return { id, name, description: null, type, date: {} };
  }
}

/** Builds a binding signal: a formula. */
export function formulaProperty(id: string, name: string): LivePropertyConfig {
  return { id, name, description: null, type: 'formula', formula: { expression: '' } };
}

/** Builds a status with a closed set of option ids. */
export function statusProperty(
  id: string,
  name: string,
  optionIds: readonly string[],
): LivePropertyConfig {
  return {
    id,
    name,
    description: null,
    type: 'status',
    status: {
      options: optionIds.map((optionId) => ({
        id: optionId,
        name: optionId,
        color: 'default',
        description: null,
      })),
      groups: [],
    },
  };
}

/** Builds a status whose options have names of their own, as the person sees them in Notion. */
export function namedStatusProperty(
  id: string,
  name: string,
  options: Readonly<Record<string, string>>,
): LivePropertyConfig {
  return {
    id,
    name,
    description: null,
    type: 'status',
    status: {
      options: Object.entries(options).map(([optionId, optionName]) => ({
        id: optionId,
        name: optionName,
        color: 'default',
        description: null,
      })),
      groups: [],
    },
  };
}

/** Builds a two-way relation to a data source. */
export function relationConfig(id: string, name: string, dataSourceId: string): LivePropertyConfig {
  return {
    id,
    name,
    description: null,
    type: 'relation',
    relation: {
      database_id: `db-${dataSourceId}`,
      data_source_id: dataSourceId,
      type: 'dual_property',
      dual_property: { synced_property_id: 'synced', synced_property_name: 'Synced' },
    },
  };
}

/** Builds a full response: the integration sees the data source schema. */
export function fullDataSource(
  id: string,
  properties: readonly LivePropertyConfig[],
): DataSourceObjectResponse {
  return {
    object: 'data_source',
    id,
    title: [],
    description: [],
    parent: { type: 'database_id', database_id: `db-${id}` },
    database_parent: { type: 'workspace', workspace: true },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: '2026-09-01T00:00:00.000Z',
    last_edited_time: '2026-09-01T00:00:00.000Z',
    created_by: { object: 'user', id: 'person-1' },
    last_edited_by: { object: 'user', id: 'person-1' },
    properties: Object.fromEntries(properties.map((property) => [property.name, property])),
    icon: null,
    cover: null,
    url: `https://www.notion.so/${id}`,
    public_url: null,
  };
}

/** Builds a partial response: the integration cannot see the data source schema. */
export function partialDataSource(id: string): PartialDataSourceObjectResponse {
  return { object: 'data_source', id, properties: {} };
}

/** Builds a real Notion client whose `dataSources.retrieve` answers whatever the test says. */
export function notionWithDataSources(
  answer: (dataSourceId: string) => Promise<GetDataSourceResponse>,
): Client {
  const client = new Client({ auth: 'secret_test' });

  jest
    .spyOn(client.dataSources, 'retrieve')
    .mockImplementation(({ data_source_id }) => answer(data_source_id));

  return client;
}
