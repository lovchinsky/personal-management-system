import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';
import { isMissingTable } from './prisma-errors';
import { PrismaService } from './prisma.service';

const appliedRows = z.array(z.object({ migration_name: z.string() }));

/**
 * The image and the database must refer to the same schema, and the question is asked at startup.
 *
 * Migrations are applied by the image's launch command before the App starts. An application
 * launched with another command applies no migrations, and without this check the consequence
 * would be silent: `$connect()` would pass, `SELECT 1` too, `/health` would say `up`, Caddy would
 * send traffic, webhooks would be accepted — and the first write to a column that does not exist
 * would fail after the receipt has been created. The application would report itself healthy
 * while being structurally unable to work.

 *
 * The question is asked in one direction. A migration applied in the database but absent from the
 * image means an image rollback, not a database that is behind: older code with a newer schema
 * usually works, and stopping it would get in the way precisely when people roll back because of
 * a broken deploy.
 */
@Injectable()
export class SchemaVersion implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchemaVersion.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const shipped = this.shipped();
    const applied = await this.applied();
    const missing = shipped.filter((name) => !applied.has(name));

    if (missing.length > 0) {
      throw new Error(
        `database is behind the image: ${missing.join(', ')} not applied — ` +
          'run `npx prisma migrate deploy` or start the image with its own command, which applies them',
      );
    }

    this.logger.log(`schema matches the image: ${shipped.length} migrations applied`);
  }

  /**
   * Lists the migrations that the image itself contains.
   *
   * The directory is read, not a list baked in at build time: the directory is what
   * `migrate deploy` applies, so another source could diverge from it — and would, precisely when
   * a migration is added and someone forgets to update the list.
   */
  private shipped(): readonly string[] {
    return readdirSync(join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * Returns only the migrations that finished and were not rolled back: a half-applied migration
   * does not count.
   */
  private async applied(): Promise<ReadonlySet<string>> {
    try {
      const rows: unknown = await this.prisma.$queryRaw`
        SELECT "migration_name" FROM "_prisma_migrations"
         WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
      `;

      return new Set(appliedRows.parse(rows).map((row) => row.migration_name));
    } catch (error) {
      // A database where nothing has been applied has no migration journal. This is not a
      // different case but the extreme one: zero applied. Let it end in the same error as when
      // the database is behind: otherwise the most common operator mistake would be explained by
      // a Postgres code instead of by what to do about it.
      if (!isMissingTable(error)) throw error;

      return new Set();
    }
  }
}
