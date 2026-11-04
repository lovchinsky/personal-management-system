import { registerAs, type ConfigType } from '@nestjs/config';

/**
 * The switch for background work. By default it is on. The gate instance turns it off itself: it
 * conducts runs and ticks itself, whereas workers would claim the same rows and turn them into
 * real runs (ADR 0013, ADR 0041).
 */
export const workersConfig = registerAs('workers', () => ({
  enabled: process.env.WORKERS_ENABLED !== 'false',
}));

export type WorkersConfig = ConfigType<typeof workersConfig>;
