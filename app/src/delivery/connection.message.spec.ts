import type { ConnectedClient } from '../mcp/oauth/client-notice';
import { textsOf } from '../texts/texts';
import { connectionDelivery } from './connection.message';
import { Delivery, deliverySchema } from './delivery.schema';

const CLIENT = { name: 'Claude', redirectHost: 'claude.ai' };

/** Builds the notice in `uk`. */
const connectionOf = (client: ConnectedClient): Delivery =>
  connectionDelivery(client, textsOf('uk').notices.connection);

/** A client connection notice is a complete packet that passes the port schema. */
describe('client connection notice', () => {
  it('has a packet that passes the delivery schema and names the client and the host', () => {
    const delivery = connectionOf(CLIENT);

    expect(deliverySchema.safeParse(delivery).success).toBe(true);
    expect(delivery.message.noticed).toContain('Claude');
    expect(delivery.message.noticed).toContain('claude.ai');
  });

  /**
   * Each connection is a separate event: an identical key would collapse the second consent into
   * the first.
   */
  it('yields a separate key for each connection', () => {
    expect(connectionOf(CLIENT).idempotencyKey).not.toBe(connectionOf(CLIENT).idempotencyKey);
  });

  it('has no proposals, and so no buttons, because revoking is not a decision in the notice', () => {
    expect(connectionOf(CLIENT).message.proposals).toBeUndefined();
  });
});
