import { Test } from '@nestjs/testing';
import { Client, type BlockObjectResponse, type ListBlockChildrenResponse } from '@notionhq/client';
import { BodyReader } from './body.reader';

const PAGE_ID = 'page-1';

const user = { object: 'user', id: 'user-1' } as const;

function paragraph(id: string, text: string, hasChildren = false): BlockObjectResponse {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: PAGE_ID },
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: text, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default',
          },
          plain_text: text,
          href: null,
        },
      ],
      color: 'default',
      icon: null,
    },
    created_time: '2026-09-24T08:00:00.000Z',
    created_by: user,
    last_edited_time: '2026-09-24T08:00:00.000Z',
    last_edited_by: user,
    has_children: hasChildren,
    in_trash: false,
    archived: false,
  };
}

function listOf(results: BlockObjectResponse[], next: string | null): ListBlockChildrenResponse {
  return {
    type: 'block',
    block: {},
    object: 'list',
    next_cursor: next,
    has_more: next !== null,
    results,
  };
}

const idsOf = (blocks: readonly BlockObjectResponse[]): string[] => blocks.map((block) => block.id);

describe('BodyReader', () => {
  let reader: BodyReader;
  let notion: Client;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [BodyReader, { provide: Client, useValue: new Client({ auth: 'test' }) }],
    }).compile();

    reader = moduleRef.get(BodyReader);
    notion = moduleRef.get(Client);
  });

  it('an empty body is an answer, not a refusal', async () => {
    jest.spyOn(notion.blocks.children, 'list').mockResolvedValue(listOf([], null));

    await expect(reader.body(PAGE_ID)).resolves.toEqual([]);
  });

  it('concatenates the pages of the block list', async () => {
    jest
      .spyOn(notion.blocks.children, 'list')
      .mockResolvedValueOnce(listOf([paragraph('b1', 'перший')], 'cursor-2'))
      .mockResolvedValueOnce(listOf([paragraph('b2', 'другий')], null));

    expect(idsOf(await reader.body(PAGE_ID))).toEqual(['b1', 'b2']);
  });

  it('nested blocks are part of what is read and come right after their parent', async () => {
    jest
      .spyOn(notion.blocks.children, 'list')
      .mockResolvedValueOnce(
        listOf([paragraph('toggle', 'межа', true), paragraph('after', 'далі')], null),
      )
      .mockResolvedValueOnce(listOf([paragraph('child', 'усередині')], null));

    expect(idsOf(await reader.body(PAGE_ID))).toEqual(['toggle', 'child', 'after']);
  });

  it('a partial block is skipped instead of breaking the read', async () => {
    jest
      .spyOn(notion.blocks.children, 'list')
      .mockResolvedValue(listOf([paragraph('b1', 'перший')], null));

    const list = jest.spyOn(notion.blocks.children, 'list');

    list.mockResolvedValueOnce({
      type: 'block',
      block: {},
      object: 'list',
      next_cursor: null,
      has_more: false,
      results: [{ object: 'block', id: 'partial' }, paragraph('b1', 'перший')],
    });

    expect(idsOf(await reader.body(PAGE_ID))).toEqual(['b1']);
  });
});
