/**
 * The App-triggered Notion MCP grant, managed manually by the operator (RUNBOOK §6.3):
 *
 *   node dist/src/credentials/notion-mcp/authorize-notion-mcp.js             authorize
 *   node dist/src/credentials/notion-mcp/authorize-notion-mcp.js --status    status without secrets
 *   node dist/src/credentials/notion-mcp/authorize-notion-mcp.js --refresh   refresh immediately
 *
 * No mode prints tokens, only the times from which the provider measures its limits.
 */
import { createInterface } from 'node:readline/promises';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../../platform/db/prisma.module';
import { messageOf } from '../../platform/error/message-of';
import { GrantStatus, NotionMcpGrant } from './notion-mcp.grant';
import { NotionMcpModule } from './notion-mcp.module';
import { NotionMcpOAuth } from './notion-mcp.oauth';

const MODES = ['--status', '--refresh'] as const;

type Mode = (typeof MODES)[number] | 'authorize';

/**
 * Only the grant, without the keepalive: the command is not a second App instance and needs no
 * background loop.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    PrismaModule,
    NotionMcpModule,
  ],
})
class NotionMcpCommandModule {}

function modeOf(args: readonly string[]): Mode {
  if (args.length === 0) return 'authorize';

  const [flag] = args;
  const mode = MODES.find((known) => known === flag);

  if (args.length > 1 || !mode) {
    throw new Error(`usage: authorize-notion-mcp [${MODES.join(' | ')}]`);
  }

  return mode;
}

function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function report(status: GrantStatus | null): void {
  if (!status) {
    print('Notion MCP is not authorized.');

    return;
  }

  print(`authorized at       ${status.obtainedAt.toISOString()}`);
  print(`last refreshed at   ${status.refreshedAt.toISOString()}`);
  print(`access token until  ${status.accessTokenExpiresAt.toISOString()}`);
  print(`alive until         ${status.inactiveAfter.toISOString()}  (unless refreshed)`);
  print(`ceiling at          ${status.ceilingAt.toISOString()}  (authorize again before)`);
}

/**
 * Authorizes without a listener on the callback address: the browser returns to
 * `NOTION_MCP_REDIRECT_URI`, which nobody listens on, and the person pastes that address here.
 * This way the command works the same on a local machine and on a server.
 */
async function authorize(grant: NotionMcpGrant, oauth: NotionMcpOAuth): Promise<void> {
  const pending = await oauth.begin();

  print('Open this URL in a browser signed in to Notion and approve the connection:');
  print();
  print(`  ${pending.authorizationUrl.toString()}`);
  print();
  print('The browser then lands on the callback address and fails to load it — that is expected.');

  const prompt = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const callbackUrl = await prompt.question('Paste that full address here: ');

    report(await grant.authorize(await pending.finish(callbackUrl)));
  } finally {
    prompt.close();
  }
}

async function main(args: readonly string[]): Promise<void> {
  const mode = modeOf(args);
  const context = await NestFactory.createApplicationContext(NotionMcpCommandModule, {
    logger: ['error', 'warn'],
  });

  try {
    const grant = context.get(NotionMcpGrant);

    switch (mode) {
      case 'authorize':
        await authorize(grant, context.get(NotionMcpOAuth));
        return;

      case '--status':
        report(await grant.status());
        return;

      case '--refresh':
        report(await grant.refresh());
        return;
    }
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`authorize-notion-mcp: ${messageOf(error)}\n`);
    process.exitCode = 1;
  });
}
