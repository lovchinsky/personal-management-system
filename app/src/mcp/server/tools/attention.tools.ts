import { MAX_COMMENT_CHARS } from '../../../attention/comment.schema';
import { commentRequestOf, CommentWire, commentWireSchema } from '../../../attention/comment.wire';
import { AppTool, defineTool, ToolContext, writeAnswer, WRITES } from './app-tool';

/**
 * Writes a comment. A comment on a page gets a temporary id for the page's discussion. The
 * continuation, proposal, delivery and reply of the same run see that id, and applying the writes
 * substitutes the real one. A reply stays in the thread it names.
 */
async function stage(context: ToolContext, input: CommentWire): Promise<object> {
  const { write, ref } = await context.session.writes.submit('comment', commentRequestOf(input));

  return writeAnswer(context, { discussion_id: write.discussionId ?? ref });
}

export const ATTENTION_TOOLS: readonly AppTool[] = [
  defineTool({
    name: 'add_comment',
    capability: 'comment_write',
    // The response is the write marker and the thread id.
    bound: 1_000,
    description:
      "Write a comment in the system's voice: Notion signs it with the integration bot, not " +
      "with the person. Name the page (page_id): without discussion_id the comment goes into the page's " +
      'own discussion, which Notion keeps one per page and opens with the first comment; with ' +
      'discussion_id it replies in that thread. The answer names the discussion_id, usable in ' +
      "this run's continuations, proposals, notifications and replies. Plain text for a person, " +
      `at most ${MAX_COMMENT_CHARS} characters, without machine state. ${WRITES}`,
    inputSchema: commentWireSchema,
    handle: stage,
  }),
];
