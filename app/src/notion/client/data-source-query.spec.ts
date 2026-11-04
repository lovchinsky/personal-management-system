import { Test } from '@nestjs/testing';
import {
  Client,
  type PageObjectResponse,
  type PartialPageObjectResponse,
  type QueryDataSourceResponse,
} from '@notionhq/client';
import { DataSourceQuery, type QueryFilter } from './data-source-query';
import { NotionAccessError } from './notion.error';
import { PageReader } from './page.reader';

const user = { object: 'user', id: 'user-1' } as const;

function page(id: string): PageObjectResponse {
  return {
    object: 'page',
    id,
    created_time: '2026-10-01T08:00:00.000Z',
    last_edited_time: '2026-10-01T08:00:00.000Z',
    in_trash: false,
    archived: false,
    is_archived: false,
    is_locked: false,
    url: `https://notion.so/${id}`,
    public_url: null,
    parent: { type: 'data_source_id', data_source_id: 'ds_task', database_id: 'db' },
    properties: {},
    icon: null,
    cover: null,
    created_by: user,
    last_edited_by: user,
  };
}

function answer(
  results: QueryDataSourceResponse['results'],
  next: string | null,
): QueryDataSourceResponse {
  return {
    type: 'page_or_data_source',
    page_or_data_source: {},
    object: 'list',
    next_cursor: next,
    has_more: next !== null,
    results,
  };
}

const FILTER: QueryFilter = { property: 'p_task_date', date: { on_or_before: '2026-10-15' } };

describe('DataSourceQuery', () => {
  let query: DataSourceQuery;
  let notion: Client;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DataSourceQuery,
        PageReader,
        { provide: Client, useValue: new Client({ auth: 'test' }) },
      ],
    }).compile();

    query = moduleRef.get(DataSourceQuery);
    notion = moduleRef.get(Client);
  });

  it('concatenates the response pages by cursor and reports that everything was read', async () => {
    const calls = jest
      .spyOn(notion.dataSources, 'query')
      .mockResolvedValueOnce(answer([page('a'), page('b')], 'cursor-2'))
      .mockResolvedValueOnce(answer([page('c')], null));

    const found = await query.query('ds_task', FILTER, 10);

    expect(found.pages.map((one) => one.id)).toEqual(['a', 'b', 'c']);
    expect(found.complete).toBe(true);
    expect(calls).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data_source_id: 'ds_task',
        filter: FILTER,
        start_cursor: 'cursor-2',
      }),
    );
  });

  it('the limit truncates the result and reports that not everything was read', async () => {
    const calls = jest
      .spyOn(notion.dataSources, 'query')
      .mockResolvedValueOnce(answer([page('a'), page('b')], 'cursor-2'));

    const found = await query.query('ds_task', FILTER, 2);

    expect(found.pages).toHaveLength(2);
    expect(found.complete).toBe(false);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls).toHaveBeenCalledWith(expect.objectContaining({ page_size: 2 }));
  });

  it('a page without content means missing access, not an empty result', async () => {
    const partial: PartialPageObjectResponse = { object: 'page', id: 'hidden' };

    jest.spyOn(notion.dataSources, 'query').mockResolvedValueOnce(answer([partial], null));

    await expect(query.query('ds_task', FILTER, 10)).rejects.toBeInstanceOf(NotionAccessError);
  });
});
