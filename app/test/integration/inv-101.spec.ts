import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { subHours } from 'date-fns';
import { SweepRule } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { Candidate } from '../../src/sweeps/sweep.finder';
import { truncateAll } from './database';
import { SweepsWorld, sweepsWorld } from './sweeps.harness';

/** Counts the rows of each App table. */
async function census(prisma: PrismaService): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
     ORDER BY tablename
  `;
  const counts: Record<string, number> = {};

  for (const { tablename } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "${tablename}"`,
    );

    counts[tablename] = Number(row?.count ?? 0);
  }

  return counts;
}

/** Lists the imports of the sweep code: module paths as written. */
function sweepImports(): string[] {
  const dir = resolve(__dirname, '../../src/sweeps');

  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .flatMap((name) =>
      [...readFileSync(resolve(dir, name), 'utf8').matchAll(/from '([^']+)'/g)].map(
        (match) => match[1],
      ),
    );
}

/**
 * The sweep wakes and does not decide: a pass leaves behind only `safety_recheck` wakes with no
 * thread and the memory about them, and writes nothing to Notion (`docs/2-system.md`
 * § “Periodic safety sweep”, ADR 0037).
 */
describe('INV-101 the sweep writes only safety_recheck continuations with no thread and asserts nothing about the domain', () => {
  let world: SweepsWorld;

  beforeAll(async () => {
    world = await sweepsWorld();
  });

  beforeEach(async () => {
    await truncateAll(world.prisma);
  });

  afterAll(async () => {
    await world.close();
  });

  it('after a pass only the continuations and the sweep memory have changed', async () => {
    const rules = Object.values(SweepRule);

    world.finder.candidates = rules.map((rule, index): Candidate => ({
      pageId: `page-${index}`,
      rule,
      basis: `basis-${index}`,
      since: subHours(new Date(), 1),
      pages: [`page-${index}`],
    }));

    const before = await census(world.prisma);
    const woken = await world.sweep.sweep();
    const after = await census(world.prisma);
    const changed = Object.keys(after).filter((table) => after[table] !== before[table]);

    expect(woken).toBeGreaterThan(0);
    expect(changed.sort()).toEqual(['scheduled_checks', 'sweep_marks']);
    await expect(
      world.prisma.scheduledCheck.findMany({ select: { reasonCode: true, discussionId: true } }),
    ).resolves.toEqual(
      Array.from({ length: woken }, () => ({ reasonCode: 'safety_recheck', discussionId: null })),
    );
  });

  /**
   * A write to Notion, a delivery or a decision on a proposal would be a conclusion, not a wake.
   */
  it('the sweep code does not reach for Notion writes, delivery or decisions', () => {
    const forbidden = sweepImports().filter((path) =>
      /notion\.writer|\/delivery\/|\/executor\/|\/capture\/|\/memory\//.test(path),
    );

    expect(forbidden).toEqual([]);
  });
});
