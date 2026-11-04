import { randomUUID } from 'node:crypto';
import { ConnectedClient } from '../mcp/oauth/client-notice';
import type { NoticeTexts } from '../texts/texts';
import { Delivery } from './delivery.schema';
import { WORKSPACE_LINK } from './notion-link';

/**
 * Builds the notice that a client has connected to the App MCP.
 *
 * The owner passphrase is the only factor of consent, so every consent must be visible: an owner
 * who connected nothing sees this notice and revokes the tokens. The key is random because each
 * connection is a separate event, not a repeat of the same one.
 */
export function connectionDelivery(
  client: ConnectedClient,
  texts: NoticeTexts['connection'],
): Delivery {
  return {
    idempotencyKey: `oauth-connect:${randomUUID()}`,
    channel: 'telegram',
    message: {
      noticed: texts.noticed(client.name, client.redirectHost),
      whyItMatters: texts.whyItMatters,
      ask: texts.ask,
      // This notice is not about any Notion page.
      link: WORKSPACE_LINK,
    },
  };
}
