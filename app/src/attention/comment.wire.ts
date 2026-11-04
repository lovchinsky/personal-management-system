import { z } from 'zod';
import { CommentRequest } from './comment.schema';

/**
 * A comment on the App MCP wire (`add_comment`): the same fields as in `commentSchema`, under
 * their wire names. Only the shape is checked here; the capability checks the text limits and the
 * canonical ids with `commentSchema`, as it does for any other input.
 */
export const commentWireSchema = z.strictObject({
  page_id: z.string().min(1),
  discussion_id: z.string().min(1).optional(),
  text: z.string(),
});

export type CommentWire = z.infer<typeof commentWireSchema>;

export function commentRequestOf(wire: CommentWire): CommentRequest {
  return { pageId: wire.page_id, discussionId: wire.discussion_id, text: wire.text };
}
