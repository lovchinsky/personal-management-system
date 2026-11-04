import { Test } from '@nestjs/testing';
import {
  Client,
  type PageObjectResponse,
  type QueryDataSourceParameters,
  type QueryDataSourceResponse,
} from '@notionhq/client';
import {
  fullDataSource,
  namedStatusProperty,
  notionWithDataSources,
  plainProperty,
  relationConfig,
  type LivePropertyConfig,
} from '../../../test/fixtures/notion-data-source.fixture';
import { TASK_STATUS_SPELLED } from '../../../test/fixtures/notion-mapping.fixture';
import { pageFor } from '../../../test/fixtures/notion-page.fixture';
import { bindingProvider } from '../../../test/fixtures/test-module';
import { DataSourceQuery } from '../client/data-source-query';
import { LiveSchema } from '../client/live-schema';
import type { RestProperty } from '../client/page';
import { PageReader } from '../client/page.reader';
import { AdapterConfigurationError } from './adapter.error';
import { NotionRecordQuery } from './record-query';
import { SemanticAdapter } from './semantic.adapter';

/**
 * The status options in the live schema: the ids are the same as in the binding, the names are
 * human-readable.
 */
const TASK_STATUS_NAMES: Readonly<Record<string, string>> = {
  opt_next_action: 'Наступна дія',
  opt_waiting_for: 'Чекаю',
  opt_scheduled: 'Заплановано',
};

const TASK_SCHEMA: readonly LivePropertyConfig[] = [
  namedStatusProperty(TASK_STATUS_SPELLED, 'Status', TASK_STATUS_NAMES),
  plainProperty('p_task_date', 'Date', 'date'),
  plainProperty('p_task_deadline', 'Deadline', 'date'),
  relationConfig('r_task_project', 'Project', 'ds_project'),
  relationConfig('r_task%7Bdependencies', 'Blocked by', 'ds_task'),
];

const user = { object: 'user', id: 'user-1' } as const;

/** Returns the fixture's Task as a REST response: the same page the adapter decodes. */
function restTask(id: string): PageObjectResponse {
  const page = pageFor('task');
  const properties: Record<string, RestProperty> = {};

  for (const property of page.properties.values()) properties[property.id] = property;

  return {
    object: 'page',
    id,
    created_time: '2026-10-01T08:00:00.000Z',
    last_edited_time: page.last_edited_time,
    in_trash: false,
    archived: false,
    is_archived: false,
    is_locked: false,
    url: `https://notion.so/${id}`,
    public_url: null,
    parent: { type: 'data_source_id', data_source_id: 'ds_task', database_id: 'db_task' },
    properties,
    icon: null,
    cover: null,
    created_by: user,
    last_edited_by: user,
  };
}

function answer(results: readonly PageObjectResponse[], more: boolean): QueryDataSourceResponse {
  return {
    type: 'page_or_data_source',
    page_or_data_source: {},
    object: 'list',
    next_cursor: more ? 'cursor-2' : null,
    has_more: more,
    results: [...results],
  };
}

describe('NotionRecordQuery', () => {
  let records: NotionRecordQuery;
  let query: jest.SpyInstance<Promise<QueryDataSourceResponse>, [QueryDataSourceParameters]>;

  beforeEach(async () => {
    const notion = notionWithDataSources((id) => Promise.resolve(fullDataSource(id, TASK_SCHEMA)));
    query = jest
      .spyOn(notion.dataSources, 'query')
      .mockResolvedValue(answer([restTask('t1')], false));

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotionRecordQuery,
        SemanticAdapter,
        LiveSchema,
        DataSourceQuery,
        PageReader,
        bindingProvider(),
        { provide: Client, useValue: notion },
      ],
    }).compile();

    records = moduleRef.get(NotionRecordQuery);
  });

  const sentFilter = (): QueryDataSourceParameters['filter'] => query.mock.calls[0]?.[0].filter;

  /**
   * The option id is the contract, but Notion's filter takes a name, so the live schema supplies
   * it.
   */
  it('an option is matched by its current name from the live schema, a property by its id from the binding', async () => {
    await records.records('task', [{ field: 'status', anyOf: ['Waiting For'] }], 10);

    expect(sentFilter()).toEqual({ property: TASK_STATUS_SPELLED, status: { equals: 'Чекаю' } });
  });

  it('with several options, any one of them matches', async () => {
    await records.records('task', [{ field: 'status', anyOf: ['Next Action', 'Scheduled'] }], 10);

    expect(sentFilter()).toEqual({
      or: [
        { property: TASK_STATUS_SPELLED, status: { equals: 'Наступна дія' } },
        { property: TASK_STATUS_SPELLED, status: { equals: 'Заплановано' } },
      ],
    });
  });

  it('several conditions all apply together', async () => {
    await records.records(
      'task',
      [
        { field: 'status', anyOf: ['Waiting For'] },
        { field: 'date', onOrBefore: '2026-10-15' },
        { field: 'project', linksTo: 'project-1' },
        { field: 'dependencies', linked: true },
        { editedOnOrAfter: '2026-10-01T00:00:00.000Z' },
      ],
      10,
    );

    expect(sentFilter()).toEqual({
      and: [
        { property: TASK_STATUS_SPELLED, status: { equals: 'Чекаю' } },
        { property: 'p_task_date', date: { on_or_before: '2026-10-15' } },
        { property: 'r_task_project', relation: { contains: 'project-1' } },
        { property: 'r_task%7Bdependencies', relation: { is_not_empty: true } },
        {
          timestamp: 'last_edited_time',
          last_edited_time: { on_or_after: '2026-10-01T00:00:00.000Z' },
        },
      ],
    });
  });

  it('what is found is decoded by the same adapter, and the limit says whether all was read', async () => {
    query.mockResolvedValue(answer([restTask('t1')], true));

    const found = await records.records('task', [{ field: 'status', anyOf: ['Waiting For'] }], 1);

    expect(found.records.map((record) => [record.type, record.pageId])).toEqual([['task', 't1']]);
    expect(found.complete).toBe(false);
  });

  /**
   * An option that is gone from the live schema means the binding has diverged from the
   * workspace.
   */
  it('an option missing from the live schema is a configuration refusal, not an empty selection', async () => {
    await expect(
      records.records('task', [{ field: 'status', anyOf: ['Done'] }], 10),
    ).rejects.toBeInstanceOf(AdapterConfigurationError);
    expect(query).not.toHaveBeenCalled();
  });

  it('a field of the wrong physical type is a configuration refusal', async () => {
    await expect(
      records.records('task', [{ field: 'project', onOrBefore: '2026-10-15' }], 10),
    ).rejects.toBeInstanceOf(AdapterConfigurationError);
  });
});
