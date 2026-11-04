import { Test } from '@nestjs/testing';
import { Client, type PageObjectResponse } from '@notionhq/client';
import { RestProperty } from '../../src/notion/client/page';
import { PageReader } from '../../src/notion/client/page.reader';
import { propertyIdFromNotion } from '../../src/notion/client/property-id';

/**
 * `INV-003` The adapter is access configuration. Current property values are always read from
 * Notion and are not cached as domain state.
 *
 * The second half of the invariant is that the database has no column that would hold a property
 * value. That half is checked against the live database in
 * `app/test/integration/schema-shape.spec.ts`.
 */
describe('INV-003', () => {
  const user = { object: 'user', id: 'user-1' } as const;

  function pageWith(title: string): PageObjectResponse {
    const name: RestProperty = {
      id: 'title',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: title, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default',
          },
          plain_text: title,
          href: null,
        },
      ],
    };

    return {
      object: 'page',
      id: 'page-1',
      created_time: '2026-09-24T08:00:00.000Z',
      last_edited_time: '2026-09-24T08:00:00.000Z',
      in_trash: false,
      archived: false,
      is_archived: false,
      is_locked: false,
      url: 'https://notion.so/page-1',
      public_url: null,
      parent: { type: 'data_source_id', data_source_id: 'ds', database_id: 'db' },
      properties: { Name: name },
      icon: null,
      cover: null,
      created_by: user,
      last_edited_by: user,
    };
  }

  let reader: PageReader;
  let notion: Client;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PageReader, { provide: Client, useValue: new Client({ auth: 'test' }) }],
    }).compile();

    reader = moduleRef.get(PageReader);
    notion = moduleRef.get(Client);
  });

  it('every read goes to Notion, not to memory', async () => {
    const retrieve = jest.spyOn(notion.pages, 'retrieve').mockResolvedValue(pageWith('перший'));

    await reader.page('page-1');
    await reader.page('page-1');

    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('a value changed in Notion shows on the next read', async () => {
    jest
      .spyOn(notion.pages, 'retrieve')
      .mockResolvedValueOnce(pageWith('перший'))
      .mockResolvedValueOnce(pageWith('другий'));

    const before = await reader.page('page-1');
    const after = await reader.page('page-1');

    const title = propertyIdFromNotion('title');

    expect(before.properties.get(title)).not.toEqual(after.properties.get(title));
  });
});
