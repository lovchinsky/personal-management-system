import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { minutesToMilliseconds } from 'date-fns';
import { ApprovalsModule } from './approvals/approvals.module';
import { ClaudeModule } from './claude/claude.module';
import { appConfig } from './config/app.config';
import { validate } from './config/env.validation';
import {
  DEFAULT_THROTTLE,
  throttleConfig,
  WEBHOOK_THROTTLE,
  type ThrottleConfig,
} from './config/throttle.config';
import { ContinuationsModule } from './continuations/continuations.module';
import { CredentialsModule } from './credentials/credentials.module';
import { DeliveryNoticesModule } from './delivery/delivery-notices.module';
import { DeliveryModule } from './delivery/delivery.module';
import { ChannelIntakeModule } from './intake/channel/channel-intake.module';
import { NotionIntakeModule } from './intake/notion/notion-intake.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { AppMcpModule } from './mcp/server/app-mcp.module';
import { NotionModule } from './notion/notion.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './platform/db/prisma.module';
import { workersConfig } from './platform/worker/workers.config';
import { RunsModule } from './runs/runs.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { SweepsModule } from './sweeps/sweeps.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate,
      load: [appConfig, throttleConfig, workersConfig],
    }),
    ThrottlerModule.forRootAsync({
      inject: [throttleConfig.KEY],
      useFactory: (throttle: ThrottleConfig): ThrottlerModuleOptions => [
        { name: DEFAULT_THROTTLE, ttl: minutesToMilliseconds(1), limit: throttle.defaultPerMinute },
        {
          name: WEBHOOK_THROTTLE,
          ttl: minutesToMilliseconds(1),
          limit: throttle.webhooksPerMinute,
        },
      ],
    }),
    PrismaModule,
    RunsModule,
    ContinuationsModule,
    ApprovalsModule,
    CredentialsModule,
    DeliveryModule,
    DeliveryNoticesModule,
    NotionModule,
    NotionIntakeModule,
    ChannelIntakeModule,
    MaintenanceModule,
    SchedulingModule,
    SweepsModule,
    ObservabilityModule,
    AppMcpModule,
    ClaudeModule,
  ],
  providers: [
    /**
     * One guard for the whole application: each route is counted in every throttler profile it
     * does not skip (`docs/2-system.md` § “App — inbound perimeter”). A guard also attached to a
     * controller would count the same key a second time, and the webhook limit would be halved.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
