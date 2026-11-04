import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { addMinutes, subSeconds } from 'date-fns';
import request from 'supertest';
import { runDeliveryKey } from '../src/delivery/delivery-key';
import { PrismaService } from '../src/platform/db/prisma.service';
import { EffectsGrant, RUN_EFFECTS_ADAPTER, RunEffects } from '../src/runs/run-effects';
import { bootApp } from './boot-app';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1.0.0' },
  },
};

/**
 * The App MCP through the real HTTP perimeter: the same `configureApp` as in the production
 * process, the real SDK MCP client, a run session opened through the same port the dispatcher
 * opens it through.
 */
describe('App MCP (e2e)', () => {
  let app: NestExpressApplication;
  let effects: RunEffects;
  let base: string;

  beforeAll(async () => {
    app = await bootApp({ port: 0 });

    effects = app.get<RunEffects>(RUN_EFFECTS_ADAPTER);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  function grant(overrides: Partial<EffectsGrant> = {}): EffectsGrant {
    return {
      runId: randomUUID(),
      mode: 'daily_control',
      provenance: { origin: 'review_schedule' },
      cause: `e2e-${randomUUID()}`,
      startedAt: new Date(),
      expiresAt: addMinutes(new Date(), 15),
      deadline: new AbortController().signal,
      ...overrides,
    };
  }

  async function clientWith(bearer: string): Promise<Client> {
    const client = new Client({ name: 'e2e', version: '1.0.0' });

    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      }),
    );

    return client;
  }

  describe('authentication', () => {
    it('a request without a bearer gets 401 with no body and a Bearer challenge pointing to the resource metadata', async () => {
      const response = await request(app.getHttpServer())
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send(INITIALIZE)
        .expect(401);

      expect(response.headers['www-authenticate']).toBe(
        'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
      );
      expect(response.text).toBe('');
    });

    it('a bearer the App never issued gets the same answer', async () => {
      await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', `Bearer ${randomUUID()}`)
        .send(INITIALIZE)
        .expect(401);
    });

    /** Whoever is not authenticated cannot even learn which methods exist here. */
    it('other methods get 401 without a bearer and 405 with one', async () => {
      const session = effects.open(grant());

      await request(app.getHttpServer()).get('/mcp').expect(401);
      await request(app.getHttpServer())
        .get('/mcp')
        .set('Authorization', `Bearer ${session.bearer}`)
        .expect(405)
        .expect('Allow', 'POST');

      await session.discard();
    });

    it('a session whose expiry has passed gets 401', async () => {
      const session = effects.open(grant({ expiresAt: subSeconds(new Date(), 1) }));

      await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', `Bearer ${session.bearer}`)
        .send(INITIALIZE)
        .expect(401);

      await session.discard();
    });

    it('a closed session gets 401', async () => {
      const session = effects.open(grant());

      await session.discard();

      await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', `Bearer ${session.bearer}`)
        .send(INITIALIZE)
        .expect(401);
    });
  });

  describe('run session', () => {
    it('tools/list equals the App part of the mode row', async () => {
      const session = effects.open(grant());
      const client = await clientWith(session.bearer);
      const { tools } = await client.listTools();

      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [
          'get_delivery_state',
          'get_pending_action',
          'get_runtime_state',
          'get_schema_mapping',
          'list_pending_actions',
          'queue_notification',
        ].sort(),
      );

      await client.close();
      await session.discard();
    });

    /** A write does not appear until the dispatcher decides on the conclusion. */
    it('a write over HTTP is staged until the conclusion', async () => {
      const prisma = app.get(PrismaService);
      const cause = `e2e-${randomUUID()}`;
      const key = runDeliveryKey(cause);
      const session = effects.open(grant({ cause }));
      const client = await clientWith(session.bearer);

      const staged = await client.callTool({
        name: 'queue_notification',
        arguments: {
          channel: 'telegram',
          message: {
            noticed: 'Огляд знайшов дві прострочені задачі',
            why_it_matters: 'Обидві на критичному шляху',
            ask: 'Переглянути зараз?',
            link: 'https://www.notion.so/page-1',
          },
        },
      });

      expect(staged.isError).toBeFalsy();
      await expect(
        prisma.notificationOutbox.count({ where: { idempotencyKey: key } }),
      ).resolves.toBe(0);

      await client.close();

      const report = await session.commit();

      expect(report.applied).toHaveLength(1);
      await expect(
        prisma.notificationOutbox.count({ where: { idempotencyKey: key } }),
      ).resolves.toBe(1);
    });
  });
});
