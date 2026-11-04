import { z } from 'zod';
import { INBOX_CLOSURE_REASONS, InboxClosureRequest } from './inbox-closure.schema';

/**
 * Closing an Inbox item on the App MCP wire (`close_inbox_item`): the same fields as in
 * `inboxClosureSchema`, under wire names.
 */
export const inboxClosureWireSchema = z.strictObject({
  inbox_page_id: z.string().min(1),
  reason: z.enum(INBOX_CLOSURE_REASONS),
  duplicate_of: z.string().min(1).optional(),
  comment: z.string(),
});

export type InboxClosureWire = z.infer<typeof inboxClosureWireSchema>;

export function inboxClosureRequestOf(wire: InboxClosureWire): InboxClosureRequest {
  return {
    inboxPageId: wire.inbox_page_id,
    reason: wire.reason,
    duplicateOf: wire.duplicate_of,
    comment: wire.comment,
  };
}
