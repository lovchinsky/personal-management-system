import { registerAs, type ConfigType } from '@nestjs/config';
import { required } from '../platform/config/env-value';

/**
 * The encryption key of the connector store. Without it a grant can be neither read nor written,
 * so a missing key stops startup.
 */
export const credentialsConfig = registerAs('credentials', () => ({
  encryptionKey: required(process.env.APP_ENCRYPTION_KEY, 'APP_ENCRYPTION_KEY'),
}));

export type CredentialsConfig = ConfigType<typeof credentialsConfig>;
