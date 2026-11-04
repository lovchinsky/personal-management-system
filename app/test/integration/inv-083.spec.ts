import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { canonical } from '../contract/contracts';
import { APP, appSources } from '../contract/sources';
import { connectToTestDatabase } from './database';

/**
 * `INV-083` A JSON column in `app_db` is only a document: a value whose shape the App does not
 * define, or a nested structure that its single reader consumes whole. A set of same-type records
 * that the App or its metrics count, filter or join consists of table rows. The documents are
 * listed in `contracts/canonical.yaml`, key `json_documents`.
 *
 * JSON columns are read from the database that the migrations have been applied to, not from the
 * schema, so the check also sees a column that a migration added outside the schema. Whether a
 * column from the list really is a document is decided by whoever put it there. The check makes
 * that decision explicit and visible in the diff instead of making it for them.
 */
interface ColumnRow {
  readonly name: string;
}

/**
 * Lookups inside JSON: Postgres path and containment operators over the column, and Prisma's JSON
 * filters. With them the App would filter or join on a document's content, and that is already a
 * case for table rows.
 */
const JSON_LOOKUPS: readonly RegExp[] = [
  /"[a-z_]+"\s*(?:->>?|#>>?|@>|<@)/,
  /"[a-z_]+"\s*\?[|&]?\s*'/,
  /\b(?:array_contains|array_starts_with|array_ends_with|string_contains|string_starts_with|string_ends_with)\b/,
];

describe('INV-083', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
  });

  afterAll(async () => {
    await close();
  });

  it('every JSON column is a document from the list, and every document in the list exists', async () => {
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name || '.' || column_name AS name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND udt_name IN ('json', 'jsonb', '_json', '_jsonb')
    `;

    expect(rows.map((row) => row.name).sort()).toEqual(
      Object.keys(canonical.jsonDocuments()).sort(),
    );
  });

  /**
   * A document is read only whole: App code that ships in the image does not filter or join on
   * the content of a JSON column. Migrations (data transfer) and specs are not bound by this rule.
   */
  it('App code does not look inside JSON columns', () => {
    const lookups = appSources().flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          JSON_LOOKUPS.some((lookup) => lookup.test(line))
            ? [`${relative(APP, file)}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );

    expect(lookups).toEqual([]);
  });
});
