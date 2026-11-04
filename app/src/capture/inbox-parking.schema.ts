import { z } from 'zod';
import { MAX_COMMENT_CHARS } from '../attention/comment.schema';

/**
 * The longest Inbox item title allowed: a title is not a description but what the item is found
 * by.
 */
const MAX_INBOX_TITLE_CHARS = 500;

/** The longest Inbox item text allowed: as much as the system writes to one property. */
const MAX_INBOX_TEXT_CHARS = 20_000;

/**
 * An Inbox item the system parks: what the person said and what was left unresolved
 * (`docs/3-policy.md` § “Where the item appears”).
 *
 * The item has no status property and no processed flag (`INV-010`). It has only what the
 * person said (a title and, if needed, a text) and the system's reasoning as a comment, if
 * there is one. Extra fields get a refusal, not silence (`INV-090`).
 */
export const inboxParkingSchema = z.strictObject({
  title: z.string().trim().min(1, 'the Inbox title is empty').max(MAX_INBOX_TITLE_CHARS),
  text: z.string().trim().min(1, 'the Inbox text is blank').max(MAX_INBOX_TEXT_CHARS).optional(),
  comment: z
    .string()
    .trim()
    .min(1, 'the reasoning comment is empty')
    .max(MAX_COMMENT_CHARS, `longer than ${MAX_COMMENT_CHARS} characters`)
    .optional(),
});

/** The item as requested. */
export type InboxParkingRequest = z.input<typeof inboxParkingSchema>;

/** The item after the schema check. */
export type InboxParking = z.output<typeof inboxParkingSchema>;
