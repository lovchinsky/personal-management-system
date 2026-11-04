import { z } from 'zod';
import { NotificationOutbox } from '../generated/prisma/client';
import { NotificationDeliveryStatus } from '../generated/prisma/enums';
import { chatDeliveryKey, runDeliveryKey } from './delivery-key';
import { Delivery, DeliveryRequest } from './delivery.schema';
import { CHANNEL_IDS } from './port/channel.port';

/**
 * A delivery request on the App MCP wire (`queue_notification`): the fields of the decision
 * packet under their wire names (`docs/2-system.md` § “App MCP”).
 *
 * The schema describes the shape only. The service checks the limits — the length of the
 * question, the https link, the uuid and the number of proposals — with the same schema as any
 * other entry into the queue.
 */
export const deliveryWireSchema = z.strictObject({
  channel: z.enum(CHANNEL_IDS),
  discussion_id: z.string().min(1).optional(),
  message: z.strictObject({
    noticed: z.string().min(1),
    why_it_matters: z.string().min(1),
    context: z.string().optional(),
    prepared: z.string().optional(),
    ask: z.string().min(1),
    link: z.string().min(1),
    proposals: z
      .array(z.strictObject({ pending_action_id: z.string().min(1), line: z.string().min(1) }))
      .optional(),
  }),
});

export type DeliveryWire = z.infer<typeof deliveryWireSchema>;

/**
 * Builds a delivery request from a request on the wire. The wire request has no delivery key,
 * deliberately: the App derives the key (`delivery-key.ts`) from the cause of the run and, in a
 * chat, which has no cause, from the content of the packet. A model that invented the key itself
 * would invent a different one on a retry.
 */
export function deliveryRequestOf(wire: DeliveryWire, cause: string | null): DeliveryRequest {
  const { message } = wire;
  const content: Omit<DeliveryRequest, 'idempotencyKey'> = {
    channel: wire.channel,
    discussionId: wire.discussion_id,
    message: {
      noticed: message.noticed,
      whyItMatters: message.why_it_matters,
      context: message.context,
      prepared: message.prepared,
      ask: message.ask,
      link: message.link,
      proposals: message.proposals?.map((proposal) => ({
        pendingActionId: proposal.pending_action_id,
        line: proposal.line,
      })),
    },
  };

  return {
    ...content,
    idempotencyKey: cause === null ? chatDeliveryKey(content) : runDeliveryKey(cause),
  };
}

/**
 * Which delivery's state to ask for (`get_delivery_state`): the key that `queue_notification`
 * returned. Without a key the run asks about the delivery of its own cause.
 */
export const deliveryQueryWireSchema = z.strictObject({
  idempotency_key: z.string().min(1).optional(),
});

/**
 * A delivery as the model sees it: the status and the time it was sent. Attempts, the backoff
 * pause and the failure reason are the queue's bookkeeping and are not included here (`INV-030`).
 *
 * `staged` means a delivery that this run enqueued and that is applied at the end.
 */
export interface DeliveryStateWire {
  readonly idempotency_key: string;
  readonly status: NotificationDeliveryStatus | 'staged';
  readonly sent_at?: string;
}

/** No delivery has this key, either in the queue or among what the run has written. */
export interface DeliveryAbsentWire {
  readonly idempotency_key: string;
  readonly found: false;
}

export function deliveryStateOf(row: NotificationOutbox): DeliveryStateWire {
  return {
    idempotency_key: row.idempotencyKey,
    status: row.status,
    ...(row.sentAt ? { sent_at: row.sentAt.toISOString() } : {}),
  };
}

/** Describes a delivery that a run enqueued, which is not yet a queue row. */
export function stagedDeliveryOf(request: Delivery): DeliveryStateWire {
  return { idempotency_key: request.idempotencyKey, status: 'staged' };
}

/**
 * When a delivery enqueued at this time will be sent: immediately if it is exempt from quiet
 * hours, otherwise not before quiet hours end, if they are in progress.
 */
export interface DeliveryWindowWire {
  readonly quiet_hours_exempt: boolean;
  readonly silent_until?: string;
}
