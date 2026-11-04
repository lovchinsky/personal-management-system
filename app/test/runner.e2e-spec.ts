import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../src/claude/perimeter';
import { CLAUDE_QUERY, ClaudeQuery, ClaudeQueryParams } from '../src/claude/runner/claude-query';
import { PLUGIN_NAME } from '../src/claude/runner/run-invocation';
import { GbrainToken } from '../src/credentials/gbrain/gbrain.token';
import { NotionMcpGrant } from '../src/credentials/notion-mcp/notion-mcp.grant';
import { runDeliveryKey } from '../src/delivery/delivery-key';
import { PrismaService } from '../src/platform/db/prisma.service';
import { RunTraces, TraceView } from '../src/runs/run-traces';
import { RunDispatcher } from '../src/runs/run.dispatcher';
import { eventEnvelope } from '../src/runs/trigger-envelope';
import { bootApp } from './boot-app';
import {
  aResult,
  initMessage,
  PROFILE_MODEL,
  resultMessage,
  toolResult,
  toolUse,
} from './fixtures/claude-stream.fixture';
import { truncateAll } from './integration/database';

const PLUGIN_DIR = resolve(__dirname, '../plugin');

/** Finds a free loopback port: the App listens on it, and the runner connects to it. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();

      probe.close(() =>
        typeof address === 'object' && address !== null
          ? resolvePort(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}

/** Returns the text of a tool's reply: what the CLI would put into tool_result. */
function textOf(content: unknown): string {
  const parsed = CallToolResultSchema.parse(content);
  const [first] = parsed.content;

  return first?.type === 'text' ? first.text : '';
}

/**
 * Builds a CLI substituted by the test. It does what the real one does: it connects to the App MCP
 * using the address and the bearer from the run options, queues a delivery and returns a valid
 * result. Notion is stubbed, so no real grant is spent here.
 */
function fakeCli(): ClaudeQuery {
  return async function* (params: ClaudeQueryParams) {
    const app = params.options.mcpServers?.app;
    if (app?.type !== 'http') {
      throw new Error('the run has no App MCP over HTTP');
    }

    const runId = params.options.sessionId ?? '';
    const client = new Client({ name: 'fake-cli', version: '1.0.0' });

    await client.connect(
      new StreamableHTTPClientTransport(new URL(app.url), {
        requestInit: { headers: app.headers ?? {} },
      }),
    );

    yield initMessage(runId, 'event_evaluation', {
      tools: [...allowedTools('event_evaluation'), ...PLUGIN_TOOLS, ...HARNESS_TOOLS],
      plugins: [{ name: PLUGIN_NAME, path: PLUGIN_DIR }],
    });

    yield toolUse('t1', 'mcp__notion__notion-fetch', { id: 'page-read-1' });
    yield toolResult('t1', '{"id":"page-read-1"}');

    const queued = await client.callTool({
      name: 'queue_notification',
      arguments: {
        channel: 'telegram',
        message: {
          noticed: 'Задача чекає на постачальника',
          why_it_matters: 'Вона на критичному шляху',
          ask: 'Підготувати ескалацію?',
          link: 'https://www.notion.so/page-1',
        },
      },
    });

    yield toolUse('t2', 'mcp__app__queue_notification');
    yield toolResult('t2', textOf(queued), queued.isError === true);

    await client.close();

    yield resultMessage(runId, { structured_output: aResult() });
  };
}

/**
 * A run from the dispatcher to the run trace, with the real runner, the real App MCP over HTTP with
 * the run's bearer and the writes really applied. Only the CLI and the connector credentials are
 * stubbed.
 */
describe('a run through the runner (e2e)', () => {
  let app: NestExpressApplication;
  const eventId = `evt-${randomUUID()}`;
  const key = runDeliveryKey(eventId);

  const notion: Pick<NotionMcpGrant, 'accessToken' | 'serverUrl' | 'liveness'> = {
    accessToken: () => Promise.resolve('notion-e2e-token'),
    serverUrl: () => 'https://mcp.notion.com/mcp',
    liveness: () => Promise.resolve({ alive: true }),
  };
  const gbrain: Pick<GbrainToken, 'accessToken'> = {
    accessToken: () => Promise.resolve('gbrain-e2e-token'),
  };

  let port: number;

  beforeAll(async () => {
    port = await freePort();
    // The App configuration reads the port while the module is being assembled: the runner
    // reaches the App MCP at this loopback address.
    process.env.PORT = String(port);
    process.env.RUNNER_ENABLED = 'true';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-e2e-token';
    process.env.RUNNER_PLUGIN_DIR = PLUGIN_DIR;
    process.env.RUNNER_GBRAIN_MCP_URL = 'http://127.0.0.1:1/mcp';

    app = await bootApp({
      port,
      substitutes: [
        { provide: CLAUDE_QUERY, useValue: fakeCli() },
        { provide: NotionMcpGrant, useValue: notion },
        { provide: GbrainToken, useValue: gbrain },
      ],
    });
    // The lane shares the database with the integration lane, and the integration lane leaves
    // deferred runs with a future reset time. Without the truncation, the quota run gate would
    // close the very first run.
    await truncateAll(app.get(PrismaService));
  });

  afterAll(async () => {
    await app.close();

    for (const name of [
      'PORT',
      'RUNNER_ENABLED',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'RUNNER_PLUGIN_DIR',
      'RUNNER_GBRAIN_MCP_URL',
    ]) {
      delete process.env[name];
    }
  });

  it('a valid run applies its writes and leaves a full run trace', async () => {
    const prisma = app.get(PrismaService);

    const result = await app.get(RunDispatcher).dispatch({
      envelope: eventEnvelope('event_evaluation', {
        type: 'page.properties_updated',
        event_types: ['page.properties_updated'],
        event_id: eventId,
        timestamp: new Date().toISOString(),
        entity_id: 'page-1',
        page_id: 'page-1',
        updated_property_ids: [],
      }),
      provenance: { origin: 'operator' },
      recordAttempt: () => Promise.resolve(),
    });

    expect(result).toMatchObject({ started: true, verdict: 'completed' });

    const traceId = result.started ? result.traceId : '';
    const trace = await app.get(RunTraces).find(traceId);
    const delivery = await prisma.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: key },
    });
    const expected: Partial<TraceView> = {
      status: 'completed',
      origin: 'operator',
      budgetClass: 'exempt',
      model: PROFILE_MODEL,
      terminalReason: 'completed',
      runtimeEffects: [{ kind: 'delivery', id: delivery.id }],
      result: aResult(),
      toolCalls: [
        { server: 'notion', tool: 'notion-fetch', ok: true },
        { server: 'app', tool: 'queue_notification', ok: true },
      ],
    };

    expect(trace).toMatchObject(expected);
  });
});
