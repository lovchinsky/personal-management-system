import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../../platform/config/env-value';
import { parseTimeOfDay } from '../../platform/time/time-of-day';

/**
 * Quiet hours, parsed **at startup**: a bad value stops startup, as it does for the rest of the
 * application's configuration. Parsed during delivery, they would accept `QUIET_HOURS_START=25:00`
 * without objection and then throw in every worker tick, so the queue would silently fill up and
 * the only trace would be a log line that keeps repeating.
 */
export const quietHoursConfig = registerAs('quietHours', () => ({
  enabled: process.env.QUIET_HOURS_ENABLED !== 'false',
  startMinute: parseTimeOfDay(optional(process.env.QUIET_HOURS_START) ?? '23:00'),
  endMinute: parseTimeOfDay(optional(process.env.QUIET_HOURS_END) ?? '08:00'),
}));

export type QuietHoursConfig = ConfigType<typeof quietHoursConfig>;
