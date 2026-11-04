import { Test } from '@nestjs/testing';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { testConfig } from '../fixtures/test-module';
import { TEST_DATABASE_NAME } from '../test-database';

/**
 * Connects a live `PrismaService` to an ephemeral database.
 *
 * The module is brought up by the real DI container, not by calling the constructor directly,
 * because a test must break the way the application does. Otherwise it checks something other than
 * what runs at runtime.
 */
export async function connectToTestDatabase(): Promise<{
  prisma: PrismaService;
  close: () => Promise<void>;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [testConfig(databaseConfig)],
    providers: [PrismaService],
  }).compile();

  await moduleRef.init();

  const prisma = moduleRef.get(PrismaService);

  return { prisma, close: () => moduleRef.close() };
}

interface TableRow {
  readonly tablename: string;
}

interface DatabaseRow {
  readonly name: string;
}

/**
 * The list of tables is read from the database, not from a constant. Otherwise a new table in the
 * schema would stay uncleaned, and a test would fail on the state left by an earlier test.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  // This is a second line of defense, and not a redundant one, because the environment is checked
  // once per test run, while this query runs before every truncation. A mistake here costs the
  // main database's data.
  const [connected] = await prisma.$queryRaw<DatabaseRow[]>`SELECT current_database() AS name`;
  if (connected?.name !== TEST_DATABASE_NAME) {
    throw new Error(
      `refusing to truncate ${connected?.name ?? 'an unknown database'} — ` +
        `only ${TEST_DATABASE_NAME} may be cleared`,
    );
  }

  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    return;
  }

  const list = tables.map((table) => `"${table.tablename}"`).join(', ');

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
