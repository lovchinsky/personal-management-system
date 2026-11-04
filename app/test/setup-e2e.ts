import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@notionhq/client';
import { stringify } from 'yaml';
import { VALID_BINDING_FILE } from './fixtures/notion-mapping.fixture';
import { useTestDatabase } from './test-database';

/**
 * The minimal environment that AppModule requires at bootstrap.
 *
 * The binding is one of its parts: the App reads it at startup, so without it not even the health
 * check comes up. The file is written from the same typed fixture as in the unit tests, so there is
 * no second copy of the shape.
 */
function writeBindingFile(): string {
  const path = join(
    mkdtempSync(join(tmpdir(), 'personal-management-system-e2e-')),
    'notion-mapping.yaml',
  );

  writeFileSync(path, stringify(VALID_BINDING_FILE), 'utf8');

  return path;
}

// Postgres is a hard dependency of the App: without it not even health comes up. The database is
// the same one as in the integration lane, and likewise only that one.
useTestDatabase();

process.env.NODE_ENV ??= 'test';
process.env.NOTION_MAPPING_FILE ??= writeBindingFile();
process.env.NOTION_API_TOKEN ??= 'e2e-token';
process.env.NOTION_API_VERSION ??= Client.defaultNotionVersion;
process.env.NOTION_WEBHOOK_SECRET ??= 'e2e-webhook-secret';
process.env.TELEGRAM_BOT_TOKEN ??= 'e2e:bot-token';
process.env.TELEGRAM_ALLOWED_CHAT_ID ??= '1';
process.env.TELEGRAM_WEBHOOK_SECRET ??= 'e2e-telegram-secret';
process.env.APP_ENCRYPTION_KEY ??= 'a'.repeat(64);
// The lane needs no background loops. It checks the HTTP perimeter, and a delivery worker that
// picked up what the test wrote would send it to the real Bot API.
process.env.WORKERS_ENABLED ??= 'false';
// The authorization server for the chat is enabled by the endpoint address and the owner
// passphrase together (`docs/2-system.md` § “Authentication boundary”). The address is loopback,
// so http is allowed for it; the passphrase has the length the environment check requires.
process.env.APP_MCP_URL ??= 'http://localhost:3000/mcp';
process.env.APP_OAUTH_OWNER_PASSPHRASE ??= 'e2e-owner-passphrase-0123456789abcdef';
