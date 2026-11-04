import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramClient } from './telegram.client';
import { telegramConfig } from './telegram.config';

/**
 * The Bot API adapter, shared by both directions of the channel, as `notion/` is for Notion.
 *
 * Delivery sends messages with it; intake answers button presses. The client belongs to neither
 * of the two modules, so neither of them has to export it.
 */
@Module({
  imports: [ConfigModule.forFeature(telegramConfig)],
  providers: [TelegramClient],
  exports: [TelegramClient],
})
export class TelegramModule {}
