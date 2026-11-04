import { TelegramUpdate } from '../../src/intake/channel/telegram/telegram-update.schema';
import { ReceiptHandle } from '../../src/intake/receipts/webhook-receipts';
import { TelegramConfig } from '../../src/telegram/telegram.config';

/**
 * A proposal id on a button: a uuid, as the system issues them, so `kind:id` fits within
 * Telegram's limit.
 */
export const PROPOSAL_ID = 'ca7b0e1e-1111-4222-8333-444455556666';

/** A fully configured channel: a token, an allowed chat and a webhook secret. */
export const TELEGRAM_CONFIG: TelegramConfig = {
  botToken: 'token',
  allowedChatId: '42',
  webhookSecret: 'secret',
  apiBase: 'https://api.telegram.org',
};

interface Press {
  /** What is on the button: `kind:id`. By default it is “Approve” on `PROPOSAL_ID`. */
  readonly data?: string;
  /** The chat the button was pressed in. By default, the allowed one. */
  readonly chatId?: number;
}

/** Builds a button press in a chat message, the way Telegram sends it. */
export function buttonPress(
  updateId: number,
  { data = `approve:${PROPOSAL_ID}`, chatId = Number(TELEGRAM_CONFIG.allowedChatId) }: Press = {},
): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      data,
      message: { message_id: 7, chat: { id: chatId } },
    },
  };
}

/** A receipt whose work runs for the first time: no page yet, and what is recorded is not kept. */
export const FRESH_RECEIPT: ReceiptHandle = {
  pageId: null,
  recordPage: () => Promise.resolve(),
};
