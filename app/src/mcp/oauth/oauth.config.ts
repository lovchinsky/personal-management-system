import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../../platform/config/env-value';

/**
 * The App's authorization server for connecting Claude Chat to the App MCP (`docs/2-system.md`
 * § “Authentication boundary”): the public endpoint address and the owner passphrase. Both are
 * needed together. Without the address there is neither a `resource` nor an issuer, and without
 * the passphrase the consent page has no way to make sure the owner is in front of the page. So a
 * server missing either does not answer at all, and `/mcp` stays available to runs only.
 */
export const oauthConfig = registerAs('oauth', () => ({
  mcpUrl: optional(process.env.APP_MCP_URL),
  ownerPassphrase: optional(process.env.APP_OAUTH_OWNER_PASSPHRASE),
}));

export type OauthConfig = ConfigType<typeof oauthConfig>;

/**
 * How long an access token lives: a short time, because a stolen token works for exactly that long.
 */
export const ACCESS_TTL_SECONDS = 3_600;

/**
 * How long a refresh token lives without rotation: the owner connects a client every few months.
 */
export const REFRESH_TTL_DAYS = 90;

/**
 * How long an authorization code lives: it is redeemed at once, and it is not needed for longer.
 */
export const CODE_TTL_SECONDS = 60;

/** How many clients registration keeps: a ceiling against clutter from open registration. */
export const MAX_REGISTERED_CLIENTS = 500;

/** The shortest owner passphrase accepted: it is generated, not made up. */
export const MIN_OWNER_PASSPHRASE_CHARS = 32;
