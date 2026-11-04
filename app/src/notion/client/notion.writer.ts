import { Injectable } from '@nestjs/common';
import {
  Client,
  isFullComment,
  isFullPage,
  type CreateCommentParameters,
  type CreatePageResponse,
  type PageObjectResponse,
} from '@notionhq/client';
import { BotIdentity } from './bot-identity';
import { UnconfirmedWriteError, WriteOperation } from './notion.error';
import { canonicalPage, Page } from './page';
import { PropertyWrites, textRuns } from './property-write';

/** The comment text on the wire, in the form the SDK accepts: text and mentions. */
type CommentRichText = Extract<CreateCommentParameters, { rich_text: unknown }>['rich_text'];

/**
 * Where a comment goes. Sent to a page, a comment goes into the page discussion (Notion keeps one
 * per page and opens it with the first comment). Sent to a discussion, it is a reply in that
 * discussion.
 */
export type CommentTarget = { readonly pageId: string } | { readonly discussionId: string };

export interface WrittenComment {
  readonly commentId: string;
  readonly discussionId: string;
  /**
   * The thread's page, if Notion names it. A thread on a block names the block, and then `pageId`
   * is `null`.
   */
  readonly pageId: string | null;
  /** The thread's block, if the comment landed on a block; `null` for a thread on a page. */
  readonly blockId: string | null;
}

/**
 * The single boundary of the system's writes to Notion (`INV-086`, `docs/2-system.md`
 * § “System writes to Notion”).
 *
 * There are four operations, and each writes as the integration bot: a comment, page creation, a
 * property change, the trash. The boundary does not write the page body (`INV-008`). It receives
 * values already encoded by the adapter and knows no canonical values.
 *
 * Every response is checked: it must be full, and its author must be the bot. Otherwise the write
 * is unconfirmed (`UnconfirmedWriteError`). While the bot identity is unknown, nothing is
 * written: there is nothing to check the author against.
 */
@Injectable()
export class NotionWriter {
  constructor(
    private readonly notion: Client,
    private readonly identity: BotIdentity,
  ) {}

  /**
   * Writes a comment as the bot. `mention` is a page the comment mentions after its text: Notion
   * shows its title and links to it, so the reference stays readable to a person and is not an
   * internal string. `label` is the name under which Notion shows the comment: the kind label of
   * the write, taken from the text catalog (ADR 0043), never a person's name. The author remains
   * the bot.
   */
  async comment(
    target: CommentTarget,
    text: string,
    {
      mention,
      label,
    }: { readonly mention?: { readonly pageId: string }; readonly label?: string } = {},
  ): Promise<WrittenComment> {
    const bot = await this.identity.require();
    const rich_text: CommentRichText = [
      ...textRuns(text),
      ...(mention
        ? [
            { type: 'text' as const, text: { content: '\n' } },
            { type: 'mention' as const, mention: { page: { id: mention.pageId } } },
          ]
        : []),
    ];
    const shown = label === undefined ? {} : { display_name: displayed(label) };
    const response = await this.notion.comments.create(
      'pageId' in target
        ? { parent: { page_id: target.pageId }, rich_text, ...shown }
        : { discussion_id: target.discussionId, rich_text, ...shown },
    );

    if (!isFullComment(response)) {
      throw new UnconfirmedWriteError(
        'comment',
        response.id,
        'returned a partial comment — the integration cannot read comments',
      );
    }

    authoredBy(bot, 'comment', response.id, response.created_by.id);

    return {
      commentId: response.id,
      discussionId: response.discussion_id,
      pageId: response.parent.type === 'page_id' ? response.parent.page_id : null,
      blockId: response.parent.type === 'block_id' ? response.parent.block_id : null,
    };
  }

  /** Creates a new page in a data source, with already encoded properties. */
  async createPage(dataSourceId: string, properties: PropertyWrites): Promise<Page> {
    const bot = await this.identity.require();
    const page = confirmedPage(
      'creation of page',
      await this.notion.pages.create({ parent: { data_source_id: dataSourceId }, properties }),
      bot,
      (created) => created.created_by.id,
    );

    return canonicalPage(page);
  }

  /**
   * Changes the properties of a page. Returns the page after the write, to check against what is
   * read back.
   */
  async updateProperties(pageId: string, properties: PropertyWrites): Promise<Page> {
    const bot = await this.identity.require();
    const page = confirmedPage(
      'update of page',
      await this.notion.pages.update({ page_id: pageId, properties }),
      bot,
      (updated) => updated.last_edited_by.id,
    );

    return canonicalPage(page);
  }

  /**
   * Moves a page to the trash. The move is reversible: Notion brings the page back from there in
   * the same way.
   */
  async archive(pageId: string): Promise<void> {
    const bot = await this.identity.require();

    confirmedPage(
      'archive of page',
      await this.notion.pages.update({ page_id: pageId, in_trash: true }),
      bot,
      (trashed) => trashed.last_edited_by.id,
    );
  }
}

/**
 * Returns the page from the response to a write. The page must be full and written by the
 * integration bot; otherwise the write is unconfirmed.
 */
function confirmedPage(
  operation: WriteOperation,
  response: CreatePageResponse,
  bot: string,
  authorOf: (page: PageObjectResponse) => string,
): PageObjectResponse {
  if (!isFullPage(response)) {
    throw new UnconfirmedWriteError(
      operation,
      response.id,
      'returned a partial page — the integration cannot read content',
    );
  }

  authoredBy(bot, operation, response.id, authorOf(response));

  return response;
}

function authoredBy(bot: string, operation: WriteOperation, id: string, author: string): void {
  if (author !== bot) {
    throw new UnconfirmedWriteError(
      operation,
      id,
      `attributed it to ${author}, not to the integration bot ${bot} — ` +
        'NOTION_API_TOKEN belongs to another integration',
    );
  }
}

/**
 * Returns the name under which Notion shows a comment. An internal integration can use only its
 * own name or an arbitrary one (`custom`), because Notion does not let it show a person as the
 * author (measured). The label does not pretend to: it says what kind of write this is.
 */
function displayed(label: string): NonNullable<CreateCommentParameters['display_name']> {
  return { type: 'custom', custom: { name: label } };
}
