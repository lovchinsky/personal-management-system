import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { databaseConfig } from './database.config';
import { PrismaHealthIndicator } from './prisma.health';
import { PrismaService } from './prisma.service';
import { SchemaVersion } from './schema-version';

/**
 * The module is `@Global` because `app_db` is one boundary for the whole application: every
 * runtime module writes to it, and listing the import in each of them would mean repeating the
 * same statement ten times.
 */
@Global()
@Module({
  imports: [TerminusModule, ConfigModule.forFeature(databaseConfig)],
  providers: [PrismaService, PrismaHealthIndicator, SchemaVersion],
  exports: [PrismaService, PrismaHealthIndicator],
})
export class PrismaModule {}
