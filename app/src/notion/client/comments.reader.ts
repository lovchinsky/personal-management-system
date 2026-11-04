import { Injectable } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { canonicalNotionId } from './notion-id';
import { isObjectNotFound } from './notion.error';

/** How many comments to fetch per request. Notion allows up to 100. */
const COMMENTS_PAGE_SIZE = 100;

/**
 * Reads comments over REST for the App's deterministic steps.
 *
 * Notion returns only unresolved comments, and a listing by page id does not see threads on
 * blocks. A listing by block id returns them (measured, `docs/2-system.md` § “Resolution”).
 */
@Injectable()
export class CommentsReader {
  constructor(private readonly notion: Client) {}

  /**
   * Returns the threads with unresolved comments on a page or block, as `discussion_id` in
   * canonical form.
   */
  async openDiscussions(anchorId: string): Promise<ReadonlySet<string>> {
    const discussions = new Set<string>();
    let cursor: string | undefined = undefined;

    do {
      const response = await this.notion.comments.list({
        block_id: anchorId,
        start_cursor: cursor,
        page_size: COMMENTS_PAGE_SIZE,
      });

      for (const comment of response.results) {
        discussions.add(canonicalNotionId(comment.discussion_id));
      }

      cursor = response.next_cursor ?? undefined;
    } while (cursor !== undefined);

    return discussions;
  }

  /**
   * Checks whether the comment still exists. By id Notion returns both a comment of a resolved
   * thread and a deleted one, the latter with the `original_content_deleted` marker (measured).
   * `false` means the comment is deleted or Notion cannot find it. Other failures propagate,
   * because they say nothing about the comment.
   */
  async exists(commentId: string): Promise<boolean> {
    try {
      const comment = await this.notion.comments.retrieve({ comment_id: commentId });

      return !('original_content_deleted' in comment && comment.original_content_deleted === true);
    } catch (error) {
      if (isObjectNotFound(error)) return false;

      throw error;
    }
  }
}
