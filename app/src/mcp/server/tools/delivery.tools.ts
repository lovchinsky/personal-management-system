import { runDeliveryKey } from '../../../delivery/delivery-key';
import {
  deliveryQueryWireSchema,
  deliveryRequestOf,
  DeliveryWire,
  deliveryWireSchema,
} from '../../../delivery/delivery.wire';
import { InvalidRequestError } from '../../../platform/request/invalid-request';
import { AppTool, defineTool, ToolContext, writeAnswer, WRITES } from './app-tool';

/**
 * Queues a delivery. The App derives the delivery key: in a run the cause identifies it, in a chat
 * the content of the packet does. A delivery queued earlier stays the same delivery, and the
 * model learns this at the call itself.
 */
async function queue(context: ToolContext, input: DeliveryWire): Promise<object> {
  const { identity, writes } = context.session;

  if (identity.surface === 'run' && writes.pending('delivery').length > 0) {
    throw new InvalidRequestError(
      'delivery: this run has already queued its notification; a run queues at most one',
    );
  }

  const { write } = await writes.submit(
    'delivery',
    deliveryRequestOf(input, identity.surface === 'run' ? identity.cause : null),
  );
  const queued = await context.delivery.state(write.idempotencyKey);

  return writeAnswer(context, {
    idempotency_key: write.idempotencyKey,
    ...('status' in queued ? { already_queued: { status: queued.status } } : {}),
  });
}

export const DELIVERY_TOOLS: readonly AppTool[] = [
  defineTool({
    name: 'queue_notification',
    capability: 'delivery_write',
    bound: 2_000,
    description:
      'Queue a decision packet for the person. A run queues at most one, and a repeat of the same ' +
      'run never queues a second: the App identifies the notification, not you. In a chat the ' +
      'same packet never queues twice. The answer returns the idempotency_key and, when the ' +
      'notification already existed, already_queued with its status. proposals carries up to ' +
      'three proposals to decide, each a pending_action_id staged by this run or still waiting for the person, with one ' +
      'line saying the change; the App numbers them, adds approve and reject buttons and says ' +
      'how many other proposals wait for the person. ' +
      `Quiet hours delay, not drop. ${WRITES}`,
    inputSchema: deliveryWireSchema,
    handle: queue,
  }),
  defineTool({
    name: 'get_delivery_state',
    capability: 'delivery_read',
    bound: 1_000,
    description:
      'Status of a notification, including one staged by this run. In a run, without input, it ' +
      "answers for this run's own notification; pass the idempotency_key that queue_notification " +
      'returned to ask about another. In a chat the idempotency_key is required.',
    inputSchema: deliveryQueryWireSchema,
    handle: (context, input) => {
      const { identity, writes } = context.session;
      const key =
        input.idempotency_key ??
        (identity.surface === 'run' ? runDeliveryKey(identity.cause) : null);

      if (key === null) {
        throw new InvalidRequestError(
          'delivery: name the idempotency_key that queue_notification returned',
        );
      }

      return context.delivery.state(
        key,
        writes.pending('delivery').map((staged) => staged.write),
      );
    },
  }),
];
