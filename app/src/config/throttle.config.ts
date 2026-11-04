import { registerAs, type ConfigType } from '@nestjs/config';

/** The profile for a person: it sets the ceiling, and webhooks skip it. */
export const DEFAULT_THROTTLE = 'default';

/** The webhook profile: it counts every route, but sets the limit only for webhooks. */
export const WEBHOOK_THROTTLE = 'webhooks';

/** The throttler's limits, in requests per minute from one address. */
export const throttleConfig = registerAs('throttle', () => ({
  /** The ceiling for routes that are not webhooks. */
  defaultPerMinute: 100,
  /**
   * Webhooks: the provider sends its retries in a burst, and a limit sized for a person would
   * reject the very thing that must get through.
   */
  webhooksPerMinute: 600,
}));

export type ThrottleConfig = ConfigType<typeof throttleConfig>;
