import { z } from 'zod';
import { ReasonCode } from '../generated/prisma/enums';
import { discussionIdSchema, notionIdSchema } from '../notion/client/notion-id';

/**
 * A continuation request has one shape for everyone who makes it: an App run through the App MCP,
 * or a snooze in the person's words, whether in a thread reply, in the channel or in the chat.
 *
 * An empty thread string is not a thread, and the schema does not let it through: every page with
 * an empty “name” would share one thread and one continuation.
 *
 * Page and thread ids take one form (`canonicalNotionId`): otherwise the same thread with an id
 * without hyphens would get a second row.
 *
 * Extra fields are refused, not passed over in silence: a misspelled `discusionId`, silently
 * dropped, would turn a thread's continuation into a page's continuation and give the thread a
 * second row.
 */
export const continuationSchema = z.strictObject({
  /** The attention thread, if a conversation has already taken place. */
  discussionId: discussionIdSchema.optional(),
  notionPageId: notionIdSchema,
  runAt: z.date(),
  reasonCode: z.enum(ReasonCode),
});

/** A continuation as it is requested: the ids are not yet in canonical form. */
export type ContinuationRequest = z.input<typeof continuationSchema>;

/** A continuation after validation: the ids are canonical. */
export type Continuation = z.output<typeof continuationSchema>;

/**
 * A question about the state of continuations: about a thread, or about a page, possibly with a
 * reason. A thread addresses itself, while a page without a thread can have several
 * continuations, so the reason narrows only a question about a page.
 */
export type ContinuationQuery =
  | { readonly discussionId: string }
  | { readonly notionPageId: string; readonly reasonCode?: ReasonCode };
