import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { INestApplicationContext } from '@nestjs/common';
import { Client, isFullPage } from '@notionhq/client';
import { addDays, startOfMinute, subDays } from 'date-fns';
import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import { AttentionService } from '../../src/attention/attention.service';
import { CaptureService } from '../../src/capture/capture.service';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { canonicalPage } from '../../src/notion/client/page';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { CHAT, type RunActor } from '../../src/runs/actor';
import { GATE_MAPPING_FILE } from './gate-boot';
import { allComments } from './m4-world';
import { CAPTURE_PROPERTY } from './workspace/capture-overlay';

/**
 * Stale Inbox items of the gate environment. Staleness is measured from `captured_at`
 * (`contracts/canonical.yaml`, key `review_scope`), and in the gate it comes from the overlay date
 * (`workspace/capture-overlay.ts`). The seeding `bin/gate m8 --seed` writes a capture time beyond
 * the staleness threshold to the overlay date, so the item is stale at once. What is seeded
 * persists between gate runs. The gate keeps a declared state for each item: the page, the capture
 * time, its comments and its thread in the registry. It checks that state before an attempt and
 * restores it after.
 */

/**
 * The number of days from `captured_at` after which an Inbox item is stale
 * (`review_scope.inbox_stale_after_days`).
 */
export const STALE_AFTER_DAYS = 3;

/** The registry of seeded items, beside the gate binding on the host: `infra/gate/fixtures.yaml` */
export const FIXTURES_FILE = join(dirname(GATE_MAPPING_FILE), 'fixtures.yaml');

export type FixtureKey = 'plain' | 'asked';

interface FixtureSpec {
  readonly key: FixtureKey;
  readonly title: string;
  readonly text: string;
  /** The system's question left unanswered; the system has not asked about an item without one. */
  readonly question?: string;
}

/**
 * Two stale items: the system has not yet asked about one, and on the other its question awaits an
 * answer. The Latin stem in the title is what the claims use to recognize the item in the packet
 * text.
 */
export const FIXTURE_SPECS: readonly FixtureSpec[] = [
  {
    key: 'plain',
    title: 'Курс нічної фотографії Vellum',
    text: 'Радили на зустрічі випускників, треба глянути програму й ціну',
  },
  {
    key: 'asked',
    title: 'Квитки на концерт Corvid у грудні',
    text: 'Квитки швидко розбирають',
    question:
      'Ви збираєтеся купити квитки чи лише хочете не забути дату концерту? Якщо купувати — до якого дня?',
  },
];

/** Stems of the titles of the seeded items. */
export const FIXTURE_STEMS: Readonly<Record<FixtureKey, string>> = {
  plain: 'Vellum',
  asked: 'Corvid',
};

const threadSchema = z.strictObject({
  discussion: z.string(),
  comment: z.string(),
  mode: z.enum(WorkflowMode),
  first_written_at: z.iso.datetime({ offset: true }),
  last_written_at: z.iso.datetime({ offset: true }),
});

const entrySchema = z.strictObject({
  page: z.string(),
  captured_at: z.iso.datetime({ offset: true }),
  thread: threadSchema.optional(),
});

const registrySchema = z.strictObject({
  inbox: z.partialRecord(z.enum(['plain', 'asked']), entrySchema),
});

export type FixtureEntry = z.infer<typeof entrySchema>;
export type FixtureRegistry = z.infer<typeof registrySchema>;

const HEADER =
  '# Застояні записи Inbox середовища gate (`bin/gate m8 --seed`): сторінка, момент створення й\n' +
  '# нитка системи, якщо вона є. Gate перевіряє й відновлює саме цей стан; правити руками не треба.\n';

/** Reads the registry from the file; with no file, nothing is seeded. */
export function readRegistry(file = FIXTURES_FILE): FixtureRegistry {
  if (!existsSync(file)) return { inbox: {} };

  return registrySchema.parse(parseDocument(readFileSync(file, 'utf8')).toJS());
}

function writeRegistry(registry: FixtureRegistry, file = FIXTURES_FILE): void {
  writeFileSync(file, HEADER + stringify(registry));
}

/** Returns the pages of the seeded items in canonical spelling. */
export function fixturePages(registry: FixtureRegistry): string[] {
  return Object.values(registry.inbox).map((entry) => canonicalNotionId(entry.page));
}

/**
 * Returns the threads of the seeded items that are declared. The cleanup of an attempt leaves them
 * alone.
 */
export function fixtureThreads(registry: FixtureRegistry): string[] {
  return Object.values(registry.inbox).flatMap((entry) =>
    entry.thread === undefined ? [] : [canonicalNotionId(entry.thread.discussion)],
  );
}

/**
 * Returns when the seeded items become stale: the latest of the times, or `null` when nothing is
 * seeded.
 */
export function readyAt(registry: FixtureRegistry): Date | null {
  const entries = FIXTURE_SPECS.map((spec) => registry.inbox[spec.key]);

  if (entries.some((entry) => entry === undefined)) return null;

  const latest = Math.max(...entries.map((entry) => new Date(entry?.captured_at ?? 0).getTime()));

  return addDays(new Date(latest), STALE_AFTER_DAYS);
}

/** A seeded page as Notion sees it. */
export interface ObservedPage {
  readonly inTrash: boolean;
  readonly inInbox: boolean;
  /** The capture time as the App and the model read it, via the binding; `null` if unreadable. */
  readonly capturedAt: string | null;
  /** Ids of the comments that Notion returns among the unresolved ones. */
  readonly comments: readonly string[];
}

/** The state of the seeded items in Notion and `app_db_gate`, checked against the declared one. */
export interface ObservedFixtures {
  /** `null` means the page does not exist or is unavailable. */
  readonly pages: Readonly<Partial<Record<FixtureKey, ObservedPage | null>>>;
  /** Rows of the thread registry on the seeded pages. */
  readonly threads: readonly {
    readonly discussionId: string;
    readonly pageId: string;
    readonly mode: string;
    readonly lastCommentId: string | null;
  }[];
  /** Other `app_db_gate` rows about the seeded pages or their threads, in words. */
  readonly rows: readonly string[];
}

/**
 * Lists how the seeded state differs from the declared one, with a line per reason. An empty list
 * means the state is ready. A seeded item that is not yet stale is a reason too, because a review
 * will not call stale what is not stale yet.
 */
export function fixtureProblems(
  registry: FixtureRegistry,
  observed: ObservedFixtures,
  now: Date,
): string[] {
  const problems: string[] = [];
  const declaredThreads = new Set(fixtureThreads(registry));

  for (const spec of FIXTURE_SPECS) {
    const entry = registry.inbox[spec.key];

    if (entry === undefined) {
      problems.push(`the ${spec.key} Inbox item is not planted: run bin/gate m8 --seed`);
      continue;
    }

    const page = observed.pages[spec.key];

    if (page === null || page === undefined || page.inTrash || !page.inInbox) {
      problems.push(
        `the ${spec.key} Inbox item ${entry.page} is gone from the Inbox: run bin/gate m8 --seed`,
      );
      continue;
    }

    if (page.capturedAt === null) {
      problems.push(`the capture moment of the ${spec.key} Inbox item does not read`);
    } else if (new Date(page.capturedAt).getTime() !== new Date(entry.captured_at).getTime()) {
      problems.push(
        `the ${spec.key} Inbox item is captured at ${page.capturedAt}, not at the declared ${entry.captured_at}: run bin/gate m8 --seed`,
      );
    } else {
      const stale = addDays(new Date(page.capturedAt), STALE_AFTER_DAYS);

      if (stale > now) {
        problems.push(`the ${spec.key} Inbox item is stale only from ${stale.toISOString()}`);
      }
    }

    const declared = entry.thread === undefined ? [] : [canonicalNotionId(entry.thread.comment)];
    const extra = page.comments.map(canonicalNotionId).filter((id) => !declared.includes(id));
    const missing = declared.filter((id) => !page.comments.map(canonicalNotionId).includes(id));

    if (extra.length > 0) {
      problems.push(`the ${spec.key} Inbox item carries undeclared comments ${extra.join(', ')}`);
    }

    if (missing.length > 0) {
      problems.push(`the ${spec.key} Inbox item lost its comment ${missing.join(', ')}`);
    }

    if (entry.thread !== undefined) {
      const thread = entry.thread;
      const row = observed.threads.find(
        (candidate) => candidate.discussionId === canonicalNotionId(thread.discussion),
      );

      if (
        row === undefined ||
        row.mode !== thread.mode ||
        row.lastCommentId !== canonicalNotionId(thread.comment)
      ) {
        problems.push(`the thread of the ${spec.key} Inbox item is not registered as declared`);
      }
    }
  }

  const undeclared = observed.threads.filter((row) => !declaredThreads.has(row.discussionId));

  if (undeclared.length > 0) {
    problems.push(
      `threads nobody declared lie on the planted Inbox items: ${undeclared.map((row) => row.discussionId).join(', ')}`,
    );
  }

  return [...problems, ...observed.rows.map((row) => `${row} refers to a planted Inbox item`)];
}

/** What the seeding did and when the seeded items become stale. */
export interface SeedReport {
  readonly planted: readonly FixtureKey[];
  readonly kept: readonly FixtureKey[];
  readonly readyAt: string | null;
  readonly problems: readonly string[];
}

/**
 * All the ways the gate touches the seeded items: seeding, inspecting the state, restoring. It
 * talks to the App by the same paths as the person and the run do: the channel capability parks
 * the item, and attention asks the question on behalf of the processing run.
 */
export class Fixtures {
  constructor(
    private readonly app: INestApplicationContext,
    private readonly file = FIXTURES_FILE,
  ) {}

  registry(): FixtureRegistry {
    return readRegistry(this.file);
  }

  /**
   * Seeds what is missing, has vanished from the Inbox or has lost its question. Such an item goes
   * to the trash and a new one is planted in its place. What is alive and whole stays, and the
   * restore removes foreign comments and rows from it. For each item the seeding declares a
   * capture time beyond the staleness threshold and writes it to the overlay date, so what is
   * seeded is stale at once.
   */
  async seed(): Promise<SeedReport> {
    const registry = this.registry();
    const observed = await this.observe(registry);
    const planted: FixtureKey[] = [];
    const kept: FixtureKey[] = [];
    const inbox: Partial<Record<FixtureKey, FixtureEntry>> = { ...registry.inbox };
    const captured = capturedMoment(new Date());

    for (const spec of FIXTURE_SPECS) {
      const entry = registry.inbox[spec.key];
      const page = observed.pages[spec.key];
      const alive = page !== null && page !== undefined && !page.inTrash && page.inInbox;
      const question = entry?.thread === undefined ? null : canonicalNotionId(entry.thread.comment);
      const asked =
        spec.question === undefined ||
        (question !== null && alive && page.comments.map(canonicalNotionId).includes(question));

      if (alive && asked && entry !== undefined) {
        inbox[spec.key] = { ...entry, captured_at: await this.capture(entry.page, captured) };
        kept.push(spec.key);
        continue;
      }

      if (alive && entry !== undefined) await this.app.get(NotionWriter).archive(entry.page);

      inbox[spec.key] = await this.plant(spec, captured);
      planted.push(spec.key);
    }

    const next: FixtureRegistry = { inbox };
    const ready = readyAt(next);

    writeRegistry(next, this.file);
    await this.restore(next);

    return {
      planted,
      kept,
      readyAt: ready?.toISOString() ?? null,
      // Checked as of the time the items are ready, because it is no fault of the seeding that
      // freshly seeded items are young.
      problems: fixtureProblems(next, await this.observe(next), later(ready, new Date())),
    };
  }

  /**
   * Observes the state of the seeded items: pages and comments from Notion, rows from
   * `app_db_gate`.
   */
  async observe(registry: FixtureRegistry): Promise<ObservedFixtures> {
    const pages: Partial<Record<FixtureKey, ObservedPage | null>> = {};

    for (const spec of FIXTURE_SPECS) {
      const entry = registry.inbox[spec.key];

      pages[spec.key] = entry === undefined ? null : await this.page(entry.page);
    }

    const ids = spelledBoth(fixturePages(registry));
    const prisma = this.app.get(PrismaService);
    const threads = await prisma.systemDiscussion.findMany({ where: { pageId: { in: ids } } });
    const threadIds = spelledBoth(threads.map((row) => row.discussionId));
    const [checks, windows, proposals, deliveries, marks, reconciliations] = await Promise.all([
      prisma.scheduledCheck.findMany({
        where: { OR: [{ notionPageId: { in: ids } }, { discussionId: { in: threadIds } }] },
      }),
      prisma.evaluationWindow.findMany({
        where: { OR: [{ pageId: { in: ids } }, { discussionId: { in: threadIds } }] },
      }),
      prisma.pendingAction.findMany({
        where: { OR: [{ notionPageId: { in: ids } }, { discussionId: { in: threadIds } }] },
      }),
      prisma.notificationOutbox.findMany({ where: { discussionId: { in: threadIds } } }),
      prisma.sweepMark.findMany({ where: { pageId: { in: ids } } }),
      prisma.discussionReconciliation.findMany({ where: { discussionId: { in: threadIds } } }),
    ]);

    return {
      pages,
      threads: threads.map((row) => ({
        discussionId: canonicalNotionId(row.discussionId),
        pageId: canonicalNotionId(row.pageId),
        mode: row.mode,
        lastCommentId: row.lastCommentId === null ? null : canonicalNotionId(row.lastCommentId),
      })),
      rows: [
        ...checks.map((row) => `the follow-up ${row.id}`),
        ...windows.map((row) => `the evaluation window ${row.id}`),
        ...proposals.map((row) => `the proposal ${row.id}`),
        ...deliveries.map((row) => `the delivery ${row.id}`),
        ...marks.map((row) => `the sweep mark ${row.pageId}/${row.rule}`),
        ...reconciliations.map((row) => `the reconciliation memory of ${row.discussionId}`),
      ],
    };
  }

  /**
   * Returns the seeded items to the declared state: removes the comments the registry does not
   * name and the `app_db_gate` rows about the seeded pages, except the declared threads, and
   * writes the declared threads as they were declared. It also removes what was left by the gate
   * itself, not by a run. Returns what could not be removed.
   */
  async restore(registry: FixtureRegistry): Promise<string[]> {
    const left: string[] = [];
    const notion = this.app.get(Client);
    const declaredComments = new Set(
      Object.values(registry.inbox).flatMap((entry) =>
        entry.thread === undefined ? [] : [canonicalNotionId(entry.thread.comment)],
      ),
    );

    for (const entry of Object.values(registry.inbox)) {
      try {
        for (const comment of await allComments(notion, entry.page)) {
          if (!declaredComments.has(canonicalNotionId(comment.id))) {
            await notion.comments.delete({ comment_id: comment.id });
          }
        }
      } catch (error) {
        left.push(`comments of ${entry.page}: ${String(error)}`);
      }
    }

    try {
      await this.restoreRows(registry);
    } catch (error) {
      left.push(`rows of the planted Inbox items: ${String(error)}`);
    }

    return left;
  }

  private async restoreRows(registry: FixtureRegistry): Promise<void> {
    const prisma = this.app.get(PrismaService);
    const ids = spelledBoth(fixturePages(registry));
    const declared = spelledBoth(fixtureThreads(registry));
    const threads = spelledBoth(
      (await prisma.systemDiscussion.findMany({ where: { pageId: { in: ids } } })).map(
        (row) => row.discussionId,
      ),
    );

    await prisma.$transaction([
      prisma.notificationOutbox.deleteMany({ where: { discussionId: { in: threads } } }),
      prisma.scheduledCheck.deleteMany({
        where: { OR: [{ notionPageId: { in: ids } }, { discussionId: { in: threads } }] },
      }),
      prisma.evaluationWindow.deleteMany({
        where: { OR: [{ pageId: { in: ids } }, { discussionId: { in: threads } }] },
      }),
      prisma.pendingAction.deleteMany({
        where: { OR: [{ notionPageId: { in: ids } }, { discussionId: { in: threads } }] },
      }),
      prisma.sweepMark.deleteMany({ where: { pageId: { in: ids } } }),
      prisma.discussionReconciliation.deleteMany({ where: { discussionId: { in: threads } } }),
      prisma.systemDiscussion.deleteMany({
        where: { pageId: { in: ids }, discussionId: { notIn: declared } },
      }),
      ...Object.values(registry.inbox).flatMap((entry) => {
        const thread = entry.thread;

        if (thread === undefined) return [];

        const row = {
          pageId: canonicalNotionId(entry.page),
          mode: thread.mode,
          firstWrittenAt: new Date(thread.first_written_at),
          lastWrittenAt: new Date(thread.last_written_at),
          blockId: null,
          lastCommentId: canonicalNotionId(thread.comment),
        };

        return [
          prisma.systemDiscussion.upsert({
            where: { discussionId: canonicalNotionId(thread.discussion) },
            create: { discussionId: canonicalNotionId(thread.discussion), ...row },
            update: row,
          }),
        ];
      }),
    ]);
  }

  /**
   * Plants an Inbox item by the same path as in the channel, and the question on behalf of the
   * processing run.
   */
  private async plant(spec: FixtureSpec, captured: Date): Promise<FixtureEntry> {
    const capture = this.app.get(CaptureService);
    const parking = await capture.checkPark(CHAT, { title: spec.title, text: spec.text });
    const pageId = await capture.park(CHAT, parking, () => undefined);
    const capturedAt = await this.capture(pageId, captured);

    if (spec.question === undefined) return { page: pageId, captured_at: capturedAt };

    const written = await this.app
      .get(AttentionService)
      .comment(clarifyingRun(), { pageId, text: spec.question });
    const row = await this.app.get(PrismaService).systemDiscussion.findUniqueOrThrow({
      where: { discussionId: canonicalNotionId(written.discussionId) },
    });

    return {
      page: pageId,
      captured_at: capturedAt,
      thread: {
        discussion: row.discussionId,
        comment: canonicalNotionId(written.commentId),
        mode: row.mode,
        first_written_at: row.firstWrittenAt.toISOString(),
        last_written_at: row.lastWrittenAt.toISOString(),
      },
    };
  }

  /**
   * Sets the capture time of an item: writes it to the overlay date and reads it back through the
   * binding, the way the App and the model will read it. Returns what was read.
   */
  private async capture(pageId: string, captured: Date): Promise<string> {
    await this.app.get(Client).pages.update({
      page_id: pageId,
      properties: { [CAPTURE_PROPERTY]: { date: { start: captured.toISOString() } } },
    });

    const capturedAt = (await this.page(pageId))?.capturedAt ?? null;

    if (capturedAt === null) {
      throw new Error(`the capture moment of the planted Inbox item ${pageId} does not read back`);
    }

    return capturedAt;
  }

  /**
   * Reads a page by id: whether it is in the trash, whether it is in the Inbox, when it was
   * captured and which comments it has. Returns `null` if Notion did not return the page.
   */
  private async page(pageId: string): Promise<ObservedPage | null> {
    const notion = this.app.get(Client);
    let page;

    try {
      page = await notion.pages.retrieve({ page_id: pageId });
    } catch {
      return null;
    }

    if (!isFullPage(page)) return null;

    const inbox = this.app.get(SemanticAdapter).dataSourceOf('inbox_item');
    const parent = page.parent.type === 'data_source_id' ? page.parent.data_source_id : null;

    const captured = this.app
      .get(SemanticAdapter)
      .readField('inbox_item', canonicalPage(page), 'captured_at');

    return {
      inTrash: page.in_trash,
      inInbox: parent !== null && canonicalNotionId(parent) === canonicalNotionId(inbox),
      capturedAt:
        captured.state === 'value' && captured.value.type === 'date' ? captured.value.start : null,
      comments: page.in_trash
        ? []
        : (await allComments(notion, pageId)).map((comment) => comment.id),
    };
  }
}

/**
 * Returns the capture time the seeding declares: a day beyond the staleness threshold, to the
 * minute, because Notion stores the date with that precision.
 */
function capturedMoment(now: Date): Date {
  return startOfMinute(subDays(now, STALE_AFTER_DAYS + 1));
}

/**
 * Returns the run that processed an Inbox item and asked the question. Attention writes on its
 * behalf.
 */
function clarifyingRun(): RunActor {
  return {
    kind: 'run',
    runId: `gate-m8-seed-${randomUUID()}`,
    mode: 'dialogue',
    provenance: { origin: 'inbox_capture' },
    startedAt: new Date(),
  };
}

/** Returns the later of two times; `null` means there is no time. */
export const later = (a: Date | null, b: Date): Date => (a !== null && a > b ? a : b);

/**
 * Returns ids in both spellings: hyphenated, as Notion returns them, and canonical, as `app_db`
 * has it.
 */
function spelledBoth(ids: readonly string[]): string[] {
  return [...new Set(ids.flatMap((id) => [id, canonicalNotionId(id)]))];
}
