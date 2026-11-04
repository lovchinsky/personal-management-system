import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../platform/config/env-value';

/**
 * The Telegram channel is optional as a whole: without it the channel registry is empty and the
 * webhook rejects every update (`docs/2-system.md` § “Telegram — channel adapter”).
 */
export const telegramConfig = registerAs('telegram', () => ({
  botToken: optional(process.env.TELEGRAM_BOT_TOKEN),
  allowedChatId: optional(process.env.TELEGRAM_ALLOWED_CHAT_ID),
  webhookSecret: optional(process.env.TELEGRAM_WEBHOOK_SECRET),
  apiBase: optional(process.env.TELEGRAM_API_BASE) ?? 'https://api.telegram.org',
}));

export type TelegramConfig = ConfigType<typeof telegramConfig>;

/**
 * Checks whether delivery has something to write with and someone to write to. Without them the
 * registry has no channel.
 */
export function canDeliver(telegram: TelegramConfig): boolean {
  return telegram.botToken !== undefined && telegram.allowedChatId !== undefined;
}
