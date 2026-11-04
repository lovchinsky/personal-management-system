import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConnectorCredentialRepository } from '../connector-credential.repository';
import { credentialsConfig } from '../credentials.config';
import { SecretBox } from '../secret-box';
import { notionMcpConfig } from './notion-mcp.config';
import { NotionMcpGrant } from './notion-mcp.grant';
import { NotionMcpOAuth } from './notion-mcp.oauth';

/**
 * The Notion MCP grant: authorization, refresh under the lock, status.
 *
 * Only the grant service is exposed. The store and the encryption stay inside: only the service
 * refreshes the grant, and a path to the row that bypasses it would mean a second refresher. The
 * keepalive is not part of this module. `CredentialsModule` adds it, and the authorization
 * command takes the grant without a background loop.
 */
@Module({
  imports: [ConfigModule.forFeature(credentialsConfig), ConfigModule.forFeature(notionMcpConfig)],
  providers: [SecretBox, ConnectorCredentialRepository, NotionMcpOAuth, NotionMcpGrant],
  exports: [NotionMcpGrant],
})
export class NotionMcpModule {}
