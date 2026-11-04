import { INestApplicationContext } from '@nestjs/common';
import { Client, isFullPage } from '@notionhq/client';
import { CANONICAL_TYPES } from '../../src/notion/binding/binding.schema';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { fixturePages, fixtureThreads, type FixtureRegistry } from './m8-fixtures';

/**
 * A review, the sweep and the reconciliation read the workspace and the registry in full, so a run
 * sees everything in the gate environment. Before an attempt the gate therefore does not assume
 * but checks that nothing is there except what was seeded: no live pages in the bound databases
 * and no `app_db_gate` rows left by an earlier attempt. Run traces and webhook receipts are
 * outside this check because runs do not read them.
 */

/**
 * How many pages of one database the check reads: more is no longer “residue” but a foreign
 * workspace.
 */
const PAGES_PER_SOURCE = 500;

/** How many findings the check names one by one; the rest are reported as a number. */
const NAMED = 20;

/**
 * Lists what is foreign in the gate environment, in words with ids to find it by. An empty list
 * means the environment is clean.
 */
export async function foreignIn(
  app: INestApplicationContext,
  registry: FixtureRegistry,
): Promise<string[]> {
  const found = [...(await foreignPages(app, registry)), ...(await foreignRows(app, registry))];

  return found.length <= NAMED
    ? found
    : [...found.slice(0, NAMED), `and ${found.length - NAMED} more`];
}

/** Finds the live pages of the bound databases that were not seeded. */
async function foreignPages(
  app: INestApplicationContext,
  registry: FixtureRegistry,
): Promise<string[]> {
  const notion = app.get(Client);
  const adapter = app.get(SemanticAdapter);
  const planted = new Set(fixturePages(registry));
  const found: string[] = [];

  for (const type of CANONICAL_TYPES) {
    const dataSourceId = adapter.dataSourceOf(type);
    let cursor: string | undefined;
    let read = 0;

    do {
      const response = await notion.dataSources.query({
        data_source_id: dataSourceId,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const page of response.results) {
        read += 1;

        if (page.object !== 'page' || planted.has(canonicalNotionId(page.id))) continue;

        found.push(`the ${type} page ${page.id}${isFullPage(page) ? ` «${titleOf(page)}»` : ''}`);
      }

      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    } while (cursor !== undefined && read < PAGES_PER_SOURCE);

    if (cursor !== undefined) {
      found.push(`the ${type} data source holds more than ${PAGES_PER_SOURCE} live pages`);
    }
  }

  return found;
}

function titleOf(page: { readonly properties: Record<string, unknown> }): string {
  for (const property of Object.values(page.properties)) {
    if (
      typeof property === 'object' &&
      property !== null &&
      'type' in property &&
      property.type === 'title' &&
      'title' in property &&
      Array.isArray(property.title)
    ) {
      return property.title
        .map((part: unknown) =>
          typeof part === 'object' && part !== null && 'plain_text' in part
            ? String(part.plain_text)
            : '',
        )
        .join('');
    }
  }

  return '';
}

/**
 * Finds the `app_db_gate` rows that runs and ticks read, except the declared thread of what was
 * seeded.
 */
async function foreignRows(
  app: INestApplicationContext,
  registry: FixtureRegistry,
): Promise<string[]> {
  const prisma = app.get(PrismaService);
  const declared = fixtureThreads(registry);
  const [threads, checks, windows, proposals, deliveries, occurrences, marks, reconciliations] =
    await Promise.all([
      prisma.systemDiscussion.findMany({ where: { discussionId: { notIn: declared } } }),
      prisma.scheduledCheck.findMany(),
      prisma.evaluationWindow.findMany(),
      prisma.pendingAction.findMany(),
      prisma.notificationOutbox.findMany(),
      prisma.reviewOccurrence.findMany(),
      prisma.sweepMark.findMany(),
      prisma.discussionReconciliation.findMany(),
    ]);

  return [
    ...threads.map((row) => `the thread ${row.discussionId} on the page ${row.pageId}`),
    ...checks.map((row) => `the ${row.status} follow-up ${row.id} on the page ${row.notionPageId}`),
    ...windows.map(
      (row) => `the ${row.status} evaluation window ${row.id} on the page ${row.pageId}`,
    ),
    ...proposals.map(
      (row) => `the ${row.status} proposal ${row.id} on the page ${row.notionPageId}`,
    ),
    ...deliveries.map((row) => `the ${row.status} delivery ${row.idempotencyKey}`),
    ...occurrences.map(
      (row) => `the ${row.status} ${row.mode} occurrence ${row.occurrenceKey} (${row.id})`,
    ),
    ...marks.map((row) => `the sweep mark ${row.rule} of the page ${row.pageId}`),
    ...reconciliations.map((row) => `the reconciliation memory of the thread ${row.discussionId}`),
  ];
}
