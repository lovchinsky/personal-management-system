import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { addDays, addSeconds, isAfter } from 'date-fns';
import { z } from 'zod';
import { OauthClient } from '../../generated/prisma/client';
import { messageOf } from '../../platform/error/message-of';
import { CLIENT_NOTICE, type ClientNotice } from './client-notice';
import { OauthClientsRepository } from './oauth-clients.repository';
import { OauthError, OwnerLockedError, OwnerRefusedError } from './oauth-error';
import { OauthTokensRepository } from './oauth-tokens.repository';
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  MAX_REGISTERED_CLIENTS,
  oauthConfig,
  REFRESH_TTL_DAYS,
  type OauthConfig,
} from './oauth.config';
import { OwnerLock } from './owner-lock';
import { codeChallengeSchema, codeVerifierSchema, provesChallenge } from './pkce';
import { isAllowedRedirect, matchesRegistered } from './redirect-allowlist';
import { digestOf, newSecret, sameSecret } from './token-digest';

/** The scope the tokens are issued with: access to the App MCP. */
const SCOPE = 'mcp';

/** How many days what is of no further use stays in the database. */
const RETENTION_DAYS = 7;

const GRANT_TYPES = ['authorization_code', 'refresh_token'];

/** The client registration body (RFC 7591): extra client metadata is ignored, not rejected. */
const registrationSchema = z.looseObject({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(z.string().max(2_048)).min(1).max(5),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

/**
 * The authorization request parameters: the same in the consent page `GET` and the decision
 * `POST`.
 */
const authorizationSchema = z.looseObject({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_challenge: codeChallengeSchema,
  code_challenge_method: z.literal('S256'),
  resource: z.string().min(1),
  state: z.string().max(512).optional(),
});

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.looseObject({
    grant_type: z.literal('authorization_code'),
    client_id: z.string().min(1),
    code: z.string().min(1),
    redirect_uri: z.string().min(1),
    code_verifier: codeVerifierSchema,
    resource: z.string().optional(),
  }),
  z.looseObject({
    grant_type: z.literal('refresh_token'),
    client_id: z.string().min(1),
    refresh_token: z.string().min(1),
    resource: z.string().optional(),
  }),
]);

/** The registered client, as it appears in the RFC 7591 response. */
interface RegisteredClient {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly response_types: readonly string[];
  readonly token_endpoint_auth_method: 'none';
}

/** An authorization request that passed the check: what the consent page shows. */
export interface AuthorizationRequest {
  readonly client: OauthClient;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly state?: string;
}

/** The token endpoint response. */
interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

/**
 * The App's authorization server for the installation owner (`docs/2-system.md`
 * § “Authentication boundary”, ADR 0021): client registration, the owner's consent, code → tokens
 * with PKCE, refresh token rotation, revocation and access token verification for `/mcp`.
 *
 * Tokens are random, and the database holds only their SHA-256 digests. The token's audience is
 * the App MCP address, and the endpoint does not accept a token issued for another resource
 * (`INV-310`).
 */
@Injectable()
export class OauthServer {
  private readonly logger = new Logger(OauthServer.name);

  private readonly lock = new OwnerLock();

  constructor(
    private readonly clients: OauthClientsRepository,
    private readonly tokens: OauthTokensRepository,
    @Inject(oauthConfig.KEY) private readonly config: OauthConfig,
    @Inject(CLIENT_NOTICE) private readonly notice: ClientNotice,
  ) {}

  /** The server answers only when both the endpoint address and the owner passphrase are known. */
  get enabled(): boolean {
    return this.config.mcpUrl !== undefined && this.config.ownerPassphrase !== undefined;
  }

  /** The App MCP address without a trailing slash: the canonical resource URI (RFC 8707). */
  get resource(): string {
    return this.mcpUrl().replace(/\/$/, '');
  }

  /**
   * The issuer is the origin of the public address: the client builds every `.well-known` from it.
   */
  get issuer(): string {
    return new URL(this.mcpUrl()).origin;
  }

  /**
   * Returns the `WWW-Authenticate` header for a 401, which says where the resource metadata
   * lives. Without a configured server there is no metadata, and the header stays bare.
   */
  challenge(invalidToken: boolean): string {
    if (!this.enabled) return 'Bearer';

    const path = new URL(this.resource).pathname.replace(/\/$/, '');
    const url = `${this.issuer}/.well-known/oauth-protected-resource${path}`;

    return `Bearer resource_metadata="${url}"${invalidToken ? ', error="invalid_token"' : ''}`;
  }

  protectedResourceMetadata(): object {
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
    };
  }

  authorizationServerMetadata(): object {
    const issuer = this.issuer;

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE, 'offline_access'],
    };
  }

  /** Registers a public client (RFC 7591), with addresses only from the allowlist. */
  async register(body: unknown): Promise<RegisteredClient> {
    const parsed = registrationSchema.safeParse(body);

    if (!parsed.success) {
      throw new OauthError('invalid_client_metadata', z.prettifyError(parsed.error));
    }

    const metadata = parsed.data;
    const refused = metadata.redirect_uris.filter((uri) => !isAllowedRedirect(uri));

    if (refused.length > 0) {
      throw new OauthError(
        'invalid_redirect_uri',
        `redirect URIs outside the allowlist: ${refused.join(', ')}`,
      );
    }

    if (
      (metadata.grant_types ?? GRANT_TYPES).some((type) => !GRANT_TYPES.includes(type)) ||
      (metadata.response_types ?? ['code']).some((type) => type !== 'code') ||
      (metadata.token_endpoint_auth_method ?? 'none') !== 'none'
    ) {
      throw new OauthError(
        'invalid_client_metadata',
        'only public clients using the authorization code flow are registered',
      );
    }

    if ((await this.clients.count()) >= MAX_REGISTERED_CLIENTS) {
      throw new OauthError('temporarily_unavailable', 'too many registered clients', 503);
    }

    const client = await this.clients.register(
      metadata.client_name ?? 'MCP client',
      metadata.redirect_uris,
    );

    this.logger.log(`registered client ${client.id} (${client.clientName})`);

    return {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1_000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: GRANT_TYPES,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  /**
   * Checks an authorization request before showing the owner the consent page. An unknown client
   * or a foreign return address is refused without a redirect, because it is not yet known where
   * to return.
   */
  async authorizationRequest(query: unknown): Promise<AuthorizationRequest> {
    const parsed = authorizationSchema.safeParse(query);

    if (!parsed.success) {
      throw new OauthError('invalid_request', z.prettifyError(parsed.error));
    }

    const request = parsed.data;
    const client = await this.clients.find(request.client_id);

    if (!client) throw new OauthError('invalid_client', 'unknown client');

    if (!matchesRegistered(client.redirectUris, request.redirect_uri)) {
      throw new OauthError('invalid_request', 'redirect_uri is not registered for this client');
    }

    if (request.resource.replace(/\/$/, '') !== this.resource) {
      throw new OauthError('invalid_target', 'resource is not this MCP server');
    }

    return {
      client,
      redirectUri: request.redirect_uri,
      codeChallenge: request.code_challenge,
      resource: this.resource,
      state: request.state,
    };
  }

  /**
   * Handles the owner's consent: the passphrase, after which a code is issued. The address it
   * returns is the same one that passed the check, with the code and `state`.
   */
  async approve(request: AuthorizationRequest, passphrase: string): Promise<string> {
    this.assertOwner(passphrase);

    const code = newSecret();

    await this.tokens.issueCode({
      codeHash: digestOf(code),
      clientId: request.client.id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      resource: request.resource,
      expiresAt: addSeconds(new Date(), CODE_TTL_SECONDS),
    });

    this.logger.log(`owner approved client ${request.client.id} (${request.client.clientName})`);
    await this.announce(request);

    return returnUrl(request, { code, iss: this.issuer });
  }

  /**
   * Tells the owner that the client has connected. This detects someone else's connection and is
   * not part of the consent, so a notification failure does not cancel the consent.
   */
  private async announce(request: AuthorizationRequest): Promise<void> {
    try {
      await this.notice.connected({
        name: request.client.clientName,
        redirectHost: new URL(request.redirectUri).host,
      });
    } catch (error) {
      this.logger.warn(`the connection notice was not queued: ${messageOf(error)}`);
    }
  }

  /** Handles the owner's refusal: the client gets `access_denied` at its own address. */
  deny(request: AuthorizationRequest): string {
    return returnUrl(request, { error: 'access_denied', iss: this.issuer });
  }

  /** Serves the token endpoint: exchanges a code or a refresh token for a new pair. */
  async exchange(body: unknown): Promise<TokenResponse> {
    const parsed = tokenSchema.safeParse(body);

    if (!parsed.success) {
      const grant = z.looseObject({ grant_type: z.string() }).safeParse(body);

      throw grant.success && !GRANT_TYPES.includes(grant.data.grant_type)
        ? new OauthError('unsupported_grant_type', `grant_type ${grant.data.grant_type}`)
        : new OauthError('invalid_request', z.prettifyError(parsed.error));
    }

    const request = parsed.data;

    if (request.resource !== undefined && request.resource.replace(/\/$/, '') !== this.resource) {
      throw new OauthError('invalid_target', 'resource is not this MCP server');
    }

    return request.grant_type === 'authorization_code'
      ? this.redeem(request)
      : this.refresh(request.client_id, request.refresh_token);
  }

  /** Revokes the token's family, after which neither the access nor the refresh token works. */
  async revoke(token: string): Promise<void> {
    await this.tokens.revokeFamilyOf(digestOf(token));
  }

  /**
   * Checks whether the access token is valid for this endpoint: the digest is known, the pair is
   * neither revoked nor rotated, the expiry has not passed, and the audience is the App MCP itself.
   */
  async verify(bearer: string): Promise<boolean> {
    if (!this.enabled) return false;

    const row = await this.tokens.findByAccessHash(digestOf(bearer));

    return (
      row !== null &&
      row.revokedAt === null &&
      row.rotatedAt === null &&
      isAfter(row.accessExpiresAt, new Date()) &&
      row.resource === this.resource
    );
  }

  /**
   * Prunes what is of no further use: expired codes, dead tokens, clients without access.
   */
  async prune(): Promise<number> {
    return (await this.tokens.prune(RETENTION_DAYS)) + (await this.clients.pruneUnused(1));
  }

  private async redeem(
    request: Extract<z.infer<typeof tokenSchema>, { grant_type: 'authorization_code' }>,
  ): Promise<TokenResponse> {
    const code = await this.tokens.redeemCode(digestOf(request.code));
    const refused = (reason: string): OauthError => new OauthError('invalid_grant', reason);

    if (!code) throw refused('the authorization code is unknown, used or expired');

    if (
      code.clientId !== request.client_id ||
      code.redirectUri !== request.redirect_uri ||
      code.resource !== this.resource
    ) {
      throw refused('the code was issued to another client, redirect URI or resource');
    }

    if (!provesChallenge(request.code_verifier, code.codeChallenge)) {
      throw refused('the code verifier does not match the challenge');
    }

    const issued = this.newTokens(randomUUID(), code.clientId);

    await this.tokens.issueTokens(issued.stored);

    this.logger.log(`issued tokens to client ${code.clientId}`);

    return issued.response;
  }

  private async refresh(clientId: string, refreshToken: string): Promise<TokenResponse> {
    let response: TokenResponse | undefined;

    const outcome = await this.tokens.rotate(digestOf(refreshToken), (previous) => {
      if (previous.clientId !== clientId) {
        // Another client does not burn the refresh token of the client it was issued to: the
        // refusal rolls the rotation back.
        throw new OauthError('invalid_grant', 'the refresh token belongs to another client');
      }

      const issued = this.newTokens(previous.familyId, previous.clientId);

      response = issued.response;

      return issued.stored;
    });

    if (outcome.kind === 'replayed') {
      this.logger.warn('a rotated refresh token was presented again — its family is revoked');

      throw new OauthError('invalid_grant', 'the refresh token was already used');
    }

    if (outcome.kind === 'refused' || response === undefined) {
      throw new OauthError('invalid_grant', 'the refresh token is unknown, revoked or expired');
    }

    return response;
  }

  /**
   * Creates a new token pair of the family: the response to the client and what is stored in the
   * database.
   */
  private newTokens(
    familyId: string,
    clientId: string,
  ): {
    readonly response: TokenResponse;
    readonly stored: Parameters<OauthTokensRepository['issueTokens']>[0];
  } {
    const access = newSecret();
    const refresh = newSecret();
    const now = new Date();

    return {
      response: {
        access_token: access,
        token_type: 'Bearer',
        expires_in: ACCESS_TTL_SECONDS,
        refresh_token: refresh,
        scope: SCOPE,
      },
      stored: {
        familyId,
        clientId,
        resource: this.resource,
        accessHash: digestOf(access),
        accessExpiresAt: addSeconds(now, ACCESS_TTL_SECONDS),
        refreshHash: digestOf(refresh),
        refreshExpiresAt: addDays(now, REFRESH_TTL_DAYS),
      },
    };
  }

  /**
   * Checks the owner passphrase: the lock is closed after failures, and the comparison runs in
   * constant time.
   */
  private assertOwner(given: string): void {
    const locked = this.lock.closedFor();

    if (locked > 0) {
      throw new OwnerLockedError(Math.ceil(locked / 1_000));
    }

    if (!sameSecret(given, this.ownerPassphrase())) {
      this.lock.failed();
      this.logger.warn('the owner passphrase was refused');

      throw new OwnerRefusedError();
    }

    this.lock.succeeded();
  }

  private mcpUrl(): string {
    if (this.config.mcpUrl === undefined) throw new Error('APP_MCP_URL is not set');

    return this.config.mcpUrl;
  }

  private ownerPassphrase(): string {
    if (this.config.ownerPassphrase === undefined) {
      throw new Error('APP_OAUTH_OWNER_PASSPHRASE is not set');
    }

    return this.config.ownerPassphrase;
  }
}

/**
 * Builds the return address for the client: parameters are added to the existing query and do not
 * replace it.
 */
function returnUrl(
  request: AuthorizationRequest,
  params: Readonly<Record<string, string>>,
): string {
  const url = new URL(request.redirectUri);

  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  if (request.state !== undefined) url.searchParams.set('state', request.state);

  return url.toString();
}
