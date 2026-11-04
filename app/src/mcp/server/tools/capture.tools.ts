import {
  inboxClosureRequestOf,
  InboxClosureWire,
  inboxClosureWireSchema,
} from '../../../capture/inbox-closure.wire';
import {
  inboxConversionRequestOf,
  InboxConversionWire,
  inboxConversionWireSchema,
} from '../../../capture/inbox-conversion.wire';
import {
  inboxParkingRequestOf,
  InboxParkingWire,
  inboxParkingWireSchema,
} from '../../../capture/inbox-parking.wire';
import { AppTool, defineTool, ToolContext, writeAnswer, WRITES } from './app-tool';

/**
 * Writes a conversion. The new Task gets a temporary page id. The comment and the continuation
 * of the same run see that id, and applying the writes substitutes the real one.
 */
async function stage(context: ToolContext, input: InboxConversionWire): Promise<object> {
  const { ref } = await context.session.writes.submit(
    'inbox_conversion',
    inboxConversionRequestOf(input),
  );

  return writeAnswer(context, { task_page_id: ref });
}

/** Closes an Inbox item without a Task: an origin comment and the trash. */
async function close(context: ToolContext, input: InboxClosureWire): Promise<object> {
  await context.session.writes.submit('inbox_closure', inboxClosureRequestOf(input));

  return writeAnswer(context, { inbox_page_id: input.inbox_page_id, reason: input.reason });
}

/** Parks an Inbox item that stayed unresolved: a page in the Inbox and a reasoning comment. */
async function park(context: ToolContext, input: InboxParkingWire): Promise<object> {
  const { ref } = await context.session.writes.submit('inbox_item', inboxParkingRequestOf(input));

  return writeAnswer(context, { inbox_page_id: ref });
}

export const CAPTURE_TOOLS: readonly AppTool[] = [
  defineTool({
    name: 'convert_inbox_item',
    capability: 'capture_convert',
    // The response is the write marker and the Task id.
    bound: 1_000,
    description:
      "Convert an Inbox item into a Task in the system's voice: the task is created, the item " +
      'gets an origin comment that mentions the task, and the item goes to the trash — one ' +
      'intent. Only an open canonical status (Next Action, Scheduled, Waiting For, ' +
      'Someday/Maybe); a planned date means Scheduled, not Next Action. Links may point to ' +
      'existing pages of the data source their property points to, and a project link never ' +
      'leads to a Done or Canceled project; the task gets no body. ' +
      "Returns the new task's page id, usable in this run's comments and continuations. " +
      WRITES,
    inputSchema: inboxConversionWireSchema,
    handle: stage,
  }),
  defineTool({
    name: 'close_inbox_item',
    capability: 'capture_close',
    bound: 1_000,
    description:
      "Close an Inbox item that resolves without a new Task, in the system's voice: an origin " +
      'comment says what the item turned out to be, then the item goes to the trash — one ' +
      'intent. reason: trash (not actionable, nothing to keep), duplicate (an existing open ' +
      'task already covers it — name it in duplicate_of, the comment mentions it) or ' +
      'reference (the fact it carried is already kept in long-term memory). An item that needs ' +
      'a decision of the person is not closed: leave it in the Inbox with a comment. ' +
      WRITES,
    inputSchema: inboxClosureWireSchema,
    handle: close,
  }),
  defineTool({
    name: 'park_inbox_item',
    capability: 'capture_park',
    bound: 1_000,
    description:
      'Park in the Inbox what the person said and the conversation could not resolve: a page ' +
      "in the Inbox in the system's voice (title, optional full text) and a comment with your " +
      'reasoning — what is unclear and what you would ask. Use it when the person is gone or ' +
      'there is nothing left to ask now; if they are present, ask first. Never park what you ' +
      'resolved. Returns the new item page id. ' +
      WRITES,
    inputSchema: inboxParkingWireSchema,
    handle: park,
  }),
];
