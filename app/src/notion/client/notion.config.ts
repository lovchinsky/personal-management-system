import { registerAs, type ConfigType } from '@nestjs/config';
import { required } from '../../platform/config/env-value';

/**
 * The Notion REST credential belongs to the installation, not to the code, as does the binding.
 * The environment check compares the version with the value the SDK is built for.
 */
export const notionConfig = registerAs('notion', () => ({
  apiToken: required(process.env.NOTION_API_TOKEN, 'NOTION_API_TOKEN'),
  apiVersion: required(process.env.NOTION_API_VERSION, 'NOTION_API_VERSION'),
}));

export type NotionConfig = ConfigType<typeof notionConfig>;
