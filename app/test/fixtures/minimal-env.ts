import { Client } from '@notionhq/client';

/** The minimal environment the App starts with. */
export const MINIMAL_ENV: Readonly<Record<string, string>> = {
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  NOTION_MAPPING_FILE: '/etc/app/notion-mapping.yaml',
  NOTION_API_TOKEN: 'token',
  NOTION_API_VERSION: Client.defaultNotionVersion,
  NOTION_WEBHOOK_SECRET: 'secret',
  APP_ENCRYPTION_KEY: 'a'.repeat(64),
};
