import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { optionalPort } from '../../platform/di/optional-port';
import {
  AbsentClientNotice,
  CLIENT_NOTICE,
  CLIENT_NOTICE_ADAPTER,
  type ClientNotice,
} from './client-notice';
import { OauthClientsRepository } from './oauth-clients.repository';
import { OauthEnabledGuard } from './oauth-enabled.guard';
import { OauthServer } from './oauth-server';
import { OauthTokensRepository } from './oauth-tokens.repository';
import { oauthConfig } from './oauth.config';
import { OauthController } from './oauth.controller';

/**
 * The App's authorization server for chat (ADR 0021). Only the server is exported: `/mcp` uses it
 * to check the access token, and pruning uses it to clear what has gone stale.
 */
@Module({
  imports: [ConfigModule.forFeature(oauthConfig)],
  controllers: [OauthController],
  providers: [
    OauthServer,
    OauthClientsRepository,
    OauthTokensRepository,
    OauthEnabledGuard,
    optionalPort<ClientNotice>(
      CLIENT_NOTICE,
      CLIENT_NOTICE_ADAPTER,
      () => new AbsentClientNotice(),
    ),
  ],
  exports: [OauthServer],
})
export class McpOauthModule {}
