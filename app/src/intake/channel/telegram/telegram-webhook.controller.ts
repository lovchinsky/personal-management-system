import { Body, Controller, HttpCode, Inject, Logger, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { appConfig, type AppConfig } from '../../../config/app.config';
import { DEFAULT_THROTTLE } from '../../../config/throttle.config';
import { messageOf } from '../../../platform/error/message-of';
import { escapeHtml } from '../../../telegram/telegram-html';
import { TelegramClient } from '../../../telegram/telegram.client';
import { textsOf, type TelegramTexts } from '../../../texts/texts';
import { rejected, WebhookReceipts } from '../../receipts/webhook-receipts';
import { IntentRouter, settlementOf } from '../intent.router';
import { TelegramSecretGuard } from './telegram-secret.guard';
import { chatIdOf, telegramUpdateSchema } from './telegram-update.schema';
import {
  Acknowledgement,
  acknowledgementOf,
  TelegramInbound,
  unreadable,
} from './telegram.inbound';

/**
 * Channel inbound is a separate path with its own authentication.
 *
 * It shares with Notion only the public base URL (ADR 0003) and the receipt lifecycle:
 * deduplication, a refusal with a reason, and a failure that is recorded on the receipt.
 */
// Only the `webhooks` throttler profile applies, because a limit sized for a person would reject a
// burst of provider redeliveries (`docs/2-system.md` § “App — inbound perimeter”).
@SkipThrottle({ [DEFAULT_THROTTLE]: true })
@UseGuards(TelegramSecretGuard)
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    private readonly receipts: WebhookReceipts,
    private readonly inbound: TelegramInbound,
    private readonly router: IntentRouter,
    private readonly client: TelegramClient,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(@Body() body: unknown): Promise<{ readonly ok: true }> {
    const update = telegramUpdateSchema.parse(body);
    const callbackQueryId = update.callback_query?.id;

    // A duplicate update does nothing and answers 200, because the provider redelivers on a
    // non-2xx and processing a button press twice would have a second effect.
    await this.receipts.receive(
      {
        source: 'telegram',
        externalId: String(update.update_id),
        eventType: update.callback_query ? 'callback_query' : 'message',
        // `message.text` deliberately does not go here, because it is verbatim what the person
        // typed to the bot. Diagnostics need the intent and the addressee, not the content.
        diagnostics: {
          callback_data: update.callback_query?.data,
          message_id: update.message?.message_id ?? update.callback_query?.message?.message_id,
          has_text: update.message?.text !== undefined,
        },
      },
      async (receipt) => {
        const texts = this.texts();
        const intent = this.inbound.parse(update);
        if (!intent) {
          if (callbackQueryId) await this.acknowledge(callbackQueryId, unreadable(texts.answers));

          return rejected('update carries no intent');
        }

        // The decision is recorded **first** and the ack after (`INV-023`), because the reverse
        // order would lose the person's decision
        // (`docs/2-system.md` § “Telegram — channel adapter”).
        const outcome = await this.router.route(intent, receipt);

        if (callbackQueryId) {
          await this.acknowledge(callbackQueryId, acknowledgementOf(outcome, texts.answers));
        }

        // Text with nowhere to go is not stored anywhere, and the person is told so right away.
        // The channel sends messages in HTML markup, so the catalog text is escaped like any other.
        const chatId = chatIdOf(update);

        if (!callbackQueryId && chatId && outcome.kind === 'unconsumed') {
          await this.answer(chatId, escapeHtml(texts.nowhere));
        }

        // The words were not recorded because Notion is unavailable. The person will send them
        // later (ADR 0045). This reply is the only trace of their words, so it is not cosmetic: its
        // failure fails the receipt, and the provider's redelivery will either record the words or
        // tell the person again. A Bot API refusal, which the client returns as a value rather
        // than an exception, is a failure too.
        if (!callbackQueryId && chatId && outcome.kind === 'not_recorded') {
          const sent = await this.client.sendMessage(chatId, escapeHtml(texts.answers.notRecorded));

          if (!sent.ok) throw new Error(`the not-recorded answer was refused: ${sent.error}`);
        }

        return settlementOf(outcome);
      },
    );

    return { ok: true };
  }

  /** Returns the channel texts in the installation's language (ADR 0042). */
  private texts(): TelegramTexts {
    return textsOf(this.app.language).telegram;
  }

  /**
   * The ack is cosmetic: the decision is already recorded and will run without it.
   *
   * So its failure does not turn into a 500. Otherwise the provider would resend the update just
   * to redraw a button, and each such redelivery would go through the whole intake path again.
   */
  private async acknowledge(callbackQueryId: string, ack: Acknowledgement): Promise<void> {
    try {
      await this.client.answerCallbackQuery(callbackQueryId, ack.text, ack.alert);
    } catch (error) {
      this.logger.warn(`callback ack failed, decision already recorded: ${messageOf(error)}`);
    }
  }

  /** A reply to text is cosmetic in the same way: its failure does not repeat intake. */
  private async answer(chatId: string, text: string): Promise<void> {
    try {
      await this.client.sendMessage(chatId, text);
    } catch (error) {
      this.logger.warn(`reply to an unconsumed text failed: ${messageOf(error)}`);
    }
  }
}
