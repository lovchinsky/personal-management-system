import { createHash, randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { OauthClient, OauthCode, OauthToken } from '../../src/generated/prisma/client';
import { CLIENT_NOTICE, ClientNotice, ConnectedClient } from '../../src/mcp/oauth/client-notice';
import { OauthClientsRepository } from '../../src/mcp/oauth/oauth-clients.repository';
import { OauthError, OwnerRefusedError } from '../../src/mcp/oauth/oauth-error';
import { OauthServer } from '../../src/mcp/oauth/oauth-server';
import { OauthTokensRepository } from '../../src/mcp/oauth/oauth-tokens.repository';
import { oauthConfig } from '../../src/mcp/oauth/oauth.config';
import { digestOf } from '../../src/mcp/oauth/token-digest';
import { repoFile } from './contracts';

const RESOURCE = 'https://app.example.com/mcp';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const PASSPHRASE = 'p'.repeat(32);

/** What the server put in the database: clients, codes and tokens, exactly as they are stored. */
class Store {
  /** The clients the owner was told are connected, in the order they were announced. */
  readonly announced: ConnectedClient[] = [];
  /** The connection notice fails, but the consent is not canceled because of it. */
  announceFails = false;

  readonly notice: ClientNotice = {
    connected: (client) => {
      this.announced.push(client);

      return this.announceFails
        ? Promise.reject(new Error('the queue is down'))
        : Promise.resolve();
    },
  };

  readonly clients = new Map<string, OauthClient>();
  readonly codes = new Map<string, OauthCode>();
  readonly tokens: OauthToken[] = [];

  readonly clientsRepository: Pick<
    OauthClientsRepository,
    'register' | 'find' | 'count' | 'pruneUnused'
  > = {
    register: (clientName, redirectUris) => {
      const client: OauthClient = {
        id: `client-${this.clients.size + 1}`,
        clientName,
        redirectUris: [...redirectUris],
        createdAt: new Date(),
      };

      this.clients.set(client.id, client);

      return Promise.resolve(client);
    },
    find: (id) => Promise.resolve(this.clients.get(id) ?? null),
    count: () => Promise.resolve(this.clients.size),
    pruneUnused: () => Promise.resolve(0),
  };

  readonly tokensRepository: Pick<
    OauthTokensRepository,
    | 'issueCode'
    | 'redeemCode'
    | 'issueTokens'
    | 'findByAccessHash'
    | 'rotate'
    | 'revokeFamilyOf'
    | 'prune'
  > = {
    issueCode: (code) => {
      this.codes.set(code.codeHash, { ...code, redeemedAt: null, createdAt: new Date() });

      return Promise.resolve();
    },
    redeemCode: (codeHash) => {
      const code = this.codes.get(codeHash);

      if (!code || code.redeemedAt !== null) return Promise.resolve(null);

      this.codes.set(codeHash, { ...code, redeemedAt: new Date() });

      return Promise.resolve(code);
    },
    issueTokens: (tokens) => {
      this.tokens.push({
        ...tokens,
        id: `token-${this.tokens.length + 1}`,
        rotatedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      });

      return Promise.resolve();
    },
    findByAccessHash: (hash) =>
      Promise.resolve(this.tokens.find((token) => token.accessHash === hash) ?? null),
    rotate: () => Promise.resolve({ kind: 'replayed' }),
    revokeFamilyOf: () => Promise.resolve(),
    prune: () => Promise.resolve(0),
  };

  async server(): Promise<OauthServer> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OauthServer,
        { provide: OauthClientsRepository, useValue: this.clientsRepository },
        { provide: OauthTokensRepository, useValue: this.tokensRepository },
        { provide: oauthConfig.KEY, useValue: { mcpUrl: RESOURCE, ownerPassphrase: PASSPHRASE } },
        { provide: CLIENT_NOTICE, useValue: this.notice },
      ],
    }).compile();

    return moduleRef.get(OauthServer);
  }
}

/** Builds the PKCE challenge the way the client builds it. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');

  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function refusalOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof OauthError) return error.code;

    throw error;
  }

  return 'accepted';
}

/**
 * `INV-310` The token that Claude Chat uses to talk to the App MCP is issued by the App for this
 * endpoint: the token's audience is `APP_MCP_URL`, the client's `redirect_uri` comes only from the
 * allowlist, PKCE S256 is mandatory, the authorization code is single-use and short-lived, access
 * and refresh tokens live in `app_db` only as hashes, and the refresh token is rotated: an old
 * one, presented a second time, revokes the whole family.
 *
 * The tests use no model and no live client: the server runs over stub stores that record what
 * they are given. Real clients and a real database belong to the e2e lane.
 */
describe('INV-310', () => {
  it('a client with an address outside the allowlist is not registered', async () => {
    const store = new Store();
    const server = await store.server();

    await expect(
      refusalOf(
        server.register({ client_name: 'x', redirect_uris: ['https://evil.example.com/cb'] }),
      ),
    ).resolves.toBe('invalid_redirect_uri');
    expect(store.clients.size).toBe(0);
  });

  /** The owner issues the code and the exchange issues the token: all the checks pass together. */
  async function exchanged(): Promise<{
    store: Store;
    access: string;
    refresh: string;
    code: string;
  }> {
    const store = new Store();
    const server = await store.server();
    const { client_id: clientId } = await server.register({
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
    });
    const { verifier, challenge } = pkce();
    const request = await server.authorizationRequest({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
    });
    const code = new URL(await server.approve(request, PASSPHRASE)).searchParams.get('code') ?? '';
    const tokens = await server.exchange({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
    });

    return { store, access: tokens.access_token, refresh: tokens.refresh_token, code };
  }

  /**
   * The passphrase is the only factor of consent, so every connection is visible to the owner: if
   * someone else connected, the owner learns it from a message, not from the consequences.
   */
  it('the consent tells the owner who is connected and where the client returns', async () => {
    const { store } = await exchanged();

    expect(store.announced).toEqual([{ name: 'Claude', redirectHost: 'claude.ai' }]);
  });

  it('a failing consent notice does not cancel the consent', async () => {
    const store = new Store();
    const server = await store.server();

    store.announceFails = true;

    const { client_id: clientId } = await server.register({
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
    });
    const request = await server.authorizationRequest({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
    });

    await expect(server.approve(request, PASSPHRASE)).resolves.toContain('code=');
    expect(store.announced).toHaveLength(1);
  });

  it('a wrong owner passphrase announces nobody as connected', async () => {
    const store = new Store();
    const server = await store.server();
    const { client_id: clientId } = await server.register({
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
    });
    const request = await server.authorizationRequest({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
    });

    await expect(server.approve(request, 'wrong')).rejects.toThrow(OwnerRefusedError);
    expect(store.announced).toEqual([]);
  });

  it('the token is issued for the App MCP address, and only digests are stored', async () => {
    const { store, access, refresh, code } = await exchanged();
    const [row] = store.tokens;

    expect(row.resource).toBe(RESOURCE);
    expect(row.accessHash).toBe(digestOf(access));
    expect(row.refreshHash).toBe(digestOf(refresh));
    expect(JSON.stringify([...store.codes.values(), ...store.tokens])).not.toMatch(
      new RegExp(`${access}|${refresh}|${code}`),
    );
  });

  it('the endpoint does not accept a token issued for another resource', async () => {
    const { store, access } = await exchanged();
    const server = await store.server();

    await expect(server.verify(access)).resolves.toBe(true);

    store.tokens[0] = { ...store.tokens[0], resource: 'https://other.example.com/mcp' };

    await expect(server.verify(access)).resolves.toBe(false);
  });

  it('the code is single-use', async () => {
    const { store, code } = await exchanged();

    const spent = [...store.codes.values()].find((row) => row.codeHash === digestOf(code));

    expect(spent?.redeemedAt).toBeInstanceOf(Date);
    expect(store.codes.size).toBe(1);
  });

  it('a refresh token presented a second time is refused with `invalid_grant` (the store revokes the family)', async () => {
    const { store, refresh } = await exchanged();
    const server = await store.server();

    await expect(
      refusalOf(
        server.exchange({
          grant_type: 'refresh_token',
          client_id: 'client-1',
          refresh_token: refresh,
        }),
      ),
    ).resolves.toBe('invalid_grant');
  });

  /**
   * A token is not stored in the clear: no column of the OAuth tables is named after the token.
   */
  it('no column of the OAuth tables stores a secret in the clear', () => {
    const schema = repoFile('app/prisma/schema.prisma');
    const models = ['OauthClient', 'OauthCode', 'OauthToken'].map(
      (name) => new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`).exec(schema)?.[0] ?? '',
    );
    const columns = models.flatMap((model) =>
      [...model.matchAll(/^\s+(\w+)\s+\S+/gm)].map((match) => match[1]),
    );

    expect(models.every((model) => model !== '')).toBe(true);
    expect(columns).toEqual(expect.arrayContaining(['codeHash', 'accessHash', 'refreshHash']));
    expect(
      columns.filter((column) => /^(code|accessToken|refreshToken|secret)$/i.test(column)),
    ).toEqual([]);
  });
});
