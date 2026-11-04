import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../../platform/config/env-value';

/**
 * The hosted Notion MCP, the redirect URI of its OAuth and the pace of the grant keepalive. The
 * addresses are needed only with the runner enabled and by the authorization command, so the
 * config namespace leaves them optional and whoever uses them requires them.
 */
export const notionMcpConfig = registerAs('notionMcp', () => ({
  url: optional(process.env.NOTION_MCP_URL),
  redirectUri: optional(process.env.NOTION_MCP_REDIRECT_URI),
  /**
   * The client name the person sees on the Notion consent page and among the connections of their
   * workspace: it distinguishes the connection of one installation from that of another.
   */
  clientName: optional(process.env.NOTION_MCP_CLIENT_NAME) ?? 'Personal Management System',
  /**
   * The interval between keepalive ticks, six hours. The grant service decides “refresh or not”
   * using the time of the last refresh, so a more frequent tick refreshes nothing twice, and a
   * less frequent one only takes longer to notice a dead grant.
   */
  keepaliveIntervalHours: 6,
  /** The delay before the first keepalive tick after startup. */
  keepaliveFirstDelayMinutes: 1,
}));

export type NotionMcpConfig = ConfigType<typeof notionMcpConfig>;
