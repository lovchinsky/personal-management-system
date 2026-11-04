import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { databaseConfig, type DatabaseConfig } from './database.config';

/**
 * The single connection to `app_db`.
 *
 * The connection is established at startup, not on the first query, because Postgres is a hard
 * dependency of the App. An application that started without it would do nothing: it could
 * neither accept a webhook nor wake up on schedule. Crashing here is more honest than a health
 * check that turns red a minute later.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(databaseConfig.KEY) database: DatabaseConfig) {
    super({ adapter: new PrismaPg({ connectionString: database.url }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
