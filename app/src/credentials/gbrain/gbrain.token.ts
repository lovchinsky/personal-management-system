import { Inject, Injectable } from '@nestjs/common';
import { addSeconds } from 'date-fns';
import { z } from 'zod';
import { required } from '../../platform/config/env-value';
import { lastsFor } from '../token-lifetime';
import { gbrainConfig, type GbrainConfig } from './gbrain.config';

/** How long to wait for a GBrain response: GBrain is on the same Compose network. */
const REQUEST_TIMEOUT_MS = 10_000;

const tokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
});

interface HeldToken {
  readonly token: string;
  /** `undefined` means GBrain did not state an expiry, and there is nothing to guess it from. */
  readonly expiresAt?: Date;
}

/**
 * The access token of the App-owned GBrain client (`INV-062`): `client_credentials`,
 * `client_secret_post`, scopes from the configuration (`read write`, no `admin`).
 *
 * The token lives in memory until it expires and is not stored in the database. GBrain issues a
 * new token at any time, so a stored bearer would be one more secret with no use at all
 * (`docs/2-system.md` § “Integration contract GBrain”). The client secret does not leave this
 * class: a run receives only the access token.
 */
@Injectable()
export class GbrainToken {
  private held?: HeldToken;
  private minting?: Promise<HeldToken>;

  constructor(@Inject(gbrainConfig.KEY) private readonly config: GbrainConfig) {}

  /**
   * Returns an access token that will stay valid for at least `validForMs`.
   *
   * A token whose expiry GBrain did not state cannot be checked. The run receives a token just
   * issued, which is as fresh as a token can be, and the next run takes a new token of its own,
   * not the same one. Issuing a new token costs nothing, because client_credentials are not
   * rotated.
   */
  async accessToken(validForMs: number): Promise<string> {
    const lasting = (held: HeldToken): boolean =>
      held.expiresAt !== undefined && lastsFor(held.expiresAt, validForMs);

    if (this.held && lasting(this.held)) {
      return this.held.token;
    }

    // Concurrent runs wait for the same request instead of each issuing its own token.
    this.minting ??= this.mint().finally(() => {
      this.minting = undefined;
    });

    this.held = await this.minting;

    if (this.held.expiresAt !== undefined && !lasting(this.held)) {
      throw new Error(`GBrain issued a token shorter than the ${validForMs} ms a run needs`);
    }

    return this.held.token;
  }

  private async mint(): Promise<HeldToken> {
    const requested = required(this.config.scope, 'GBRAIN_OAUTH_SCOPE');
    const response = await fetch(required(this.config.tokenUrl, 'GBRAIN_OAUTH_TOKEN_URL'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: required(this.config.clientId, 'GBRAIN_CLIENT_ID'),
        client_secret: required(this.config.clientSecret, 'GBRAIN_CLIENT_SECRET'),
        scope: requested,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `GBrain token request failed: ${response.status} ${(await response.text()).slice(0, 300)}`,
      );
    }

    const granted = tokenResponse.parse(await response.json());

    // The App does not take a token wider than the one requested. The client's scopes are kept in
    // GBrain, but a client given `admin` by mistake must stop here and not pass `admin` to a run.
    const extra = scopesOf(granted.scope ?? requested).filter(
      (scope) => !scopesOf(requested).includes(scope),
    );

    if (extra.length > 0) {
      throw new Error(`GBrain granted more than requested: ${extra.join(' ')}`);
    }

    return {
      token: granted.access_token,
      ...(granted.expires_in === undefined
        ? {}
        : { expiresAt: addSeconds(new Date(), granted.expires_in) }),
    };
  }
}

function scopesOf(value: string): string[] {
  return value.split(/\s+/).filter((scope) => scope.length > 0);
}
