import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { runnerConfig, type RunnerConfig } from '../claude/runner/runner.config';
import { CredentialsModule } from '../credentials/credentials.module';
import { GbrainToken } from '../credentials/gbrain/gbrain.token';
import { NotionClientModule } from '../notion/client/client.module';
import { NotionSemanticsModule } from '../notion/semantics/semantics.module';
import { GbrainClient } from './gbrain-client';
import { MEMORY_GBRAIN, MemoryService } from './memory.service';

/**
 * The memory entries the system makes on its own behalf (`docs/2-system.md` § “Writes to
 * GBrain”): an anchor by convention and an entry on it. GBrain is reached by the same App client
 * the runs use, at the same address.
 */
@Module({
  imports: [
    NotionClientModule,
    NotionSemanticsModule,
    CredentialsModule,
    ConfigModule.forFeature(runnerConfig),
  ],
  providers: [
    MemoryService,
    {
      provide: MEMORY_GBRAIN,
      inject: [GbrainToken, runnerConfig.KEY],
      useFactory: (token: GbrainToken, config: RunnerConfig): GbrainClient =>
        GbrainClient.of(token, config),
    },
  ],
  exports: [MemoryService],
})
export class MemoryModule {}
