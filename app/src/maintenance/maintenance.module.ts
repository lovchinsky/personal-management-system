import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttentionModule } from '../attention/attention.module';
import { IntakeReceiptsModule } from '../intake/receipts/receipts.module';
import { McpOauthModule } from '../mcp/oauth/oauth.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { maintenanceConfig } from './maintenance.config';
import { MaintenanceWorker } from './maintenance.worker';

/**
 * Pruning across the modules. It prunes each table through its owner's own services and run
 * sources, so it belongs to none of the modules.
 */
@Module({
  imports: [
    ConfigModule.forFeature(maintenanceConfig),
    IntakeReceiptsModule,
    SchedulingModule,
    AttentionModule,
    McpOauthModule,
  ],
  providers: [MaintenanceWorker],
})
export class MaintenanceModule {}
