import {
  continuationQueryOf,
  continuationQueryWireSchema,
  continuationRequestOf,
  ContinuationWire,
  continuationWireSchema,
  stagedContinuationOf,
} from '../../../continuations/continuation.wire';
import { AppTool, defineTool, ToolContext, writeAnswer, WRITES } from './app-tool';

async function stage(context: ToolContext, input: ContinuationWire): Promise<object> {
  const { write } = await context.session.writes.submit(
    'continuation',
    continuationRequestOf(input),
  );

  return writeAnswer(context, { continuation: stagedContinuationOf(write) });
}

/** “Schedule” and “reschedule” are the same call, because a thread has one open wake. */
function continuationWrite(name: string): AppTool {
  return defineTool({
    name,
    capability: 'continuation_write',
    bound: 2_000,
    description:
      'Schedule a future recheck of a discussion thread (discussion_id) or of a page. ' +
      'A thread holds one open continuation, so asking again moves it. user_snooze may be ' +
      'named only by a step where the person speaks. A run where the person does not speak ' +
      'may not set run_at sooner than an hour after the run started. ' +
      WRITES,
    inputSchema: continuationWireSchema,
    handle: stage,
  });
}

export const CONTINUATION_TOOLS: readonly AppTool[] = [
  continuationWrite('schedule_continuation'),
  continuationWrite('reschedule_continuation'),
  defineTool({
    name: 'get_continuation_state',
    capability: 'continuation_read',
    // The state of continuations is bounded per query: the limit on a page's open continuations
    // plus one written by this run for each reason.
    bound: 8_000,
    description:
      'Open continuations of a discussion thread (discussion_id) or of a page (page_id, ' +
      'optionally reason_code), including ones this run has staged. Nearest first; ' +
      'truncated: true means more are open than the answer holds.',
    inputSchema: continuationQueryWireSchema,
    handle: (context, input) =>
      context.continuations.state(
        continuationQueryOf(input),
        context.session.writes.pending('continuation').map((staged) => staged.write),
      ),
  }),
];
