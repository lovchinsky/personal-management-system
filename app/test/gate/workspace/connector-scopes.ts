import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { runnerConfig, type RunnerConfig } from '../../../src/claude/runner/runner.config';
import { gbrainConfig, type GbrainConfig } from '../../../src/credentials/gbrain/gbrain.config';
import { GbrainToken } from '../../../src/credentials/gbrain/gbrain.token';
import { NotionMcpGrant } from '../../../src/credentials/notion-mcp/notion-mcp.grant';
import { NotionMcpModule } from '../../../src/credentials/notion-mcp/notion-mcp.module';
import { PrismaModule } from '../../../src/platform/db/prisma.module';

/** The GBrain source of the gate environment (`infra/GATE.md` § “Gate environment”). */
export const GATE_GBRAIN_SOURCE = 'gate';

/**
 * The connector credentials and nothing more: the check needs neither the application nor its
 * workers, nor the grant keepalive.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    ConfigModule.forFeature(gbrainConfig),
    ConfigModule.forFeature(runnerConfig),
    PrismaModule,
    NotionMcpModule,
  ],
  providers: [GbrainToken],
})
class ScopesModule {}

/** What the gate's connector credentials are issued for; `null` means there are none. */
export interface ConnectorScopes {
  /** The workspace of the Notion MCP grant. */
  readonly notion: { readonly id: string; readonly name: string } | null;
  /** Where the GBrain client writes and what it reads. */
  readonly gbrain: { readonly source: string; readonly reads: readonly string[] } | null;
}

const resultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

const notionSelfSchema = z.object({
  workspace: z.object({ id: z.string(), name: z.string().nullish() }),
});

const gbrainSelfSchema = z.object({ source_id: z.string(), federated_read: z.array(z.string()) });

/**
 * Collects what the servers themselves say about the credentials: the Notion MCP reports whose
 * workspace the grant is on; GBrain reports where the client writes and what it reads. The person
 * chooses the grant's workspace on the consent page, and the registration command sets the
 * client's sources; nothing else enforces them, so the gate asks the servers instead of trusting
 * the settings.
 */
export async function connectorScopes(): Promise<ConnectorScopes> {
  const context = await NestFactory.createApplicationContext(ScopesModule, { logger: false });

  try {
    const grant = context.get(NotionMcpGrant);
    const gbrain = context.get<GbrainConfig>(gbrainConfig.KEY);
    const runner = context.get<RunnerConfig>(runnerConfig.KEY);

    return {
      notion:
        (await grant.status()) === null
          ? null
          : notionWorkspaceOf(
              await toolText(grant.serverUrl(), await grant.accessToken(60_000), 'notion-get-self'),
            ),
      gbrain:
        !gbrain.clientId || !gbrain.clientSecret || !runner.gbrainMcpUrl
          ? null
          : gbrainScopeOf(
              await toolText(
                runner.gbrainMcpUrl,
                await context.get(GbrainToken).accessToken(60_000),
                'whoami',
              ),
            ),
    };
  } finally {
    await context.close();
  }
}

function notionWorkspaceOf(text: string): ConnectorScopes['notion'] {
  const { workspace } = notionSelfSchema.parse(JSON.parse(text));

  return { id: workspace.id, name: workspace.name ?? 'unnamed' };
}

function gbrainScopeOf(text: string): ConnectorScopes['gbrain'] {
  const self = gbrainSelfSchema.parse(JSON.parse(text));

  return { source: self.source_id, reads: self.federated_read };
}

async function toolText(url: string, bearer: string, tool: string): Promise<string> {
  const client = new Client({ name: 'personal-management-system-gate', version: '1.0.0' });

  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    }),
  );

  try {
    const result = resultSchema.parse(await client.callTool({ name: tool, arguments: {} }));

    return result.content.map((part) => part.text ?? '').join('');
  } finally {
    await client.close();
  }
}

/**
 * Lists the ways in which the connector credentials are not the gate's, one line per reason, with
 * advice. The Notion MCP grant must be on the gate workspace, and the GBrain client must write to
 * the gate source and read only it: otherwise the gate runs work in the main workspace or source.
 */
export function scopeProblems(scopes: ConnectorScopes, gateWorkspace: string): string[] {
  const problems: string[] = [];
  const authorize =
    'run bin/gate notion-mcp and choose the gate workspace on the Notion consent page';
  const register = `register it with --source ${GATE_GBRAIN_SOURCE} --federated-read ${GATE_GBRAIN_SOURCE}`;

  if (scopes.notion === null) {
    problems.push(`the gate has no Notion MCP grant: ${authorize}`);
  } else if (scopes.notion.id !== gateWorkspace) {
    problems.push(
      `the gate's Notion MCP grant belongs to workspace ${scopes.notion.name} (${scopes.notion.id}), ` +
        `not to the gate's (${gateWorkspace}): ${authorize}`,
    );
  }

  if (scopes.gbrain === null) {
    problems.push(`the gate has no GBrain client: ${register}`);
  } else if (
    scopes.gbrain.source !== GATE_GBRAIN_SOURCE ||
    scopes.gbrain.reads.length !== 1 ||
    scopes.gbrain.reads[0] !== GATE_GBRAIN_SOURCE
  ) {
    problems.push(
      `the gate's GBrain client writes to ${scopes.gbrain.source} and reads ` +
        `${scopes.gbrain.reads.join(', ') || 'nothing'}, not only the ${GATE_GBRAIN_SOURCE} source: ${register}`,
    );
  }

  return problems;
}
