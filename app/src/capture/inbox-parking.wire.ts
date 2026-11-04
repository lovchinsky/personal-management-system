import { z } from 'zod';
import { InboxParkingRequest } from './inbox-parking.schema';

/**
 * An Inbox item on the App MCP wire (`park_inbox_item`): the same fields as in
 * `inboxParkingSchema`. The reasoning comment is required here, because in a conversation an
 * item is parked when something is left unresolved, and what was left unresolved is the trail
 * for the person (`INV-015`). The capability checks the limits and rules.
 */
export const inboxParkingWireSchema = z.strictObject({
  title: z.string(),
  text: z.string().optional(),
  comment: z.string(),
});

export type InboxParkingWire = z.infer<typeof inboxParkingWireSchema>;

export function inboxParkingRequestOf(wire: InboxParkingWire): InboxParkingRequest {
  return { title: wire.title, text: wire.text, comment: wire.comment };
}
