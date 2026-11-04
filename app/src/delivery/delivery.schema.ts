import { z } from 'zod';
import { discussionIdSchema } from '../notion/client/notion-id';
import {
  CHANNEL_IDS,
  MAX_PACKET_PROPOSALS,
  outboundMessageSchema,
  strictProposalLineSchema,
} from './port/channel.port';

/**
 * A delivery request is what the caller decides.
 *
 * Whether the message breaks through quiet hours is deliberately absent here: that is decided not
 * by whoever wants to speak but by the one on whose behalf they speak. A field for that decision
 * in the request gets a refusal, not silence, like any other extra field: silently dropped, the
 * field would leave the caller sure that it was heard.
 */
export const deliverySchema = z.strictObject({
  /** The key of a logical delivery: the same key a second time enqueues nothing. */
  idempotencyKey: z.string().min(1),
  channel: z.enum(CHANNEL_IDS),
  /**
   * The thread the message is about, in the same form as in a continuation and in the system's
   * registry; a thread opened by a comment of this run gets its real id on applying.
   */
  discussionId: discussionIdSchema.optional(),
  // A strict copy of the port schema, proposals included. The port schema itself stays lenient:
  // it reads stored rows, and after a version rollback a field this version does not know must be
  // lost instead of retiring the whole delivery. A freshly composed request, by contrast, must be
  // exact. The request has no buttons: the sender derives them from the proposals.
  message: z.strictObject({
    noticed: outboundMessageSchema.shape.noticed,
    whyItMatters: outboundMessageSchema.shape.whyItMatters,
    context: outboundMessageSchema.shape.context,
    prepared: outboundMessageSchema.shape.prepared,
    ask: outboundMessageSchema.shape.ask,
    link: outboundMessageSchema.shape.link,
    proposals: z
      .array(strictProposalLineSchema)
      .max(MAX_PACKET_PROPOSALS)
      .refine(
        (lines) => new Set(lines.map((line) => line.pendingActionId)).size === lines.length,
        'a proposal appears once in a packet',
      )
      .optional(),
  }),
});

/** A delivery as it is requested: the ids are not yet converted. */
export type DeliveryRequest = z.input<typeof deliverySchema>;

/** A delivery after validation: the ids are canonical. */
export type Delivery = z.output<typeof deliverySchema>;
