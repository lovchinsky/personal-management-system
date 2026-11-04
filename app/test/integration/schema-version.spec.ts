import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../src/platform/db/prisma.module';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { testConfig } from '../fixtures/test-module';
import { connectToTestDatabase } from './database';

interface LedgerRow {
  readonly migration_name: string;
  readonly finished_at: Date | null;
}

/** The application does not start on a database that is behind the image (`SchemaVersion`). */
describe('schema check against the image', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
  });

  afterAll(async () => {
    await close();
  });

  /**
   * Starts the module and closes it. Nest does not clean up after a failed `init()`: `close()`
   * after it answers with the same error without calling `onModuleDestroy` — so the test itself
   * closes the database connection, instead of the pool, which would hold the process open.
   */
  const boot = async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [testConfig(), PrismaModule],
    }).compile();

    try {
      await moduleRef.init();
      await moduleRef.close();
    } finally {
      await moduleRef.get(PrismaService).$disconnect();
    }
  };

  it('starts on a migrated database', async () => {
    await expect(boot()).resolves.toBeUndefined();
  });

  /**
   * A half-applied migration does not count as applied: a `migrate deploy` that fell over
   * midway leaves a row without `finished_at`, and that is the state it is worst to mistake for
   * a working one.
   */
  it('a migration that did not finish stops the startup', async () => {
    const [newest] = await prisma.$queryRaw<LedgerRow[]>`
      SELECT "migration_name", "finished_at" FROM "_prisma_migrations"
       ORDER BY "migration_name" DESC LIMIT 1
    `;

    expect(newest).toBeDefined();

    await prisma.$executeRaw`
      UPDATE "_prisma_migrations" SET "finished_at" = NULL
       WHERE "migration_name" = ${newest.migration_name}
    `;

    try {
      await expect(boot()).rejects.toThrow(
        new RegExp(`database is behind the image: ${newest.migration_name}`),
      );
    } finally {
      await prisma.$executeRaw`
        UPDATE "_prisma_migrations" SET "finished_at" = ${newest.finished_at}
         WHERE "migration_name" = ${newest.migration_name}
      `;
    }

    await expect(boot()).resolves.toBeUndefined();
  });
});
