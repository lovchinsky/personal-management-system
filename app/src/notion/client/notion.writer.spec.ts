import { Test } from '@nestjs/testing';
import {
  Client,
  type CreateCommentParameters,
  type CreateCommentResponse,
  type CreatePageParameters,
  type CreatePageResponse,
  type UpdatePageParameters,
} from '@notionhq/client';
import { INTEGRATION_BOT } from '../../../test/fixtures/notion-bot';
import { BotIdentity } from './bot-identity';
import { UnconfirmedWriteError } from './notion.error';
import { NotionWriter, WrittenComment } from './notion.writer';
import { PropertyWrites } from './property-write';

const PERSON = '61313cf4-0000-4000-8000-000000000001';
const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const DISCUSSION = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

const PROPERTIES: PropertyWrites = {
  title: { title: [{ type: 'text', text: { content: 'Подзвонити в банк' } }] },
  'p_task%7Bstatus': { status: { id: 'opt_next_action' } },
};

/** What reached Notion: the method and the request body. */
type Sent =
  | { readonly method: 'comments.create'; readonly params: CreateCommentParameters }
  | { readonly method: 'pages.create'; readonly params: CreatePageParameters }
  | { readonly method: 'pages.update'; readonly params: UpdatePageParameters };

/**
 * The part of Notion that the writing boundary uses. It records every request and answers on
 * behalf of `author`. With `partial` set, the integration lacks permission to read: Notion saves
 * the write but answers with the id only.
 */
class RecordingNotion {
  readonly sent: Sent[] = [];
  author = INTEGRATION_BOT;
  partial = false;

  readonly comments = {
    create: (params: CreateCommentParameters): Promise<CreateCommentResponse> => {
      this.sent.push({ method: 'comments.create', params });

      return Promise.resolve(this.comment());
    },
  };

  readonly pages = {
    create: (params: CreatePageParameters): Promise<CreatePageResponse> => {
      this.sent.push({ method: 'pages.create', params });

      return Promise.resolve(this.page());
    },
    update: (params: UpdatePageParameters): Promise<CreatePageResponse> => {
      this.sent.push({ method: 'pages.update', params });

      return Promise.resolve(this.page());
    },
  };

  private comment(): CreateCommentResponse {
    if (this.partial) return { object: 'comment', id: 'comment-1' };

    return {
      object: 'comment',
      id: 'comment-1',
      parent: { type: 'page_id', page_id: PAGE },
      discussion_id: DISCUSSION,
      created_time: '2026-09-29T10:00:00.000Z',
      last_edited_time: '2026-09-29T10:00:00.000Z',
      created_by: { object: 'user', id: this.author },
      rich_text: [],
      display_name: { type: 'integration', resolved_name: 'personal-management-system' },
    };
  }

  private page(): CreatePageResponse {
    if (this.partial) return { object: 'page', id: PAGE };

    const author = { object: 'user', id: this.author } as const;

    return {
      object: 'page',
      id: PAGE,
      created_time: '2026-09-29T10:00:00.000Z',
      last_edited_time: '2026-09-29T10:00:00.000Z',
      in_trash: false,
      archived: false,
      is_archived: false,
      is_locked: false,
      url: 'https://notion.so/page',
      public_url: null,
      parent: { type: 'data_source_id', data_source_id: 'ds_task', database_id: 'db_task' },
      properties: {},
      icon: null,
      cover: null,
      created_by: author,
      last_edited_by: author,
    };
  }
}

interface Writing {
  readonly writer: NotionWriter;
  readonly notion: RecordingNotion;
}

/** `null` means Notion never said who we are. */
async function writerOver(known: string | null = INTEGRATION_BOT): Promise<Writing> {
  const notion = new RecordingNotion();
  const identity: Pick<BotIdentity, 'require'> = {
    require: () =>
      known
        ? Promise.resolve(known)
        : Promise.reject(new Error('the integration bot identity is unknown')),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      NotionWriter,
      { provide: Client, useValue: notion },
      { provide: BotIdentity, useValue: identity },
    ],
  }).compile();

  return { writer: moduleRef.get(NotionWriter), notion };
}

describe('NotionWriter', () => {
  it('a comment on a page goes into the page discussion', async () => {
    const { writer, notion } = await writerOver();
    const expected: Sent[] = [
      {
        method: 'comments.create',
        params: {
          parent: { page_id: PAGE },
          rich_text: [{ type: 'text', text: { content: 'Чекаю на відповідь банку' } }],
        },
      },
    ];
    const written: WrittenComment = {
      commentId: 'comment-1',
      discussionId: DISCUSSION,
      pageId: PAGE,
      blockId: null,
    };

    await expect(writer.comment({ pageId: PAGE }, 'Чекаю на відповідь банку')).resolves.toEqual(
      written,
    );
    expect(notion.sent).toEqual(expected);
  });

  it('a reply in a discussion stays in it', async () => {
    const { writer, notion } = await writerOver();
    const expected: Sent[] = [
      {
        method: 'comments.create',
        params: {
          discussion_id: DISCUSSION,
          rich_text: [{ type: 'text', text: { content: 'Дякую' } }],
        },
      },
    ];

    await writer.comment({ discussionId: DISCUSSION }, 'Дякую');

    expect(notion.sent).toEqual(expected);
  });

  /**
   * The label is only the name under which Notion shows the comment (ADR 0043): the author remains
   * the bot, so the rule “an event is our own when its author is the bot” does not change. Without
   * a label, the name is the integration's.
   */
  it('a comment label is the displayed name, not the author', async () => {
    const { writer, notion } = await writerOver();
    const expected: Sent[] = [
      {
        method: 'comments.create',
        params: {
          discussion_id: DISCUSSION,
          rich_text: [{ type: 'text', text: { content: 'Відклади до понеділка' } }],
          display_name: { type: 'custom', custom: { name: 'Відповідь з Telegram' } },
        },
      },
    ];

    await writer.comment({ discussionId: DISCUSSION }, 'Відклади до понеділка', {
      label: 'Відповідь з Telegram',
    });

    expect(notion.sent).toEqual(expected);
  });

  it('creates a page in the data source with encoded properties', async () => {
    const { writer, notion } = await writerOver();
    const expected: Sent[] = [
      {
        method: 'pages.create',
        params: { parent: { data_source_id: 'ds_task' }, properties: PROPERTIES },
      },
    ];

    await expect(writer.createPage('ds_task', PROPERTIES)).resolves.toMatchObject({ id: PAGE });
    expect(notion.sent).toEqual(expected);
  });

  it('changes only the properties and returns the page after the write', async () => {
    const { writer, notion } = await writerOver();
    const expected: Sent[] = [
      { method: 'pages.update', params: { page_id: PAGE, properties: PROPERTIES } },
    ];

    await expect(writer.updateProperties(PAGE, PROPERTIES)).resolves.toMatchObject({ id: PAGE });
    expect(notion.sent).toEqual(expected);
  });

  it('the trash is a page mark, not a deletion', async () => {
    const { writer, notion } = await writerOver();
    const expected: Sent[] = [
      { method: 'pages.update', params: { page_id: PAGE, in_trash: true } },
    ];

    await writer.archive(PAGE);

    expect(notion.sent).toEqual(expected);
  });

  /**
   * The system's own writes are recognized by their author and checked against what is read back:
   * a write that the response does not confirm is neither a success nor a request failure.
   */
  describe('confirmation by the response', () => {
    const operations: [string, (writer: NotionWriter) => Promise<unknown>][] = [
      ['comment', (writer) => writer.comment({ pageId: PAGE }, 'x')],
      ['page creation', (writer) => writer.createPage('ds_task', PROPERTIES)],
      ['property change', (writer) => writer.updateProperties(PAGE, PROPERTIES)],
      ['trash', (writer) => writer.archive(PAGE)],
    ];

    it.each(operations)('%s attributed to a person is unconfirmed', async (_, operate) => {
      const { writer, notion } = await writerOver();

      notion.author = PERSON;

      const refusal = operate(writer);

      await expect(refusal).rejects.toThrow(UnconfirmedWriteError);
      await expect(refusal).rejects.toThrow(`attributed it to ${PERSON}`);
    });

    it.each(operations)('%s with no content in the response is unconfirmed', async (_, operate) => {
      const { writer, notion } = await writerOver();

      notion.partial = true;

      const refusal = operate(writer);

      await expect(refusal).rejects.toThrow(UnconfirmedWriteError);
      await expect(refusal).rejects.toThrow(/returned a partial/);
      expect(notion.sent).toHaveLength(1);
    });

    it.each(operations)('%s is not written at all while the bot is unknown', async (_, operate) => {
      const { writer, notion } = await writerOver(null);

      await expect(operate(writer)).rejects.toThrow('bot identity is unknown');
      expect(notion.sent).toEqual([]);
    });
  });
});
