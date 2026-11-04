import { NotificationChannel, OutboundMessage } from './channel.port';

/**
 * Returns the packet as the channel sees it. Buttons derive from proposals: for a channel that
 * supports them, the sender adds “approve” and “reject” to each proposal, and for a channel
 * without them, none (`INV-021`). The decision stays in the packet: the proposal lines, `ask` and
 * the link do not disappear, only the way to press a button does.
 *
 * The sender decides how to degrade, not the channel: the channel only declares what it is.
 */
export function packetFor(channel: NotificationChannel, message: OutboundMessage): OutboundMessage {
  const proposals = message.proposals ?? [];

  if (!channel.capabilities.interactiveActions || proposals.length === 0) {
    return { ...message, actions: undefined };
  }

  return {
    ...message,
    actions: proposals.flatMap(({ pendingActionId }) => [
      { kind: 'approve' as const, pendingActionId },
      { kind: 'reject' as const, pendingActionId },
    ]),
  };
}
