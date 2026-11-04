import { createHash, randomBytes } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { getUnixTime } from 'date-fns';

interface IssuedCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
}

interface RefreshGrant {
  readonly clientId: string;
  active: boolean;
}

/** A grant issued directly, as a completed authorization would have issued it. */
export interface IssuedGrant {
  readonly clientId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

const LIFETIME_SECONDS = 28_800;

function token(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

/**
 * The OAuth provider of the hosted Notion MCP, stubbed by the test.
 *
 * The behavior is the one measured against the live provider: discovery (RFC 9728, RFC 8414),
 * dynamic client registration for a public client, mandatory PKCE `S256`, an eight-hour access
 * token, a refresh token that rotates and revokes the prior one, and `invalid_grant` for a
 * revoked one.
 */
export class FakeNotionOAuth {
  private server?: Server;
  private readonly clients = new Set<string>();
  private readonly codes = new Map<string, IssuedCode>();
  private readonly refreshGrants = new Map<string, RefreshGrant>();

  /** The name of each client that registered: the person sees it on the consent page. */
  readonly registeredNames: unknown[] = [];

  /** Each request to the token endpoint: `grant_type` and, for a code exchange, the verifier. */
  readonly tokenRequests: { readonly grantType: string; readonly verifier?: string }[] = [];

  /** The response to a refresh waits until the test releases it. */
  holdRefresh?: Promise<void>;

  /** How many times clients read the authorization server's metadata (one discovery). */
  discoveries = 0;

  origin = '';

  get mcpUrl(): string {
    return `${this.origin}/mcp`;
  }

  refreshes(): number {
    return this.tokenRequests.filter((request) => request.grantType === 'refresh_token').length;
  }

  /**
   * Resets what the test observes: requests, discoveries, the held response. Issued grants stay.
   */
  reset(): void {
    this.tokenRequests.length = 0;
    this.holdRefresh = undefined;
    this.discoveries = 0;
  }

  isActive(refreshToken: string): boolean {
    return this.refreshGrants.get(refreshToken)?.active === true;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));

    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('not listening on a port');
    }

    this.origin = `http://127.0.0.1:${address.port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server?.close((error) => (error ? reject(error) : resolve())),
    );
  }

  /**
   * Returns the address the browser returns to after the person consented. Without `S256` the
   * provider does not issue a code, as the live provider does.
   */
  approve(authorizationUrl: URL): string {
    const params = authorizationUrl.searchParams;
    const clientId = params.get('client_id') ?? '';
    const redirectUri = params.get('redirect_uri') ?? '';
    const challenge = params.get('code_challenge') ?? '';

    if (!this.clients.has(clientId)) throw new Error(`unknown client ${clientId}`);
    if (params.get('code_challenge_method') !== 'S256') throw new Error('PKCE S256 is required');
    if (challenge.length === 0) throw new Error('no code challenge');

    const code = token('code');

    this.codes.set(code, { clientId, redirectUri, challenge });

    const callback = new URL(redirectUri);

    callback.searchParams.set('code', code);
    callback.searchParams.set('state', params.get('state') ?? '');

    return callback.toString();
  }

  /** Issues a grant directly, in the state a completed authorization would leave it in. */
  issue(): IssuedGrant {
    const clientId = token('client');
    const refreshToken = token('refresh');

    this.clients.add(clientId);
    this.refreshGrants.set(refreshToken, { clientId, active: true });

    return { clientId, accessToken: token('access'), refreshToken };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', this.origin).pathname;

    if (request.method === 'GET' && path.startsWith('/.well-known/oauth-protected-resource')) {
      json(response, 200, {
        resource: this.origin,
        authorization_servers: [this.origin],
        scopes_supported: ['default'],
        bearer_methods_supported: ['header'],
      });

      return;
    }

    if (request.method === 'GET' && path === '/.well-known/oauth-authorization-server') {
      this.discoveries += 1;
      json(response, 200, {
        issuer: this.origin,
        authorization_endpoint: `${this.origin}/authorize`,
        token_endpoint: `${this.origin}/token`,
        registration_endpoint: `${this.origin}/register`,
        scopes_supported: ['default'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      });

      return;
    }

    if (request.method === 'POST' && path === '/register') {
      const metadata: unknown = JSON.parse(await body(request));
      const clientId = token('client');

      this.registeredNames.push(
        typeof metadata === 'object' && metadata !== null && 'client_name' in metadata
          ? metadata.client_name
          : undefined,
      );
      this.clients.add(clientId);
      json(response, 201, {
        ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
        client_id: clientId,
        client_id_issued_at: getUnixTime(new Date()),
      });

      return;
    }

    if (request.method === 'POST' && path === '/token') {
      await this.token(new URLSearchParams(await body(request)), response);

      return;
    }

    json(response, 404, { error: 'not_found' });
  }

  private async token(form: URLSearchParams, response: ServerResponse): Promise<void> {
    const grantType = form.get('grant_type') ?? '';
    const clientId = form.get('client_id') ?? '';

    this.tokenRequests.push({ grantType, verifier: form.get('code_verifier') ?? undefined });

    if (grantType === 'authorization_code') {
      const issued = this.codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const proof = createHash('sha256').update(verifier).digest('base64url');

      this.codes.delete(form.get('code') ?? '');

      if (
        !issued ||
        issued.clientId !== clientId ||
        issued.redirectUri !== form.get('redirect_uri') ||
        issued.challenge !== proof
      ) {
        json(response, 400, { error: 'invalid_grant' });

        return;
      }

      json(response, 200, this.rotate(clientId));

      return;
    }

    if (grantType === 'refresh_token') {
      await this.holdRefresh;

      const grant = this.refreshGrants.get(form.get('refresh_token') ?? '');

      if (!grant?.active || grant.clientId !== clientId) {
        json(response, 400, { error: 'invalid_grant', error_description: 'refresh token revoked' });

        return;
      }

      // Rotation: the prior refresh token is revoked at the same time.
      grant.active = false;
      json(response, 200, this.rotate(clientId));

      return;
    }

    json(response, 400, { error: 'unsupported_grant_type' });
  }

  private rotate(clientId: string): object {
    const refreshToken = token('refresh');

    this.refreshGrants.set(refreshToken, { clientId, active: true });

    return {
      access_token: token('access'),
      token_type: 'bearer',
      expires_in: LIFETIME_SECONDS,
      refresh_token: refreshToken,
      scope: 'default',
    };
  }
}
