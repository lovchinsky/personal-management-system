import { randomUUID } from 'node:crypto';
import { Client } from '@notionhq/client';
import { anchorSlug } from '../../src/knowledge/anchor-page';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { PrismaService } from '../../src/platform/db/prisma.service';
import type { TraceView } from '../../src/runs/run-traces';
import { textsOf } from '../../src/texts/texts';
import { HarnessError, InfrastructureError } from './gate-attempts';
import type { PageSnapshot } from './gate-claims';
import { Residue } from './gate-cleanup';
import {
  anchorPage,
  DEFAULT_WAITING,
  found,
  plainPage,
  plantPage,
  type PlantedPage,
  type Waiting,
} from './gbrain-fixture';
import { commentText } from './m4-world';
import {
  noticeFrom,
  type Evidence6,
  type Notice,
  type WrittenComment,
  type WrittenContinuation,
} from './m6-evidence';
import type { MemoryState, MemoryStates } from './memory-evidence';
import { packetLength } from './packet-length';
import { RunViews } from './run-views';
import type {
  AnchorMemory,
  ExpectedAnchor,
  MemoryPage,
  PlainMemory,
  PlantedMemory,
} from './scenario-kit';
import { Ids, pageOf, ScenarioWorld } from './scenario-world';

/**
 * What the run wrote, taken from the effects in its run trace and expanded with data from Notion
 * and `app_db`.
 */
interface Effects {
  readonly comments: readonly WrittenComment[];
  readonly notices: readonly Notice[];
  readonly continuations: readonly WrittenContinuation[];
  /** The writes of this run on pages outside the world: what, on which page, in which thread. */
  readonly outside: readonly string[];
}

/**
 * Everything gate M6 does to the world beyond what gate M5 can do: the person's reply in a thread,
 * moving a deadline, the scenario's memory pages and evidence from the effects of the run, before
 * the cleanup removes them.
 */
export class M6World extends ScenarioWorld {
  /** Sets the new `Deadline` of a Task to `inDays` days from today, a date without time. */
  async moveDeadline(pageId: string, inDays: number): Promise<void> {
    const adapter = this.app.get(SemanticAdapter);
    const types = await this.app.get(LiveSchema).typesOf(adapter.dataSourceOf('task'));

    await this.app
      .get(NotionWriter)
      .updateProperties(pageId, adapter.encode('task', { deadline: this.dateIn(inDays) }, types));
  }

  /**
   * Collects the evidence of a run from what it wrote itself: comments, continuations and
   * deliveries, found by the ids from the effects of its run trace, not by scanning pages. `also`
   * lists pages that belong to the world beyond those the attempt created (seeded records of the
   * environment). A write outside the pages of the world is foreign data, and the verdict names it
   * together with the page and the thread. The thread of a foreign write is not entered in the
   * cleanup registry, because it may have been in normal operation before, and cleaning up by
   * thread would delete production rows. The queue rows the run enqueued are registered by
   * `GateWorld.run` from the ids in the effects.
   */
  async evidenceFor(
    step: string,
    trace: TraceView,
    ids: Ids,
    before: Record<string, PageSnapshot>,
    discussionId: string | null,
    memory: MemoryStates,
    also: readonly string[] = [],
  ): Promise<Evidence6> {
    const base = await this.evidenceBase(step, trace, before, await this.snapshots(ids, false));
    const inWorld = new Set([...Object.values(ids), ...also].map(canonicalNotionId));
    const effects = await this.effectsOf(trace, inWorld);
    const foreignProposals = base.proposals.flatMap((proposal) =>
      proposal.effects
        .filter((effect) => !inWorld.has(canonicalNotionId(effect.pageId)))
        .map((effect) => `proposal ${proposal.id} on the page ${effect.pageId}`),
    );

    const views = this.app.get(RunViews);
    const observed = views.of(trace.id);

    return {
      ...base,
      continuations: effects.continuations,
      written: {
        comments: effects.comments,
        notices: effects.notices,
        packetLengths: effects.notices.map((notice) =>
          packetLength(notice, textsOf(this.language()).telegram),
        ),
      },
      foreign: [...effects.outside, ...foreignProposals],
      discussionId,
      observed,
      reads: views.readsOf(trace.id),
      memory: { ...memory, calls: observed.gbrainCalls },
    };
  }

  private async effectsOf(trace: TraceView, inWorld: ReadonlySet<string>): Promise<Effects> {
    const applied = trace.runtimeEffects ?? [];
    const idsOf = (kind: string): string[] =>
      applied.filter((effect) => effect.kind === kind).map((effect) => effect.id);
    const prisma = this.app.get(PrismaService);
    const comments = await Promise.all(idsOf('comment').map((id) => this.writtenComment(id)));
    const checks = await prisma.scheduledCheck.findMany({
      where: { id: { in: idsOf('continuation') } },
      orderBy: { createdAt: 'asc' },
    });
    const deliveries = await prisma.notificationOutbox.findMany({
      where: { id: { in: idsOf('delivery') } },
      orderBy: { createdAt: 'asc' },
    });
    const outside = (pageId: string): boolean => !inWorld.has(canonicalNotionId(pageId));

    return {
      comments,
      notices: deliveries.map((row) => noticeFrom(row.payload)),
      continuations: checks.map((row) => ({
        id: row.id,
        reasonCode: row.reasonCode,
        runAt: row.runAt.toISOString(),
        pageId: row.notionPageId,
        discussionId: row.discussionId,
      })),
      outside: [
        ...comments
          .filter((comment) => outside(comment.pageId))
          .map(
            (comment) =>
              `comment ${comment.id} on the page ${comment.pageId} (thread ${comment.discussionId})`,
          ),
        ...checks
          .filter((check) => outside(check.notionPageId))
          .map(
            (check) =>
              `follow-up ${check.id} on the page ${check.notionPageId} (thread ${check.discussionId ?? 'none'})`,
          ),
      ],
    };
  }

  /**
   * A comment the run wrote: the page and the thread come from the comment itself, not from
   * scanning pages.
   */
  private async writtenComment(id: string): Promise<WrittenComment> {
    const comment = await this.app.get(Client).comments.retrieve({ comment_id: id });

    if (!('rich_text' in comment)) {
      throw new InfrastructureError(`the comment ${id} came back without its text`);
    }

    return {
      id: comment.id,
      pageId: comment.parent.type === 'page_id' ? comment.parent.page_id : comment.parent.block_id,
      discussionId: canonicalNotionId(comment.discussion_id),
      text: commentText(comment),
      author: comment.created_by.id,
    };
  }

  /**
   * The slugs of the GBrain pages each attempt planted, keyed by its cleanup registry and then by
   * page key.
   */
  private readonly planted = new WeakMap<Residue, Record<string, string>>();

  /**
   * Writes the GBrain pages of the scenario and waits until search finds them by the exact id of
   * the object whose anchor the page is. An anchor of another object is found by its own random
   * id. When the scenario says what the page is searched for by topic, the wait covers that search
   * too, because a trap that search does not surface checks nothing, and that is a harness fault,
   * not run behavior. The events, facts and links the scenario gave a page are put on the page once
   * it is written.
   */
  async plantMemory(
    pages: readonly MemoryPage[],
    ids: Ids,
    residue: Residue,
    waiting: Waiting = DEFAULT_WAITING,
  ): Promise<void> {
    const slugs = this.planted.get(residue) ?? {};

    this.planted.set(residue, slugs);

    for (const page of pages) {
      this.assertRunning();

      if (page.kind === 'expected') {
        slugs[page.key] = this.expectedAt(page, ids, residue);
        continue;
      }

      const planting = page.kind === 'anchor' ? this.anchorOf(page, ids) : this.plainOf(page, ids);

      slugs[page.key] = planting.slug;

      await plantPage(this.gbrain(), residue, planting, waiting);

      if (page.discoverableBy !== undefined) {
        await this.discoverable(planting.slug, page.discoverableBy, waiting);
      }

      await this.addHistory(page, planting.slug, slugs);
    }
  }

  /**
   * Returns the address of an anchor that does not exist yet. The cleanup deletes the page if the
   * run creates it, and there is nothing to delete for a page that does not exist.
   */
  private expectedAt(page: ExpectedAnchor, ids: Ids, residue: Residue): string {
    const slug = anchorSlug(page.type, pageOf(ids, page.of));

    residue.gbrainPages.push(slug);

    return slug;
  }

  /**
   * Builds the scenario's anchor with the id of a world object, or with a random id for the anchor
   * of another object.
   */
  private anchorOf(page: AnchorMemory, ids: Ids): PlantedPage {
    const notionId = canonicalNotionId(page.of === null ? randomUUID() : pageOf(ids, page.of));

    return {
      ...anchorPage({
        type: page.type,
        notionId,
        title: page.title,
        paragraphs: page.paragraphs,
        aliases: page.aliases ?? [page.title],
        slug: page.slug,
      }),
      findBy: notionId,
    };
  }

  /**
   * Builds a page that is not an anchor. When the page mentions a world object, search finds it by
   * that object's id.
   */
  private plainOf(page: PlainMemory, ids: Ids): PlantedPage {
    const mentioned = page.mentions === undefined ? undefined : pageOf(ids, page.mentions);

    return {
      ...plainPage({
        slug: page.slug,
        type: page.type,
        title: page.title,
        paragraphs: page.paragraphs,
        mentions: mentioned,
      }),
      findBy: mentioned === undefined ? page.title : canonicalNotionId(mentioned),
    };
  }

  /**
   * Adds the events and facts of an anchor and a link from a page to the anchor, all on pages that
   * already exist.
   */
  private async addHistory(
    page: PlantedMemory,
    slug: string,
    slugs: Readonly<Record<string, string>>,
  ): Promise<void> {
    const gbrain = this.gbrain();

    if (page.kind === 'anchor') {
      for (const entry of page.timeline ?? []) {
        await gbrain.addTimelineEntry({ slug, ...entry });
      }

      for (const fact of page.facts ?? []) {
        await gbrain.remember({
          fact,
          provenance: 'recorded before the run',
          entity: slug,
          kind: 'fact',
        });
      }
    } else if (page.linksTo !== undefined) {
      const to = slugs[page.linksTo.key];

      if (to === undefined) {
        throw new HarnessError(
          `the link of ${page.key} leads to ${page.linksTo.key}, which is not planted`,
        );
      }

      await gbrain.addLink({ from: slug, to, type: page.linksTo.type });
    }
  }

  /** Reads the state of the pages the attempt planted from GBrain, before the run and after it. */
  async memoryStates(residue: Residue): Promise<{
    readonly slugs: Readonly<Record<string, string>>;
    readonly states: Readonly<Record<string, MemoryState>>;
  }> {
    const slugs = this.planted.get(residue) ?? {};

    // A scenario without memory does not call GBrain: no client is created for it.
    if (Object.keys(slugs).length === 0) return { slugs, states: {} };

    const gbrain = this.gbrain();
    const states = Object.fromEntries(
      await Promise.all(
        Object.entries(slugs).map(async ([key, slug]): Promise<[string, MemoryState]> => {
          const [page, timeline, facts] = await Promise.all([
            gbrain.getPage(slug),
            gbrain.getTimeline(slug),
            gbrain.facts(slug),
          ]);

          return [key, { page, timeline, facts }];
        }),
      ),
    );

    return { slugs, states };
  }

  private async discoverable(slug: string, query: string, waiting: Waiting): Promise<void> {
    try {
      await found(this.gbrain(), query, waiting, slug);
    } catch (error) {
      throw new HarnessError(`the page ${slug} is not found by its topic ${query}`, {
        cause: error,
      });
    }
  }
}
