import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { messageOf } from '../error/message-of';
import { PrismaService } from './prisma.service';

const KEY = 'app_db';

/**
 * A live check of the connection, not the fact that it exists.
 *
 * `$connect()` at startup says only that connecting succeeded once. A query inside the check says
 * that the connection is working. That is the question a health check puts to whoever decides
 * whether to send traffic.
 */
@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthIndicatorService,
  ) {}

  async check(): Promise<HealthIndicatorResult<typeof KEY>> {
    const session = this.health.check(KEY);

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      return session.down(messageOf(error));
    }

    return session.up();
  }
}
