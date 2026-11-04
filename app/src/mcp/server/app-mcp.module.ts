import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApprovalsModule } from '../../approvals/approvals.module';
import { ContinuationsModule } from '../../continuations/continuations.module';
import { DeliveryModule } from '../../delivery/delivery.module';
import { EffectsModule } from '../../effects/effects.module';
import { NotionSemanticsModule } from '../../notion/semantics/semantics.module';
import { RUN_EFFECTS_ADAPTER } from '../../runs/run-effects';
import { McpOauthModule } from '../oauth/oauth.module';
import { AppMcp } from './app-mcp';
import { AppMcpController } from './app-mcp.controller';
import { assistantConfig } from './assistant.config';
import { ChatSessions } from './chat-sessions';
import { RunSessions } from './run-sessions';

/**
 * The App MCP module, which provides the endpoint, the run sessions and the table of tools over
 * the capability services.
 *
 * The module is global because it plugs itself into the effects port of `runs/`: the dispatcher
 * does not know about the App MCP, and the dependency runs from the adapter to the port. It uses
 * capabilities only through their services (`INV-080`) and never launches Claude (`INV-029`).
 */
@Global()
@Module({
  imports: [
    ContinuationsModule,
    DeliveryModule,
    ApprovalsModule,
    EffectsModule,
    NotionSemanticsModule,
    McpOauthModule,
    ConfigModule.forFeature(assistantConfig),
  ],
  controllers: [AppMcpController],
  providers: [
    RunSessions,
    ChatSessions,
    AppMcp,
    { provide: RUN_EFFECTS_ADAPTER, useExisting: RunSessions },
  ],
  exports: [RUN_EFFECTS_ADAPTER],
})
export class AppMcpModule {}
