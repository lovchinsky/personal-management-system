import { randomUUID } from 'node:crypto';
import {
  APIErrorCode,
  type CommentObjectResponse,
  type CreateCommentParameters,
  type PageObjectResponse,
} from '@notionhq/client';
import { RestPage } from '../../src/notion/client/page';
import { PropertyWrites } from '../../src/notion/client/property-write';
import { taskAsCreated } from './capture-world';
import { notionAnswer } from './notion-answer.fixture';

/** A page creation request, as the system's write boundary sends it. */
interface PageCreation {
  readonly parent: { readonly data_source_id: string };
  readonly properties: PropertyWrites;
}

/** A page update request, as the system's write boundary sends it. */
interface PageUpdate {
  readonly page_id: string;
  readonly properties?: PropertyWrites;
  readonly in_trash?: boolean;
}

/** What reached Notion as a write, in request order. */
type NotionWrite =
  | { readonly method: 'comments.create'; readonly params: CreateCommentParameters }
  | { readonly method: 'pages.create'; readonly params: PageCreation }
  | { readonly method: 'pages.update'; readonly params: PageUpdate };

/**
 * The part of Notion that the system writes to, on behalf of the bot `bot`.
 *
 * A comment on a page goes into the page's discussion. A page has one discussion, opened by the
 * first comment. A comment in a thread stays in that thread. A created page is a Task with all the
 * properties of the database. `refusing` is a request that Notion answers with `validation_error`
 * instead of writing. `signedBy` is who the responses to writes are attributed to instead of the
 * bot: the token of a foreign integration. Notion returns a page with the database that `place`
 * put it in. Any other page is returned without a database, except those that do not exist for the
 * integration (`gone`).
 */
export class WritingNotion {
  readonly sent: NotionWrite[] = [];
  refusing: NotionWrite['method'] | null = null;
  signedBy: string | null = null;
  /** A page's discussion: one per page. */
  private readonly discussionOfPage = new Map<string, string>();
  /** Thread → the page it lives on. */
  private readonly pageOfDiscussion = new Map<string, string>();
  /** Page → the data source it sits in. */
  private readonly dataSourceOfPage = new Map<string, string>();
  /** Pages that do not exist for the integration: a read answers `object_not_found`. */
  readonly gone = new Set<string>();

  constructor(private readonly bot: string) {}

  /** Comments only, for tests that expect no other writes. */
  get created(): CreateCommentParameters[] {
    return this.sent.flatMap((write) => (write.method === 'comments.create' ? [write.params] : []));
  }

  readonly comments = {
    create: (params: CreateCommentParameters): Promise<CommentObjectResponse> => {
      this.send({ method: 'comments.create', params });

      const [discussionId, pageId] =
        'discussion_id' in params
          ? [params.discussion_id, this.pageOfDiscussion.get(params.discussion_id) ?? 'page-1']
          : this.pageDiscussion('page_id' in params.parent ? params.parent.page_id : 'page-1');

      return Promise.resolve({
        object: 'comment',
        id: randomUUID(),
        parent: { type: 'page_id', page_id: pageId },
        discussion_id: discussionId,
        created_time: new Date().toISOString(),
        last_edited_time: new Date().toISOString(),
        created_by: { object: 'user', id: this.signedBy ?? this.bot },
        rich_text: [],
        display_name: { type: 'integration', resolved_name: 'personal-management-system' },
      });
    },
  };

  readonly pages = {
    retrieve: ({ page_id }: { readonly page_id: string }): Promise<PageObjectResponse> => {
      if (this.gone.has(page_id)) {
        return Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404));
      }

      const dataSourceId = this.dataSourceOfPage.get(page_id);

      return Promise.resolve(
        this.response({
          id: page_id,
          parent:
            dataSourceId === undefined
              ? { type: 'workspace', workspace: true }
              : { type: 'data_source_id', data_source_id: dataSourceId, database_id: 'db' },
          last_edited_time: new Date().toISOString(),
          in_trash: false,
          properties: {},
        }),
      );
    },
    create: (params: PageCreation): Promise<PageObjectResponse> => {
      this.send({ method: 'pages.create', params });

      return Promise.resolve(this.response(taskAsCreated(randomUUID(), params.properties)));
    },
    update: (params: PageUpdate): Promise<PageObjectResponse> => {
      this.send({ method: 'pages.update', params });

      return Promise.resolve(
        this.response({
          id: params.page_id,
          parent: { type: 'workspace', workspace: true },
          last_edited_time: new Date().toISOString(),
          in_trash: params.in_trash ?? false,
          properties: {},
        }),
      );
    },
  };

  /** Puts the page in the data source `dataSourceId`. */
  place(pageId: string, dataSourceId: string): void {
    this.dataSourceOfPage.set(pageId, dataSourceId);
  }

  /** Forgets what was written, between tests. */
  reset(): void {
    this.sent.length = 0;
    this.refusing = null;
    this.signedBy = null;
    this.discussionOfPage.clear();
    this.pageOfDiscussion.clear();
    this.dataSourceOfPage.clear();
    this.gone.clear();
  }

  private send(write: NotionWrite): void {
    if (this.refusing === write.method) throw notionAnswer(APIErrorCode.ValidationError, 400);

    this.sent.push(write);
  }

  /** Returns a page's discussion: the existing one, or one opened by this comment. */
  private pageDiscussion(pageId: string): [string, string] {
    const discussionId = this.discussionOfPage.get(pageId) ?? randomUUID();

    this.discussionOfPage.set(pageId, discussionId);
    this.pageOfDiscussion.set(discussionId, pageId);

    return [discussionId, pageId];
  }

  /** Builds a full response to a write, on behalf of the bot unless said otherwise. */
  private response(page: RestPage): PageObjectResponse {
    const author = { object: 'user', id: this.signedBy ?? this.bot } as const;

    return {
      object: 'page',
      id: page.id,
      created_time: page.last_edited_time,
      last_edited_time: page.last_edited_time,
      in_trash: page.in_trash,
      archived: page.in_trash,
      is_archived: page.in_trash,
      is_locked: false,
      url: `https://www.notion.so/${page.id.replaceAll('-', '')}`,
      public_url: null,
      parent: page.parent,
      properties: { ...page.properties },
      icon: null,
      cover: null,
      created_by: author,
      last_edited_by: author,
    };
  }
}
