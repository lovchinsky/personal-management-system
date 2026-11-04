import { CANDIDATE_EVIDENCE } from '../../src/knowledge/exact-identity';
import type {
  FactRead,
  PageRead,
  PageSummary,
  SearchHit,
  TimelineEntry,
} from '../../src/knowledge/gbrain-pages';
import { LINK_VERBS } from '../../src/knowledge/memory-writes';
import {
  GbrainToolError,
  type FactInput,
  type GbrainInspector,
  type GbrainPlanter,
  type GbrainPort,
  type LinkInput,
  type TimelineInput,
} from '../../src/memory/gbrain-client';
import { isNotionId } from '../../src/notion/client/notion-id';
import { pageFromContent } from './gbrain-pages.fixture';

/** What the fake GBrain answers a search request with. */
const NOTHING_FOUND = 'нічого не знайдено';

/**
 * An in-memory GBrain for gate tests: pages, events, facts and links sit in structures the test
 * reads. Search finds the last written page by id (in the hyphenated form) and, when `byTopic`, by
 * any other text. That is how the test chooses whether the trap is reachable by topic.
 */
export class FakeGbrain implements GbrainPort, GbrainInspector, GbrainPlanter {
  readonly written: string[] = [];
  readonly pages = new Map<string, PageRead>();
  private readonly contents = new Map<string, string>();
  readonly timelines = new Map<string, TimelineEntry[]>();
  /** Facts by page slug. Facts with no entity are under the empty key. */
  readonly factsBy = new Map<string, FactRead[]>();
  readonly links: LinkInput[] = [];
  /** The deadlines that came with page, event and fact writes, in the order of the writes. */
  readonly deadlines: (AbortSignal | undefined)[] = [];
  private factCount = 0;

  constructor(private readonly byTopic = true) {}

  putPage(slug: string, content: string, deadline?: AbortSignal): Promise<void> {
    this.written.push(slug);
    this.deadlines.push(deadline);

    // As in GBrain, writing the same content leaves the page untouched, so its sections stay.
    if (this.contents.get(slug) !== content) {
      this.contents.set(slug, content);
      this.pages.set(slug, pageFromContent(slug, content));
    }

    return Promise.resolve();
  }

  deletePage(slug: string): Promise<void> {
    this.pages.delete(slug);
    this.contents.delete(slug);

    return Promise.resolve();
  }

  search(text: string): Promise<string> {
    return Promise.resolve(
      this.byTopic || isNotionId(text) ? (this.written.at(-1) ?? NOTHING_FOUND) : NOTHING_FOUND,
    );
  }

  searchHits(text: string, types: readonly string[]): Promise<SearchHit[]> {
    return Promise.resolve(
      [...this.pages.values()]
        .filter((page) => types.includes(page.type) && page.compiledTruth.includes(text))
        .map((page) => ({
          slug: page.slug,
          title: page.title,
          type: page.type,
          evidence: CANDIDATE_EVIDENCE,
        })),
    );
  }

  getPage(slug: string): Promise<PageRead | null> {
    return Promise.resolve(this.pages.get(slug) ?? null);
  }

  getTimeline(slug: string): Promise<TimelineEntry[]> {
    return Promise.resolve(this.timelines.get(slug) ?? []);
  }

  facts(entity: string): Promise<FactRead[]> {
    return Promise.resolve(this.factsBy.get(entity) ?? []);
  }

  listPages(type: string): Promise<PageSummary[]> {
    return Promise.resolve(
      [...this.pages.values()]
        .filter((page) => page.type === type)
        .map(({ slug, type: kind, title }) => ({ slug, type: kind, title })),
    );
  }

  addTimelineEntry(entry: TimelineInput, deadline?: AbortSignal): Promise<void> {
    const page = this.pages.get(entry.slug);

    this.deadlines.push(deadline);

    // As in GBrain, an event needs a page, and it goes into the page text.
    if (page === undefined) {
      return Promise.reject(
        new GbrainToolError('add_timeline_entry', `page_not_found ${entry.slug}`),
      );
    }

    this.pages.set(entry.slug, {
      ...page,
      timeline: [page.timeline, `- **${entry.date}** | ${entry.source} — ${entry.summary}`]
        .filter((line) => line.length > 0)
        .join('\n'),
    });
    this.timelines.set(entry.slug, [
      ...(this.timelines.get(entry.slug) ?? []),
      { date: entry.date, summary: entry.summary, source: entry.source, detail: '' },
    ]);

    return Promise.resolve();
  }

  remember(fact: FactInput, deadline?: AbortSignal): Promise<string> {
    const page = fact.entity === null ? undefined : this.pages.get(fact.entity);

    this.deadlines.push(deadline);

    // A fact with `entity`, the slug of an existing page, goes into that page's text, as in GBrain.
    if (fact.entity !== null && page !== undefined) {
      this.pages.set(fact.entity, {
        ...page,
        compiledTruth: `${page.compiledTruth}\n- ${fact.fact}`,
      });
    }

    const key = fact.entity ?? '';

    this.factsBy.set(key, [
      ...(this.factsBy.get(key) ?? []),
      { fact: fact.fact, kind: fact.kind, entitySlug: fact.entity, provenance: fact.provenance },
    ]);
    this.factCount += 1;

    return Promise.resolve(String(this.factCount));
  }

  addLink(link: LinkInput): Promise<void> {
    // As in GBrain, a link type comes from the declared list, or there is none.
    if (link.type !== null && !LINK_VERBS.includes(link.type)) {
      return Promise.reject(new GbrainToolError('add_link', `unknown link_type ${link.type}`));
    }

    this.links.push(link);

    return Promise.resolve();
  }
}
