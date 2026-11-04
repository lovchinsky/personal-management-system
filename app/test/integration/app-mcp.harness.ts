import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResult, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client as NotionClient } from '@notionhq/client';
import { addMinutes } from 'date-fns';
import { z } from 'zod';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { PreconditionEvaluator } from '../../src/approvals/preconditions/precondition.evaluator';
import { proposalQueryWireSchema, proposalWireSchema } from '../../src/approvals/proposal.wire';
import { AttentionService } from '../../src/attention/attention.service';
import { commentWireSchema } from '../../src/attention/comment.wire';
import { SystemDiscussionRepository } from '../../src/attention/system-discussion.repository';
import { CaptureService } from '../../src/capture/capture.service';
import { inboxConversionWireSchema } from '../../src/capture/inbox-conversion.wire';
import { appConfig } from '../../src/config/app.config';
import {
  continuationQueryWireSchema,
  continuationWireSchema,
} from '../../src/continuations/continuation.wire';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { ScheduledCheckRepository } from '../../src/continuations/scheduled-check.repository';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { deliveryQueryWireSchema, deliveryWireSchema } from '../../src/delivery/delivery.wire';
import { outboxConfig } from '../../src/delivery/outbox/outbox.config';
import { OutboxRepository } from '../../src/delivery/outbox/outbox.repository';
import { QuietHours } from '../../src/delivery/outbox/quiet-hours';
import {
  quietHoursConfig,
  type QuietHoursConfig,
} from '../../src/delivery/outbox/quiet-hours.config';
import { NOTIFICATION_CHANNELS } from '../../src/delivery/port/channel.port';
import { ChannelRegistry } from '../../src/delivery/port/channel.registry';
import { RunWrites } from '../../src/effects/run-writes';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { AppMcp } from '../../src/mcp/server/app-mcp';
import { assistantConfig } from '../../src/mcp/server/assistant.config';
import { RunSessions } from '../../src/mcp/server/run-sessions';
import { MEMORY_GBRAIN, MemoryService } from '../../src/memory/memory.service';
import { BotIdentity } from '../../src/notion/client/bot-identity';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { Page } from '../../src/notion/client/page';
import { PageReader } from '../../src/notion/client/page.reader';
import { SchemaMappingReader } from '../../src/notion/semantics/schema-mapping.reader';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { budgetConfig } from '../../src/runs/budget.config';
import { RunProvenance } from '../../src/runs/provenance';
import { EffectsGrant, RunEffectsSession } from '../../src/runs/run-effects';
import { runsConfig } from '../../src/runs/runs.config';
import { TASK_TYPES } from '../fixtures/capture-world';
import { FakeGbrain } from '../fixtures/fake-gbrain.fixture';
import { INTEGRATION_BOT } from '../fixtures/notion-bot';
import { NOTICE_PROVIDER } from '../fixtures/proposal-notice';
import { bindingProvider, testConfig } from '../fixtures/test-module';
import { WritingNotion } from '../fixtures/writing-notion';

/** A change in Notion that nobody asked for: an autonomous run. */
const NOTICED: RunProvenance = { origin: 'evaluation_window' };

export interface Connected {
  readonly session: RunEffectsSession;
  readonly client: Client;
}

export interface AppMcpHarness {
  readonly moduleRef: TestingModule;
  readonly prisma: PrismaService;
  readonly sessions: RunSessions;
  /** The Notion the system writes to: comments and conversions. */
  readonly notion: WritingNotion;
  /** Opens a run session and connects a client to it, as the CLI would. */
  connected(given?: EffectsGrant): Promise<Connected>;
  /** Closes the clients connected by this test. */
  disconnect(): Promise<void>;
  close(): Promise<void>;
}

export function grant(
  mode: WorkflowMode = 'event_evaluation',
  provenance: RunProvenance = NOTICED,
): EffectsGrant {
  return {
    runId: randomUUID(),
    mode,
    provenance,
    cause: randomUUID(),
    startedAt: new Date(),
    expiresAt: addMinutes(new Date(), 15),
    deadline: new AbortController().signal,
  };
}

/** The input of each App MCP tool, in the shape the model sends it. */
export interface ToolArguments {
  readonly add_comment: z.input<typeof commentWireSchema>;
  readonly convert_inbox_item: z.input<typeof inboxConversionWireSchema>;
  readonly schedule_continuation: z.input<typeof continuationWireSchema>;
  readonly reschedule_continuation: z.input<typeof continuationWireSchema>;
  readonly get_continuation_state: z.input<typeof continuationQueryWireSchema>;
  readonly queue_notification: z.input<typeof deliveryWireSchema>;
  readonly get_delivery_state: z.input<typeof deliveryQueryWireSchema>;
  readonly create_pending_action: z.input<typeof proposalWireSchema>;
  readonly get_pending_action: z.input<typeof proposalQueryWireSchema>;
  readonly get_runtime_state: Record<string, never>;
  readonly get_schema_mapping: Record<string, never>;
}

export function call<Name extends keyof ToolArguments>(
  client: Client,
  name: Name,
  args: ToolArguments[Name],
): Promise<CallToolResult> {
  return callMalformed(client, name, args);
}

/** Calls a tool with input its schema may reject, as a model that made a mistake would. */
export async function callMalformed(
  client: Client,
  name: keyof ToolArguments,
  args: Readonly<Record<string, unknown>>,
): Promise<CallToolResult> {
  return CallToolResultSchema.parse(await client.callTool({ name, arguments: { ...args } }));
}

/** Returns a tool's reply as text, which is how the model sees it. */
export function textOf(result: CallToolResult): string {
  const [first] = result.content;

  return first?.type === 'text' ? first.text : '';
}

export function jsonOf(result: CallToolResult): Record<string, unknown> {
  const parsed: unknown = JSON.parse(textOf(result));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('not a JSON object');
  }

  return Object.fromEntries(Object.entries(parsed));
}

/**
 * Builds the App MCP over real capabilities and a real database, without HTTP. It uses an
 * in-memory transport and the SDK's real MCP client. Only the edges are stubbed: the pages the App
 * reads (`named` by id, the rest `page`), the live schema of the Tasks database and the Notion the
 * system writes to.
 */
export async function buildAppMcpHarness(
  page: Page,
  named: ReadonlyMap<string, Page> = new Map(),
): Promise<AppMcpHarness> {
  const notion = new WritingNotion(INTEGRATION_BOT);
  const pages: Pick<PageReader, 'page'> = {
    page: (id) => Promise.resolve(named.get(id) ?? page),
  };
  const schema: Pick<LiveSchema, 'typesOf'> = { typesOf: () => Promise.resolve(TASK_TYPES) };
  const identity: Pick<BotIdentity, 'require'> = {
    require: () => Promise.resolve(INTEGRATION_BOT),
  };
  const clients: Client[] = [];
  const quietHoursOff: QuietHoursConfig = { enabled: false, startMinute: 0, endMinute: 0 };

  const moduleRef = await Test.createTestingModule({
    imports: [
      testConfig(
        databaseConfig,
        appConfig,
        assistantConfig,
        budgetConfig,
        runsConfig,
        outboxConfig,
      ),
    ],
    providers: [
      { provide: quietHoursConfig.KEY, useValue: quietHoursOff },
      PrismaService,
      CaptureService,
      { provide: LiveSchema, useValue: schema },
      AttentionService,
      SystemDiscussionRepository,
      NotionWriter,
      { provide: NotionClient, useValue: notion },
      { provide: BotIdentity, useValue: identity },
      ScheduledCheckRepository,
      ContinuationsService,
      OutboxRepository,
      QuietHours,
      ChannelRegistry,
      { provide: NOTIFICATION_CHANNELS, useValue: [] },
      DeliveryService,
      PendingActionRepository,
      ApprovalsService,
      NOTICE_PROVIDER,
      PreconditionEvaluator,
      { provide: PageReader, useValue: pages },
      SemanticAdapter,
      SchemaMappingReader,
      bindingProvider(),
      MemoryService,
      { provide: MEMORY_GBRAIN, useValue: new FakeGbrain() },
      RunWrites,
      RunSessions,
      AppMcp,
    ],
  }).compile();

  await moduleRef.init();

  const sessions = moduleRef.get(RunSessions);
  const mcp = moduleRef.get(AppMcp);

  return {
    moduleRef,
    prisma: moduleRef.get(PrismaService),
    sessions,
    notion,
    connected: async (given = grant()) => {
      const session = sessions.open(given);
      const resolved = sessions.resolve(session.bearer);

      if (!resolved) {
        throw new Error('a fresh session does not resolve');
      }

      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'integration', version: '1.0.0' });

      await mcp.serverFor(resolved).connect(serverSide);
      await client.connect(clientSide);
      clients.push(client);

      return { session, client };
    },
    disconnect: async () => {
      await Promise.all(clients.splice(0).map((client) => client.close()));
    },
    close: () => moduleRef.close(),
  };
}
