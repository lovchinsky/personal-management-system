import { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { repoFile } from '../contract/contracts';
import { connectToTestDatabase } from './database';

interface ColumnRow {
  readonly name: string;
}

/**
 * Reads the tables described in `docs/2-system.md` § “Persistence”. Each is a heading
 * `#### \`table\`` and a block with one column per line.
 */
function documentedTables(): Map<string, string[]> {
  const doc = repoFile('docs/2-system.md');
  const start = doc.indexOf('\n## Persistence');
  const end = doc.indexOf('\n## ', start + 1);
  const section = doc.slice(start, end === -1 ? undefined : end);
  const tables = new Map<string, string[]>();

  for (const [, table, block] of section.matchAll(/#### `([a-z_]+)`\n\n```text\n([\s\S]*?)```/g)) {
    const columns = block
      .split('\n')
      .filter((line) => /^[a-z_]/.test(line))
      .map((line) => line.split(/\s+/)[0].replace(/\?$/, ''));

    tables.set(table, columns);
  }

  return tables;
}

/**
 * A table described in `docs/2-system.md` § “Persistence” has in the database exactly the columns
 * the description names. If a migration adds or removes a column and the description is left
 * unchanged, the description lies. The columns are read from the database the migrations were
 * applied to, not from the schema.
 */
describe('the persistence description and the database', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
  });

  afterAll(async () => {
    await close();
  });

  const tables = [...documentedTables().entries()];

  it('the description names tables', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables)(
    '%s: the described columns are the columns of the database',
    async (table, documented) => {
      const rows = await prisma.$queryRaw<ColumnRow[]>(Prisma.sql`
      SELECT column_name AS name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${table}
    `);

      expect(rows.map((row) => row.name).sort()).toEqual([...documented].sort());
    },
  );
});
