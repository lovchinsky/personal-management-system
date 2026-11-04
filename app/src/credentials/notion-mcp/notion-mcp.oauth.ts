import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  auth,
  discoverOAuthServerInfo,
  refreshAuthorization,
  type OAuthClientProvider,
  type OAuthServerInfo,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  InvalidGrantError,
  ServerError,
  TemporarilyUnavailableError,
  TooManyRequestsError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { addSeconds } from 'date-fns';
import { Connector } from '../../generated/prisma/enums';
import { required } from '../../platform/config/env-value';
import { messageOf } from '../../platform/error/message-of';
import { ConnectorTokens } from '../connector-credential.repository';
import { ConnectorUnauthorizedError } from '../connector-unauthorized.error';
import { ConnectorUnavailableError } from '../connector-unavailable.error';
import { notionMcpConfig, type NotionMcpConfig } from './notion-mcp.config';

/**
 * How long to wait for the provider's response to one request.
 *
 * The refresh request runs under the lock on the grant row, so this limit is also the limit on
 * how long another refresher will wait for the lock. The same value is the limit on how much time
 * the transaction must have left for the refresh to start at all.
 */
export const PROVIDER_TIMEOUT_MS = 30_000;

/** The connector whose grant this module manages. */
export const NOTION_MCP = 'notion_mcp' satisfies Connector;

/**
 * The token's lifetime when the provider did not state one. It is shorter than the real lifetime,
 * because refreshing too early costs one rotation, while giving a run a dead token costs the run.
 */
const UNSTATED_LIFETIME_SECONDS = 3_600;

/** An authorization waiting for the person's consent. */
interface PendingAuthorization {
  readonly authorizationUrl: URL;
  /** Finishes the authorization with the address the browser returned to after consent. */
  finish(callbackUrl: string): Promise<GrantedAuthorization>;
}

/** A grant just issued by an authorization. */
export interface GrantedAuthorization {
  readonly clientId: string;
  readonly tokens: ConnectorTokens;
}

/**
 * OAuth of the hosted Notion MCP: authorization by the person and refresh without them.
 *
 * The MCP SDK takes care of discovery (RFC 9728, RFC 8414), dynamic client registration
 * (RFC 7591) and PKCE `S256` — the same path that is measured against the live provider. This
 * class covers only what the SDK does not know: where the addresses come from, how to complete
 * an authorization without a listener on the callback address and what a refusal means.
 */
@Injectable()
export class NotionMcpOAuth {
  constructor(@Inject(notionMcpConfig.KEY) private readonly config: NotionMcpConfig) {}

  /**
   * Starts an authorization: registers the client and builds the consent link.
   *
   * The PKCE verifier and `state` live only in this object and do not reach disk or the database
   * (`docs/2-system.md` § “`connector_credentials`”).
   */
  async begin(): Promise<PendingAuthorization> {
    const session = new AuthorizationSession(this.redirectUri(), this.config.clientName);
    const serverUrl = this.serverUrl();
    const started = await auth(session, { serverUrl, fetchFn: timed });
    const authorizationUrl = session.authorizationUrl;

    if (started !== 'REDIRECT' || !authorizationUrl) {
      throw new Error(`Notion MCP authorization did not start: ${started}`);
    }

    return {
      authorizationUrl,
      finish: async (callbackUrl) => {
        const authorizationCode = session.codeFrom(callbackUrl);
        const done = await auth(session, { serverUrl, authorizationCode, fetchFn: timed });

        if (done !== 'AUTHORIZED') {
          throw new Error(`Notion MCP authorization did not complete: ${done}`);
        }

        return session.granted();
      },
    };
  }

  /**
   * Finds the authorization server of the grant by discovery per RFC 9728 and RFC 8414.
   *
   * This step is separate from the refresh because it takes several requests to the provider.
   * Under the lock on the grant row they would use up the transaction time needed for the refresh
   * itself and for writing its result.
   */
  async authorizationServer(): Promise<OAuthServerInfo> {
    try {
      return await discoverOAuthServerInfo(this.serverUrl(), { fetchFn: timed });
    } catch (error) {
      throw unavailableOr(error);
    }
  }

  /**
   * Refreshes the grant with one request to the token endpoint. The provider rotates the refresh
   * token and revokes the prior one, so the result must be written before anything else.
   *
   * `resource` is not passed: that is how the refresh has been measured against the live
   * provider, and a grant issued with `resource` is refreshed the same way.
   */
  async refresh(
    server: OAuthServerInfo,
    clientId: string,
    refreshToken: string,
  ): Promise<ConnectorTokens> {
    try {
      const tokens = await refreshAuthorization(server.authorizationServerUrl, {
        metadata: server.authorizationServerMetadata,
        clientInformation: { client_id: clientId },
        refreshToken,
        fetchFn: timed,
      });

      return tokensOf(tokens);
    } catch (error) {
      // The only refusal a retry cannot fix is a dead grant: the ceiling, the inactivity limit or
      // an already revoked refresh token. Everything else is the network or the provider, and the
      // next attempt makes sense.
      if (error instanceof InvalidGrantError) {
        throw new ConnectorUnauthorizedError(NOTION_MCP, 'the provider refused the grant', {
          cause: error,
        });
      }

      throw unavailableOr(error);
    }
  }

  /** Returns the URL of the hosted Notion MCP, which both OAuth and the run use. */
  serverUrl(): string {
    return required(this.config.url, 'NOTION_MCP_URL');
  }

  private redirectUri(): string {
    return required(this.config.redirectUri, 'NOTION_MCP_REDIRECT_URI');
  }
}

/**
 * One authorization, holding what the SDK stores between its two steps.
 *
 * It never reads tokens, only writes them: an authorization is always new, not a refresh of an
 * existing grant (a refresh has a path of its own). That is also why the client is new every time:
 * its `client_id` goes into the database together with the grant it is registered for.
 */
class AuthorizationSession implements OAuthClientProvider {
  private client?: OAuthClientInformationMixed;
  private verifier?: string;
  private issued?: OAuthTokens;
  private readonly expectedState = randomBytes(32).toString('base64url');

  authorizationUrl?: URL;

  constructor(
    readonly redirectUrl: string,
    private readonly clientName: string,
  ) {}

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.clientName,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string {
    return this.expectedState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.client;
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.client = client;
  }

  tokens(): undefined {
    return undefined;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.issued = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error('no PKCE verifier: the authorization was not started');

    return this.verifier;
  }

  /**
   * Extracts the code from the address the browser returned to.
   *
   * The address must be the callback address of this authorization and include its `state`:
   * otherwise what was pasted is the code of another authorization, or a planted code.
   */
  codeFrom(callbackUrl: string): string {
    const returned = new URL(callbackUrl.trim());
    const expected = new URL(this.redirectUrl);

    if (returned.origin !== expected.origin || returned.pathname !== expected.pathname) {
      throw new Error(`expected a URL starting with ${this.redirectUrl}`);
    }

    if (returned.searchParams.get('state') !== this.expectedState) {
      throw new Error('state does not match this authorization — start it again');
    }

    const denied = returned.searchParams.get('error');
    if (denied) {
      throw new Error(`authorization denied: ${denied}`);
    }

    const code = returned.searchParams.get('code');
    if (!code) {
      throw new Error('the URL carries no authorization code');
    }

    return code;
  }

  granted(): GrantedAuthorization {
    if (!this.client || !this.issued) throw new Error('the authorization has not completed');

    return { clientId: this.client.client_id, tokens: tokensOf(this.issued) };
  }
}

/** Converts the provider's response to the form the store keeps it in. */
function tokensOf(tokens: OAuthTokens): ConnectorTokens {
  const lifetime =
    typeof tokens.expires_in === 'number' ? tokens.expires_in : UNSTATED_LIFETIME_SECONDS;

  return {
    accessToken: tokens.access_token,
    accessTokenExpiresAt: addSeconds(new Date(), lifetime),
    refreshToken: tokens.refresh_token,
    scope: tokens.scope,
  };
}

/**
 * A provider refusal that clears on its own becomes `ConnectorUnavailableError`; anything else
 * stays as it is.
 *
 * The classification is positive: network (`fetch failed`), timeout, HTTP 5xx or 429, and among
 * the OAuth responses “server error”, “temporarily unavailable” and “too many requests”.
 * Anything unrecognized stays a failure, because a run deferred over a deterministic error would
 * be deferred forever.
 */
function unavailableOr(error: unknown): unknown {
  return passes(error)
    ? new ConnectorUnavailableError(NOTION_MCP, messageOf(error), { cause: error })
    : error;
}

function passes(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof TypeError) return error.message === 'fetch failed';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;

  // The SDK puts the status in the text when the response is not OAuth: discovery throws it as a
  // plain error, and the token endpoint as `ServerError`, whatever the status. Then the status
  // decides, not the class: a 404 with an HTML page is a configuration error, not a failure that
  // clears on its own.
  const status = /^HTTP (\d{3})\b/.exec(error.message)?.[1];
  if (status !== undefined) return status.startsWith('5') || status === '429';

  return (
    error instanceof ServerError ||
    error instanceof TemporarilyUnavailableError ||
    error instanceof TooManyRequestsError
  );
}

/**
 * Calls `fetch` with a limit, because without it a hung provider would hold the grant lock
 * indefinitely.
 */
function timed(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
}
