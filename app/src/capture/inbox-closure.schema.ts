import { z } from 'zod';
import { MAX_COMMENT_CHARS } from '../attention/comment.schema';
import { notionIdSchema } from '../notion/client/notion-id';

/**
 * Why an Inbox item is closed without a Task: junk, a duplicate of an existing Task, or a
 * reference already stored in GBrain. All three are decisions that resolved the item, not
 * deferrals (`docs/3-policy.md` § “Flow”).
 */
export const INBOX_CLOSURE_REASONS = ['trash', 'duplicate', 'reference'] as const;

/**
 * Closing an Inbox item without a Task is a system intent (ADR 0023): an origin comment that
 * says what the item became, and the trash. The order is the same as in a conversion, because
 * Notion does not accept a comment on a page in the trash.
 *
 * `duplicateOf` is the existing Task the item repeats, and only for a duplicate: the comment
 * will mention that Task, and the person will go to it.
 */
export const inboxClosureSchema = z
  .strictObject({
    inboxPageId: notionIdSchema,
    reason: z.enum(INBOX_CLOSURE_REASONS),
    duplicateOf: notionIdSchema.optional(),
    comment: z
      .string()
      .trim()
      .min(1, 'the origin comment is empty')
      .max(MAX_COMMENT_CHARS, `longer than ${MAX_COMMENT_CHARS} characters`),
  })
  .refine(
    (closure) => (closure.reason === 'duplicate') === (closure.duplicateOf !== undefined),
    'duplicate_of names the existing task, and only for the reason duplicate',
  );

/** The closure as requested: ids are not yet in canonical form. */
export type InboxClosureRequest = z.input<typeof inboxClosureSchema>;

/** The closure after the schema check. */
export type InboxClosure = z.output<typeof inboxClosureSchema>;
