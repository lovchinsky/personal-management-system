import { registerAs, type ConfigType } from '@nestjs/config';
import { required } from '../config/env-value';

/**
 * The connection to `app_db`. Without it the App does nothing, so a missing address stops startup.
 */
export const databaseConfig = registerAs('database', () => ({
  url: required(process.env.DATABASE_URL, 'DATABASE_URL'),
}));

export type DatabaseConfig = ConfigType<typeof databaseConfig>;
