import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../../platform/config/env-value';

/**
 * The GBrain client: where to get the token, as which client and with what scope. The client is
 * needed only with the runner enabled, so the config namespace leaves it optional and whoever
 * takes the token requires it.
 */
export const gbrainConfig = registerAs('gbrain', () => ({
  tokenUrl: optional(process.env.GBRAIN_OAUTH_TOKEN_URL),
  scope: optional(process.env.GBRAIN_OAUTH_SCOPE),
  clientId: optional(process.env.GBRAIN_CLIENT_ID),
  clientSecret: optional(process.env.GBRAIN_CLIENT_SECRET),
}));

export type GbrainConfig = ConfigType<typeof gbrainConfig>;
