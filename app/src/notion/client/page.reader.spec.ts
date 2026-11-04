import { Test } from '@nestjs/testing';
import {
  Client,
  type GetPagePropertyResponse,
  type PageObjectResponse,
  type PartialPageObjectResponse,
} from '@notionhq/client';
import { NotionAccessError } from './notion.error';
import { PageProperty, RestProperty } from './page';
import { PageReader } from './page.reader';
import { propertyIdFromNotion } from './property-id';

const PAGE_ID = 'page-1';

const user = { object: 'user', id: 'user-1' } as const;

/**
 * Builds a full Notion page. It is verbose on purpose: the test builds exactly what REST returns,
 * so a mismatch with the SDK's type fails here, not at runtime.
 */
function pageWith(properties: Record<string, RestProperty>): PageObjectResponse {
  return {
    object: 'page',
    id: PAGE_ID,
    created_time: '2026-09-24T08:00:00.000Z',
    last_edited_time: '2026-09-24T08:00:00.000Z',
    in_trash: false,
    archived: false,
    is_archived: false,
    is_locked: false,
    url: 'https://notion.so/page-1',
    public_url: null,
    parent: { type: 'data_source_id', data_source_id: 'ds', database_id: 'db' },
    properties,
    icon: null,
    cover: null,
    created_by: user,
    last_edited_by: user,
  };
}

const relation = (id: string, pageIds: string[], hasMore: boolean): RestProperty => ({
  id,
  type: 'relation',
  relation: pageIds.map((pageId) => ({ id: pageId })),
  has_more: hasMore,
});

/**
 * Builds a page of the property's item list, in the shape of the property-item endpoint response.
 */
function relationPage(pageIds: string[], next: string | null): GetPagePropertyResponse {
  return {
    object: 'list',
    type: 'property_item',
    property_item: { type: 'relation', relation: {}, id: 'r', next_url: null },
    results: pageIds.map((pageId) => ({
      object: 'property_item',
      type: 'relation',
      relation: { id: pageId },
      id: 'r',
    })),
    next_cursor: next,
    has_more: next !== null,
  };
}

describe('PageReader', () => {
  let reader: PageReader;
  let notion: Client;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PageReader, { provide: Client, useValue: new Client({ auth: 'test' }) }],
    }).compile();

    reader = moduleRef.get(PageReader);
    notion = moduleRef.get(Client);
  });

  it('returns the properties when there is nothing left to read', async () => {
    const page = pageWith({ Projects: relation('r_projects', ['a', 'b'], false) });

    jest.spyOn(notion.pages, 'retrieve').mockResolvedValue(page);
    const items = jest.spyOn(notion.pages.properties, 'retrieve');

    const result = await reader.page(PAGE_ID);

    const expected: PageProperty = {
      ...relation('r_projects', ['a', 'b'], false),
      id: propertyIdFromNotion('r_projects'),
    };

    expect(result.properties.get(propertyIdFromNotion('r_projects'))).toEqual(expected);
    expect(items).not.toHaveBeenCalled();
  });

  /**
   * The request path needs the ID in REST form: the canonical form contains characters that break
   * it. The page key, though, is already canonical.
   */
  it('completes a truncated relation by its REST-form ID and concatenates the pages', async () => {
    const page = pageWith({ Tasks: relation('r%7Btasks', ['a'], true) });

    jest.spyOn(notion.pages, 'retrieve').mockResolvedValue(page);
    const items = jest
      .spyOn(notion.pages.properties, 'retrieve')
      .mockResolvedValueOnce(relationPage(['a', 'b'], 'cursor-2'))
      .mockResolvedValueOnce(relationPage(['c'], null));

    const result = await reader.page(PAGE_ID);

    expect(items).toHaveBeenCalledWith(expect.objectContaining({ property_id: 'r%7Btasks' }));
    const expected: PageProperty = {
      ...relation('r%7Btasks', ['a', 'b', 'c'], false),
      id: propertyIdFromNotion('r%7Btasks'),
    };

    expect(result.properties.get(propertyIdFromNotion('r%7Btasks'))).toEqual(expected);
  });

  /** The binding determines the canonical type of a page from its data source. */
  it('a page has the data source it lives in', async () => {
    jest.spyOn(notion.pages, 'retrieve').mockResolvedValue(pageWith({}));

    await expect(reader.page(PAGE_ID)).resolves.toMatchObject({ dataSourceId: 'ds' });
  });

  it('leaves properties that are not relations untouched', async () => {
    const page = pageWith({
      Deadline: {
        id: 'p_deadline',
        type: 'date',
        date: { start: '2026-09-25', end: null, time_zone: null },
      },
    });

    jest.spyOn(notion.pages, 'retrieve').mockResolvedValue(page);

    const result = await reader.page(PAGE_ID);

    expect(result.properties.get(propertyIdFromNotion('p_deadline'))?.type).toBe('date');
  });

  it('a page without content is an access refusal, not an empty record', async () => {
    const partial: PartialPageObjectResponse = { object: 'page', id: PAGE_ID };

    jest.spyOn(notion.pages, 'retrieve').mockResolvedValue(partial);

    await expect(reader.page(PAGE_ID)).rejects.toThrow(NotionAccessError);
  });
});
