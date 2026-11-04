import { ActionKind, ChannelId } from '../../delivery/port/channel.port';

/**
 * The person's intent as read from the channel: person → system.
 *
 * A button holds the kind of intent and the proposal id: exactly what delivery renders and
 * nothing more, because the executor reads the row again and revalidates the preconditions. Text
 * with no tie to a system message is `unsolicited`, because the channel serves a dialogue that the
 * system starts, and the person brings nothing new through it. Text the person sent in reply to a
 * message is a `reply`. Delivery, not the parser, knows whether that message was the system's and
 * which thread it leads to, so a `reply` holds only the message id.
 *
 * A `reply` holds the channel, the event key (`eventId`) and the time the person wrote it: the
 * evaluation window identifies the cause by the key, and the receipt identifies a redelivery.
 */
export type ChannelIntent =
  | { readonly kind: ActionKind; readonly pendingActionId: string }
  /** `repliedTo` is the id of the channel message the person replied to. */
  | ({ readonly kind: 'reply'; readonly repliedTo: string } & ChannelText)
  /**
   * Text that does not answer a system message. The intent has no content, because the text is
   * not accepted.
   */
  | { readonly kind: 'unsolicited' };

/** What a person's reply from the channel contains. */
interface ChannelText {
  readonly text: string;
  readonly channel: ChannelId;
  /** The event key in the same form as the receipt's: `telegram:<update_id>`. */
  readonly eventId: string;
  /** When the person wrote it; failing that, when the App accepted it. */
  readonly sentAt?: Date;
}

/** The inbound side of a channel adapter: a raw update becomes an intent or nothing. */
export interface ChannelInbound {
  readonly id: ChannelId;
  parse(raw: unknown): ChannelIntent | null;
}
