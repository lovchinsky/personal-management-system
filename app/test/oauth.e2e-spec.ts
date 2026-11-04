import { createHash, randomBytes } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { z } from 'zod';
import { appConfig } from '../src/config/app.config';
import { chatTools } from '../src/runs/toolsets';
import { textsOf } from '../src/texts/texts';
import { bootApp } from './boot-app';

const RESOURCE = 'http://localhost:3000/mcp';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const PASSPHRASE = 'e2e-owner-passphrase-0123456789abcdef';

const tokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
});

const registered = z.object({ client_id: z.string(), redirect_uris: z.array(z.string()) });

/** Builds a PKCE pair as a client would: the verifier and its S256 challenge. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');

  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/**
 * The App's authorization server, exercised through the real HTTP perimeter: metadata, client
 * registration, the owner's consent, the code exchange with PKCE, the token on `/mcp`, rotation and
 * revocation (`INV-310`). The client is plain `supertest` and the SDK's MCP client.
 */
describe('OAuth for the chat (e2e)', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    app = await bootApp({ port: 0 });
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  async function registerClient(redirect = CALLBACK): Promise<string> {
    const response = await http()
      .post('/oauth/register')
      .send({ client_name: 'Claude', redirect_uris: [redirect] })
      .expect(201);

    return registered.parse(response.body).client_id;
  }

  /** Builds the parameters of an authorization request, as the client sends them. */
  function authorization(
    clientId: string,
    challenge: string,
    overrides: Record<string, string> = {},
  ): Record<string, string> {
    return {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
      state: 'state-1',
      ...overrides,
    };
  }

  /** Grants the owner's consent and returns the code the client gets at its own address. */
  async function approved(clientId: string, challenge: string): Promise<string> {
    const response = await http()
      .post('/oauth/authorize')
      .type('form')
      .send({ ...authorization(clientId, challenge), decision: 'allow', passphrase: PASSPHRASE })
      .expect(303);
    const location = new URL(String(response.headers.location));

    expect(location.origin + location.pathname).toBe(CALLBACK);
    expect(location.searchParams.get('state')).toBe('state-1');
    expect(location.searchParams.get('iss')).toBe('http://localhost:3000');

    return location.searchParams.get('code') ?? '';
  }

  async function tokens(
    clientId: string,
    verifier: string,
    code: string,
  ): Promise<z.infer<typeof tokenResponse>> {
    const response = await http()
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: CALLBACK,
        code_verifier: verifier,
        resource: RESOURCE,
      })
      .expect(200);

    return tokenResponse.parse(response.body);
  }

  /** Runs the full connection path: registration, consent, exchange. */
  async function connected(): Promise<{ clientId: string } & z.infer<typeof tokenResponse>> {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();

    return { clientId, ...(await tokens(clientId, verifier, await approved(clientId, challenge))) };
  }

  const mcp = (bearer: string): Promise<{ status: number }> =>
    http()
      .post('/mcp')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'e2e', version: '1.0.0' },
        },
      })
      .then((response) => ({ status: response.status }));

  describe('metadata', () => {
    it('the resource names itself and its authorization server', async () => {
      for (const path of [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ]) {
        const response = await http().get(path).expect(200);

        expect(response.body).toMatchObject({
          resource: RESOURCE,
          authorization_servers: ['http://localhost:3000'],
        });
      }
    });

    it('the authorization server promises only what it delivers', async () => {
      const response = await http().get('/.well-known/oauth-authorization-server').expect(200);

      expect(response.body).toMatchObject({
        issuer: 'http://localhost:3000',
        authorization_endpoint: 'http://localhost:3000/oauth/authorize',
        token_endpoint: 'http://localhost:3000/oauth/token',
        registration_endpoint: 'http://localhost:3000/oauth/register',
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      });
    });
  });

  describe('client registration', () => {
    it('accepts a loopback address on any port as a Claude Code client', async () => {
      await expect(registerClient('http://localhost:61234/callback')).resolves.toEqual(
        expect.any(String),
      );
    });

    it.each([
      ['a foreign return address', { redirect_uris: ['https://evil.example.com/cb'] }],
      [
        'a client authentication method the App does not support',
        {
          redirect_uris: [CALLBACK],
          token_endpoint_auth_method: 'client_secret_basic',
        },
      ],
      ['a grant the App does not issue', { redirect_uris: [CALLBACK], grant_types: ['password'] }],
      ['an empty address list', { redirect_uris: [] }],
    ])('%s is refused with an RFC 7591 code', async (_, body) => {
      const response = await http().post('/oauth/register').send(body).expect(400);

      expect(response.body).toEqual({
        error: expect.stringMatching(/^invalid_(redirect_uri|client_metadata)$/),
        error_description: expect.any(String),
      });
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('owner consent', () => {
    it('the page shows the client and the return host, escapes the name and carries a CSP', async () => {
      const clientId = await http()
        .post('/oauth/register')
        .send({ client_name: '<script>alert(1)</script>', redirect_uris: [CALLBACK] })
        .expect(201)
        .then((response) => registered.parse(response.body).client_id);
      const response = await http()
        .get('/oauth/authorize')
        .query(authorization(clientId, pkce().challenge))
        .expect(200);

      expect(response.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(response.text).not.toContain('<script>alert(1)');
      expect(response.text).toContain('claude.ai');
      expect(response.headers['content-security-policy']).toContain('frame-ancestors');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it.each([
      [
        'an unknown client',
        (): Record<string, string> => authorization('no-such-client', pkce().challenge),
      ],
      ['the plain method', (): Record<string, string> => ({ code_challenge_method: 'plain' })],
      [
        'a foreign resource',
        (): Record<string, string> => ({ resource: 'https://other.example.com/mcp' }),
      ],
      ['a missing PKCE challenge', (): Record<string, string> => ({ code_challenge: '' })],
    ])('%s yields an error page, not a redirect', async (_, overrides) => {
      const clientId = await registerClient();
      const query = { ...authorization(clientId, pkce().challenge), ...overrides() };
      const response = await http().get('/oauth/authorize').query(query);

      expect(response.status).toBe(400);
      expect(response.headers.location).toBeUndefined();
    });

    it('a return address the client did not register is refused without a redirect', async () => {
      const clientId = await registerClient();
      const response = await http()
        .get('/oauth/authorize')
        .query(
          authorization(clientId, pkce().challenge, {
            redirect_uri: 'https://claude.com/api/mcp/auth_callback',
          }),
        )
        .expect(400);

      expect(response.headers.location).toBeUndefined();
    });

    it('a wrong passphrase yields 403 and the same page, with no code issued', async () => {
      const clientId = await registerClient();
      const response = await http()
        .post('/oauth/authorize')
        .type('form')
        .send({
          ...authorization(clientId, pkce().challenge),
          decision: 'allow',
          passphrase: 'wrong',
        })
        .expect(403);

      expect(response.headers.location).toBeUndefined();
      expect(response.text).toContain(textsOf(appConfig().language).consent.refused);
    });

    it('the owner denying consent returns `access_denied` to the client at its address', async () => {
      const clientId = await registerClient();
      const response = await http()
        .post('/oauth/authorize')
        .type('form')
        .send({ ...authorization(clientId, pkce().challenge), decision: 'deny' })
        .expect(303);
      const location = new URL(String(response.headers.location));

      expect(location.searchParams.get('error')).toBe('access_denied');
      expect(location.searchParams.get('state')).toBe('state-1');
    });
  });

  describe('code exchange', () => {
    it('a code with the right verifier yields a token pair, and a second exchange is refused', async () => {
      const clientId = await registerClient();
      const { verifier, challenge } = pkce();
      const code = await approved(clientId, challenge);

      const issued = await tokens(clientId, verifier, code);

      expect(issued).toMatchObject({ token_type: 'Bearer', expires_in: 3_600, scope: 'mcp' });

      const again = await http()
        .post('/oauth/token')
        .type('form')
        .send({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: CALLBACK,
          code_verifier: verifier,
        })
        .expect(400);

      expect(again.body).toMatchObject({ error: 'invalid_grant' });
      expect(again.headers['cache-control']).toBe('no-store');
    });

    it('a wrong verifier yields `invalid_grant` and spends the code: guessing gets no second attempt', async () => {
      const clientId = await registerClient();
      const { verifier, challenge } = pkce();
      const code = await approved(clientId, challenge);
      const response = await http()
        .post('/oauth/token')
        .type('form')
        .send({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: CALLBACK,
          code_verifier: pkce().verifier,
        })
        .expect(400);

      expect(response.body).toMatchObject({ error: 'invalid_grant' });

      await http()
        .post('/oauth/token')
        .type('form')
        .send({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: CALLBACK,
          code_verifier: verifier,
        })
        .expect(400);
    });

    it('a code issued to one client is not valid for another', async () => {
      const owner = await registerClient();
      const thief = await registerClient();
      const { verifier, challenge } = pkce();
      const code = await approved(owner, challenge);
      const response = await http()
        .post('/oauth/token')
        .type('form')
        .send({
          grant_type: 'authorization_code',
          client_id: thief,
          code,
          redirect_uri: CALLBACK,
          code_verifier: verifier,
        })
        .expect(400);

      expect(response.body).toMatchObject({ error: 'invalid_grant' });
    });

    it('an unknown `grant_type` yields `unsupported_grant_type`', async () => {
      const response = await http()
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'password', client_id: 'x' })
        .expect(400);

      expect(response.body).toMatchObject({ error: 'unsupported_grant_type' });
    });
  });

  describe('the token on `/mcp`', () => {
    it('an access token lets the chat in: `tools/list` is exactly `chat_toolset`, and the call comes from the person', async () => {
      const { access_token: access } = await connected();
      const client = new Client({ name: 'e2e', version: '1.0.0' });

      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${access}` } },
        }),
      );

      try {
        const { tools } = await client.listTools();

        expect(tools.map((tool) => tool.name).sort()).toEqual([...chatTools()].sort());

        const state = await client.callTool({ name: 'get_runtime_state', arguments: {} });
        const [block] = Array.isArray(state.content) ? state.content : [];

        expect(block && 'text' in block ? JSON.parse(String(block.text)) : {}).toMatchObject({
          surface: 'chat',
        });
      } finally {
        await client.close();
      }
    });

    it('a 401 for a wrong token names `invalid_token` and points to the metadata', async () => {
      const response = await http()
        .post('/mcp')
        .set('Authorization', 'Bearer not-a-token')
        .send({})
        .expect(401);

      expect(response.headers['www-authenticate']).toBe(
        'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp", error="invalid_token"',
      );
    });
  });

  describe('rotation and revocation', () => {
    async function refreshed(
      clientId: string,
      refreshToken: string,
    ): Promise<{ status: number; body: unknown }> {
      const response = await http()
        .post('/oauth/token')
        .type('form')
        .send({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });

      return { status: response.status, body: z.unknown().parse(response.body) };
    }

    it('a refresh issues the next pair, and the old pair stops being valid', async () => {
      const first = await connected();
      const second = await refreshed(first.clientId, first.refresh_token);

      expect(second.status).toBe(200);

      const next = tokenResponse.parse(second.body);

      expect(next.access_token).not.toBe(first.access_token);
      expect((await mcp(next.access_token)).status).toBe(200);
      expect((await mcp(first.access_token)).status).toBe(401);
    });

    it('an old refresh token, presented a second time, revokes the whole family, including the new pair', async () => {
      const first = await connected();
      const next = tokenResponse.parse((await refreshed(first.clientId, first.refresh_token)).body);

      const replay = await refreshed(first.clientId, first.refresh_token);

      expect(replay.status).toBe(400);
      expect(replay.body).toMatchObject({ error: 'invalid_grant' });
      expect((await mcp(next.access_token)).status).toBe(401);
      expect((await refreshed(first.clientId, next.refresh_token)).status).toBe(400);
    });

    it("a foreign client does not burn the owner's refresh token", async () => {
      const first = await connected();
      const thief = await registerClient();

      expect((await refreshed(thief, first.refresh_token)).status).toBe(400);
      expect((await refreshed(first.clientId, first.refresh_token)).status).toBe(200);
    });

    it('revocation disables both the access token and the refresh token', async () => {
      const first = await connected();

      await http()
        .post('/oauth/revoke')
        .type('form')
        .send({ token: first.refresh_token })
        .expect(200);

      expect((await mcp(first.access_token)).status).toBe(401);
      expect((await refreshed(first.clientId, first.refresh_token)).status).toBe(400);
    });
  });
});
