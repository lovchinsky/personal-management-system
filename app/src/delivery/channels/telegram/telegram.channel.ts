import { Inject, Injectable, Logger } from '@nestjs/common';
import { appConfig, type AppConfig } from '../../../config/app.config';
import { required } from '../../../platform/config/env-value';
import { TelegramClient } from '../../../telegram/telegram.client';
import { telegramConfig, type TelegramConfig } from '../../../telegram/telegram.config';
import { textsOf, type TelegramTexts } from '../../../texts/texts';
import {
  ChannelCapabilities,
  DeliveryReceipt,
  NotificationChannel,
  OutboundMessage,
} from '../../port/channel.port';
import { excessOf, keyboardFor, renderMessage } from './telegram.renderer';

/**
 * Capabilities belong to the channel, not to an instance of it.
 *
 * The capabilities are kept in a constant so that a consumer can ask about them without starting
 * the adapter. The correct degradation for a channel without buttons rests on them (`INV-021`).
 */
export const TELEGRAM_CAPABILITIES: ChannelCapabilities = {
  interactiveActions: true,
};

/**
 * The first delivery adapter (ADR 0007). Delivery is at-least-once: the provider has no
 * idempotency key, and a duplicate is cheaper than a lost nudge
 * (`docs/2-system.md` § “Telegram — channel adapter”).
 */
@Injectable()
export class TelegramChannel implements NotificationChannel {
  readonly id = 'telegram';

  readonly capabilities = TELEGRAM_CAPABILITIES;

  private readonly logger = new Logger(TelegramChannel.name);

  constructor(
    private readonly client: TelegramClient,
    @Inject(telegramConfig.KEY) private readonly config: TelegramConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * Measuring and rendering use the same texts: those of the installation's language (ADR 0042).
   */
  excess(message: OutboundMessage): number {
    return excessOf(message, this.texts());
  }

  async send(message: OutboundMessage, idempotencyKey: string): Promise<DeliveryReceipt> {
    // A channel is in the registry only when there is someone for it to write to (`canDeliver`).
    const chatId = required(this.config.allowedChatId, 'TELEGRAM_ALLOWED_CHAT_ID');
    const result = await this.client.sendMessage(
      chatId,
      renderMessage(message, this.texts()),
      keyboardFor(message, this.texts()),
    );

    if (!result.ok) {
      return result;
    }

    this.logger.log(`delivered ${idempotencyKey}`);

    return result.messageId === undefined
      ? { ok: true }
      : { ok: true, externalId: result.messageId };
  }

  async edit(
    externalId: string,
    message: OutboundMessage,
    settled: ReadonlyMap<string, string>,
  ): Promise<DeliveryReceipt> {
    const chatId = required(this.config.allowedChatId, 'TELEGRAM_ALLOWED_CHAT_ID');
    const result = await this.client.editMessage(
      chatId,
      externalId,
      renderMessage(message, this.texts(), settled),
      keyboardFor(message, this.texts(), settled),
    );

    return result.ok ? { ok: true } : result;
  }

  private texts(): TelegramTexts {
    return textsOf(this.app.language).telegram;
  }
}
