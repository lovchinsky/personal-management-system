import { PrismaService } from '../../src/platform/db/prisma.service';
import { canonical } from '../contract/contracts';
import { connectToTestDatabase } from './database';

/**
 * The shape of the database is checked **against the database**, not against the text it was
 * built from.
 *
 * A grep over the migration SQL would stay green against a database with no index at all. All it
 * takes is for the migration not to be applied, or for a later one to cancel it. A grep over
 * `schema.prisma` would look in the wrong place entirely: the project's convention is that
 * migrations contain what the schema lacks.
 */
interface IndexRow {
  readonly indexname: string;
  readonly indexdef: string;
}

interface NameRow {
  readonly name: string;
}

/**
 * The names come from `docs/2-system.md` § “Implementation inventory”, together with the
 * partial indexes the queue selection relies on. Prisma cannot express partial indexes, so
 * they are added by hand in the migrations, and nothing but this check would notice their
 * absence. The unique constraints of the schema (`@unique`, `@@unique`) have names that Prisma
 * assigns. `unique` distinguishes what an index promises: some enforce an invariant, others
 * serve only speed, and requiring `UNIQUE` of the latter would mean requiring a promise they
 * never made.
 */
interface RequiredIndex {
  readonly name: string;
  readonly unique: boolean;
  readonly fragments: readonly string[];
}

const REQUIRED: readonly RequiredIndex[] = [
  {
    name: 'scheduled_checks_one_active_wake_per_discussion',
    unique: true,
    fragments: ['discussion_id', 'IS NOT NULL', '<>', 'resolution_reconciliation'],
  },
  {
    name: 'scheduled_checks_one_active_closure_per_discussion',
    unique: true,
    fragments: ['discussion_id', 'IS NOT NULL', 'resolution_reconciliation'],
  },
  {
    name: 'scheduled_checks_one_active_per_page_reason',
    unique: true,
    fragments: ['notion_page_id', 'IS NULL'],
  },
  { name: 'evaluation_windows_one_open_per_page', unique: true, fragments: ['page_id'] },
  {
    name: 'pending_actions_one_open_per_fingerprint',
    unique: true,
    fragments: ['fingerprint', 'proposed', 'approved'],
  },
  { name: 'notification_outbox_idempotency_key_key', unique: true, fragments: ['idempotency_key'] },
  {
    name: 'webhook_receipts_source_external_id_key',
    unique: true,
    fragments: ['source', 'external_id'],
  },
  { name: 'run_traces_one_running_per_slot', unique: true, fragments: ['slot', 'running'] },
  // One review occurrence per period: keyed by the period, not by an instant (`INV-103`).
  {
    name: 'review_occurrences_mode_occurrence_key_key',
    unique: true,
    fragments: ['mode', 'occurrence_key'],
  },
  // Not unique, but equally handwritten and equally partial: `migrate dev` would drop them along
  // with the rest, and it would show up not as an error but as a slow queue that reads the whole
  // delivery history every fifteen seconds.
  {
    name: 'pending_actions_ready',
    unique: false,
    fragments: ['next_attempt_at', 'created_at', 'approved'],
  },
  { name: 'notification_outbox_pending', unique: false, fragments: ['created_at', 'pending'] },
  { name: 'evaluation_windows_open', unique: false, fragments: ['not_before', 'pending'] },
];

/** The list of forbidden tables is in `docs/2-system.md` § “Forbidden tables”. */
const FORBIDDEN = [
  'tasks',
  'projects',
  'cases',
  'knowledge',
  'entities',
  'embeddings',
  'discussion_summaries',
] as const;

describe('the shape of the database with migrations applied', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let indexes: Map<string, string>;

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());

    const rows = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
    `;

    indexes = new Map(rows.map((row) => [row.indexname, row.indexdef]));
  });

  afterAll(async () => {
    await close();
  });

  describe('required indexes', () => {
    it.each(REQUIRED)('$name exists in the database', ({ name, unique, fragments }) => {
      const definition = indexes.get(name);

      expect(definition).toBeDefined();
      expect(definition?.includes('UNIQUE INDEX')).toBe(unique);

      for (const fragment of fragments) {
        expect(definition).toContain(fragment);
      }
    });

    /** Non-terminal statuses are exactly those not in `terminal`, not ones “similar to them”. */
    it('the partial indexes of continuations are limited to exactly the non-terminal statuses', () => {
      const { statuses, terminal } = canonical.lifecycle('scheduled_check');
      const open = statuses.filter((status) => !terminal.includes(status));

      for (const name of [
        'scheduled_checks_one_active_wake_per_discussion',
        'scheduled_checks_one_active_closure_per_discussion',
        'scheduled_checks_one_active_per_page_reason',
      ]) {
        const definition = indexes.get(name) ?? '';

        for (const status of open) {
          expect(definition).toContain(`'${status}'`);
        }

        for (const status of terminal) {
          expect(definition).not.toContain(`'${status}'`);
        }
      }
    });
  });

  /** `INV-017`: `app_db` has no domain tables. */
  describe('INV-017', () => {
    let tables: readonly string[];

    beforeAll(async () => {
      const rows = await prisma.$queryRaw<NameRow[]>`
        SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'
      `;

      tables = rows.map((row) => row.name);
    });

    it('the database has tables, otherwise the check is empty', () => {
      expect(tables.length).toBeGreaterThan(0);
    });

    it.each(FORBIDDEN)('there is no %s table', (name) => {
      expect(tables).not.toContain(name);
    });

    /**
     * `INV-003`: current property values are always read from Notion. A cache of values would be
     * a domain table under a technical name, so what is checked is not only the list above but
     * also the absence of a column that would hold a Notion property value.
     */
    it('no column holds a Notion property value', async () => {
      const rows = await prisma.$queryRaw<NameRow[]>`
        SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name ILIKE '%property_value%'
      `;

      expect(rows).toEqual([]);
    });
  });
});
