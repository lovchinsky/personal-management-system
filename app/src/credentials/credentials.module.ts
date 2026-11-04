import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { gbrainConfig } from './gbrain/gbrain.config';
import { GbrainToken } from './gbrain/gbrain.token';
import { notionMcpConfig } from './notion-mcp/notion-mcp.config';
import { NotionMcpKeepalive } from './notion-mcp/notion-mcp.keepalive';
import { NotionMcpModule } from './notion-mcp/notion-mcp.module';

/**
 * The credentials of a run's connectors: the Notion MCP grant and the GBrain token.
 *
 * The module exposes only what a run gets its bearer from.
 *
 * The keepalive lives here, not behind the runner's switch, because the grant must stay alive even
 * when there are no runs (ADR 0013).
 */
@Module({
  imports: [
    NotionMcpModule,
    ConfigModule.forFeature(gbrainConfig),
    ConfigModule.forFeature(notionMcpConfig),
  ],
  providers: [NotionMcpKeepalive, GbrainToken],
  exports: [NotionMcpModule, GbrainToken],
})
export class CredentialsModule {}
