import { registerAs } from '@nestjs/config';
import { optional } from '../../platform/config/env-value';

/** The personal Notion token, used only by `notion build`. */
export const workspaceConfig = registerAs('workspace', () => ({
  personalToken: optional(process.env.NOTION_PERSONAL_TOKEN),
}));
