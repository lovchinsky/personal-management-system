import { registerAs, type ConfigType } from '@nestjs/config';
import { optional, required } from '../../platform/config/env-value';

/** The default location is tmpfs, because the same restart that closes the window wipes it. */
const DEFAULT_VERIFICATION_TOKEN_PATH = '/run/app/verification_token';

/** The Notion webhook's signing key and subscription provisioning window. */
export const notionWebhookConfig = registerAs('notionWebhook', () => ({
  /**
   * The delivery signing key, the same `verification_token` that Notion uses to verify the
   * subscription.
   */
  secret: required(process.env.NOTION_WEBHOOK_SECRET, 'NOTION_WEBHOOK_SECRET'),
  /**
   * Whether the subscription provisioning window is open. The guard and the handler share this one
   * value, because both ask the same thing and two copies of the question would diverge.
   */
  awaitingVerification: process.env.NOTION_WEBHOOK_AWAITING_VERIFICATION === 'true',
  /** Where to put the `verification_token` so that the person can pick it up. */
  verificationTokenPath:
    optional(process.env.NOTION_VERIFICATION_TOKEN_PATH) ?? DEFAULT_VERIFICATION_TOKEN_PATH,
}));

export type NotionWebhookConfig = ConfigType<typeof notionWebhookConfig>;
