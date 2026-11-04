import { z } from 'zod';
import { discussionIdSchema, notionIdSchema } from '../notion/client/notion-id';

/**
 * The longest comment the system writes. The person reads a comment in a Notion thread, so the
 * limit keeps it a conversation, not a report: anything longer belongs on a page or in a run's
 * conclusion, not in a thread.
 */
export const MAX_COMMENT_CHARS = 4_000;

/**
 * A comment in the system's voice, as the attention capability accepts it.
 *
 * The page is always specified: a thread lives on a page, and the registry of discussions
 * remembers it. The thread is specified only for a reply in it: without a thread the comment goes
 * into the page's discussion — Notion keeps one per page and opens it with the first comment. Ids
 * are in one form (`canonicalNotionId`), as in a continuation: otherwise the same thread with an
 * id without hyphens would be a different one.
 *
 * An extra field gets a refusal, not silence (`INV-090`): a silently dropped thread would move
 * the reply into the page's discussion.
 */
export const commentSchema = z.strictObject({
  pageId: notionIdSchema,
  discussionId: discussionIdSchema.optional(),
  text: z
    .string()
    .trim()
    .min(1, 'the text is empty')
    .max(
      MAX_COMMENT_CHARS,
      `longer than ${MAX_COMMENT_CHARS} characters — a comment is a message to a person, not a report`,
    ),
});

/** A comment as it is requested: the ids are not yet converted. */
export type CommentRequest = z.input<typeof commentSchema>;

/** A comment after the check: ids are canonical, the text is trimmed. */
export type Comment = z.output<typeof commentSchema>;
