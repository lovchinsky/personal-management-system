import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApprovalsModule } from '../../approvals/approvals.module';
import { AttentionModule } from '../../attention/attention.module';
import { DeliveryModule } from '../../delivery/delivery.module';
import { telegramConfig } from '../../telegram/telegram.config';
import { TelegramModule } from '../../telegram/telegram.module';
import { NotionIntakeModule } from '../notion/notion-intake.module';
import { IntakeReceiptsModule } from '../receipts/receipts.module';
import { ChannelReply } from './channel-reply';
import { IntentRouter } from './intent.router';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';
import { TelegramInbound } from './telegram/telegram.inbound';

/**
 * Channel intake is the person → system flow: the webhook, authentication, update parsing, the
 * intent router that sends each intent to its owner, and `ChannelReply`, which puts the person's
 * reply into the thread in Notion before the system takes it up.
 *
 * Delivery (system → person) is a different flow with a different owner; the two share only the
 * Bot API adapter and the button format that intake reads back.
 */
@Module({
  imports: [
    ConfigModule.forFeature(telegramConfig),
    IntakeReceiptsModule,
    ApprovalsModule,
    AttentionModule,
    DeliveryModule,
    NotionIntakeModule,
    TelegramModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [IntentRouter, ChannelReply, TelegramInbound],
})
export class ChannelIntakeModule {}
