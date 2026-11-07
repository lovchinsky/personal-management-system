import { z } from 'zod';

/**
 * The delivery port: system → person. A channel is responsible only for rendering and delivery;
 * what to say is not its decision.
 *
 * The inbound side of a channel (the person's intentions) is described by intake
 * (`intake/channel/`): it interprets the buttons that delivery renders, so it depends on this
 * port, not the other way around.
 */

export const ACTION_KINDS = ['approve', 'reject', 'snooze', 'dismiss'] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * The channel adapters the App is able to have.
 *
 * “Able to have”, not “has”: whether a channel is configured is a state of the installation, and
 * the queue accepts a delivery to a channel the installation lacks and retires it with a stated
 * reason. A name that is not among the adapters at all is a different matter: it is the
 * requester's mistake, and it must be refused before it reaches the queue.
 */
export const CHANNEL_IDS = ['telegram'] as const;

export type ChannelId = (typeof CHANNEL_IDS)[number];

/**
 * A button has an **intent and an id**, not a change, because `callback_data` holds 64 bytes. The
 * id is a uuid, like all proposal ids, so `kind:id` fits this limit by construction (the longest
 * kind together with the id is 44 bytes), and a truncated or forged string is not a button.
 */
const channelActionShape = {
  kind: z.enum(ACTION_KINDS),
  pendingActionId: z.uuid(),
};

const channelActionSchema = z.object(channelActionShape);

export type ChannelAction = z.infer<typeof channelActionSchema>;

/**
 * A button as the delivery request accepts it and as a press is read: strictly. The port schema
 * that reads a stored row stays lenient: a field this version does not know must be dropped rather
 * than cause the whole delivery to be retired.
 */
export const strictChannelActionSchema = z.strictObject(channelActionShape);

/**
 * The maximum number of proposals a packet includes with buttons. The packet reports the rest as a
 * number.
 */
export const MAX_PACKET_PROPOSALS = 3;

/**
 * The largest number in the line about the remaining proposals: the renderer reserves room for it
 * in advance.
 */
export const MAX_MORE_PROPOSALS = 99_999;

/**
 * A proposal in a packet: an id and a description line. The line is one sentence about the change
 * the person approves or rejects; the buttons for a line are numbered by the App itself.
 */
const proposalLineShape = {
  pendingActionId: z.uuid(),
  line: z.string().trim().min(1).max(160),
};

/** A proposal as the delivery request accepts it: strictly. */
export const strictProposalLineSchema = z.strictObject(proposalLineShape);

/**
 * A message as a complete decision packet.
 *
 * The policy names the five slots: what was noticed, why it matters, what context changes the
 * assessment, what is already prepared, what minimal decision is needed.
 *
 * `link` points to the Notion object the message is about: a channel message is not a source of
 * state, and the full content lives in Notion (`INV-024`). Two copies of the same nudge point to
 * the same object, which is why at-least-once on the wire costs only attention. A notice about
 * the system itself (a client connected, a review did not take place) is about no Notion object
 * and has no link. The model's packets always have one: `queue_notification` requires it.
 */
export const outboundMessageSchema = z.object({
  noticed: z.string().min(1),
  whyItMatters: z.string().min(1),
  context: z.string().optional(),
  prepared: z.string().optional(),
  // A question has an end. The limit here is not about transport but about what a decision is:
  // an ask that does not fit into a few sentences is no longer a question but an exposition, and
  // the person cannot answer it with a button. The finiteness also makes the channel's promise to
  // stay within its own limit provable: see `telegram.renderer`.
  ask: z.string().min(1).max(300),
  // The link is a URL, not a string that looks like one. The protocol is restricted deliberately:
  // `javascript:` is also a valid URL, and it stays out of `href` only because it is rejected
  // here, at the entrance to the queue, not at render time.
  link: z
    .url({ protocol: /^https$/ })
    .max(300)
    .optional(),
  /**
   * The proposals the packet asks for a decision on (ADR 0039). The renderer does not shorten them:
   * each proposal's line and buttons arrive whole. The packet reports the rest of the open
   * proposals as a number (`moreProposals`).
   */
  proposals: z.array(z.object(proposalLineShape)).max(MAX_PACKET_PROPOSALS).optional(),
  /**
   * How many more proposals await a decision outside the packet: the App counts them when the
   * packet includes proposals.
   */
  moreProposals: z.number().int().positive().max(MAX_MORE_PROPOSALS).optional(),
  /**
   * Buttons derive from proposals: “approve” and “reject” for each proposal. The sender adds them,
   * and only for a channel that supports buttons (`INV-021`); a stored packet has none.
   */
  actions: z.array(channelActionSchema).optional(),
});

/**
 * The type is derived from the schema, not written beside it.
 *
 * A queue row survives a restart and even a version bump, so a `payload` read back must be
 * validated, not merely declared. Two descriptions of one shape would drift apart where it costs
 * most: on a row that can no longer be rewritten.
 */
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

/**
 * What the provider said about the delivery. A failure always has a reason, and a backoff pause
 * only if the provider named one. A success includes the message's id in the channel, if the
 * channel named it: the person replies to it, and the system edits the message when a proposal is
 * closed.
 */
export type DeliveryReceipt =
  | { readonly ok: true; readonly externalId?: string }
  | {
      readonly ok: false;
      readonly error: string;
      /** How long to wait before the next attempt, if the provider said so. */
      readonly retryAfterSeconds?: number;
    };

export interface ChannelCapabilities {
  /** approve / snooze / dismiss right in the message. */
  readonly interactiveActions: boolean;
}

export interface NotificationChannel {
  readonly id: ChannelId;
  readonly capabilities: ChannelCapabilities;
  /**
   * Returns the number of characters by which the packet exceeds the channel's message length; 0
   * means it fits. `noticed`, `why_it_matters`, the proposals with room reserved for their fates,
   * the ask and the link, if there is one, must fit whole; the renderer drops `context` and `prepared` when there is
   * not enough room for them. A packet that does not fit does not reach the queue.
   */
  excess(message: OutboundMessage): number;
  send(message: OutboundMessage, idempotencyKey: string): Promise<DeliveryReceipt>;
  /**
   * Rewrites a sent message: next to each decided proposal, appends what the proposal became and
   * removes its buttons; the buttons of the rest stay. `settled` is the fate of each decided
   * proposal, by id. Not every channel can do this, so the method is optional.
   */
  edit?(
    externalId: string,
    message: OutboundMessage,
    settled: ReadonlyMap<string, string>,
  ): Promise<DeliveryReceipt>;
}

export const NOTIFICATION_CHANNELS = Symbol('NotificationChannels');
