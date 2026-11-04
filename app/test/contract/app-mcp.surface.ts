import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { addMinutes } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { AttentionService } from '../../src/attention/attention.service';
import { CaptureService } from '../../src/capture/capture.service';
import { appConfig, type AppConfig } from '../../src/config/app.config';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { RunWrites } from '../../src/effects/run-writes';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { AppMcp } from '../../src/mcp/server/app-mcp';
import { assistantConfig, type AssistantConfig } from '../../src/mcp/server/assistant.config';
import { ChatSessions } from '../../src/mcp/server/chat-sessions';
import { McpSession } from '../../src/mcp/server/mcp-session';
import { RunSessions } from '../../src/mcp/server/run-sessions';
import { MemoryService } from '../../src/memory/memory.service';
import { SchemaMappingReader } from '../../src/notion/semantics/schema-mapping.reader';
import { unreached } from '../fixtures/test-module';

/**
 * The port in the App MCP address that the session hands out. The surface's tools need no time
 * zone.
 */
const APP: AppConfig = {
  port: 3000,
  timeZone: 'Europe/Kyiv',
  language: 'uk',
  ownerGender: 'neutral',
};

/** An assistant without a name, as in an installation that has not set one. */
const ASSISTANT: AssistantConfig = { name: null, gender: 'neutral' };

/** What the server announces to the client: the tools and the capabilities from `initialize`. */
interface AppMcpSurface {
  readonly tools: readonly Tool[];
  readonly capabilities: Readonly<Record<string, unknown>>;
}

/**
 * Reads the App MCP surface of a session, which is what the session sees, with no database and no
 * network.
 *
 * The session is opened the same way as a real one. The capability services are empty here because
 * the server does not call them when it builds the list of tools. A call would mean that the list
 * depends on state, and then the check would have to find out about it.
 */
async function surfaceOf(open: (moduleRef: TestingModule) => McpSession): Promise<AppMcpSurface> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AppMcp,
      RunSessions,
      ChatSessions,
      RunWrites,
      unreached(CaptureService),
      unreached(AttentionService),
      unreached(ContinuationsService),
      unreached(DeliveryService),
      unreached(MemoryService),
      unreached(ApprovalsService),
      unreached(SchemaMappingReader),
      { provide: appConfig.KEY, useValue: APP },
      { provide: assistantConfig.KEY, useValue: ASSISTANT },
    ],
  }).compile();
  const session = open(moduleRef);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract', version: '1.0.0' });

  await moduleRef.get(AppMcp).serverFor(session).connect(serverSide);
  await client.connect(clientSide);

  try {
    const { tools } = await client.listTools();

    return { tools, capabilities: { ...client.getServerCapabilities() } };
  } finally {
    await client.close();
  }
}

/** Returns the App MCP surface that a run in `mode` sees. */
export function appMcpSurface(mode: WorkflowMode): Promise<AppMcpSurface> {
  return surfaceOf((moduleRef) => {
    const sessions = moduleRef.get(RunSessions);
    const { bearer } = sessions.open({
      runId: randomUUID(),
      mode,
      provenance: { origin: 'evaluation_window' },
      cause: randomUUID(),
      startedAt: new Date(),
      expiresAt: addMinutes(new Date(), 1),
      deadline: new AbortController().signal,
    });
    const session = sessions.resolve(bearer);

    if (!session) {
      throw new Error('a fresh session does not resolve');
    }

    return session;
  });
}

/** Returns the App MCP surface that the chat sees. */
export function chatMcpSurface(): Promise<AppMcpSurface> {
  return surfaceOf((moduleRef) => moduleRef.get(ChatSessions).open());
}

/** Collects every tool that the App MCP shows to at least one mode or to the chat. */
export async function everyAppMcpTool(): Promise<Tool[]> {
  const byName = new Map<string, Tool>();

  for (const mode of Object.values(WorkflowMode)) {
    for (const tool of (await appMcpSurface(mode)).tools) byName.set(tool.name, tool);
  }

  for (const tool of (await chatMcpSurface()).tools) byName.set(tool.name, tool);

  return [...byName.values()];
}
