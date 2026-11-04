import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import type { RunnerConfig } from '../claude/runner/runner.config';
import type { GbrainToken } from '../credentials/gbrain/gbrain.token';
import {
  parseFacts,
  parsePage,
  parsePageList,
  parseRemembered,
  parseSearchHits,
  parseTimeline,
  type FactRead,
  type PageRead,
  type PageSummary,
  type SearchHit,
  type TimelineEntry,
} from '../knowledge/gbrain-pages';
import { required } from '../platform/config/env-value';
import { AppError } from '../platform/error/app-error';
import { messageOf } from '../platform/error/message-of';

/**
 * How long a token obtained for one operation stays valid, with a margin for the start of the
 * request.
 */
const TOKEN_VALID_MS = 60_000;

/**
 * How long to wait for GBrain. A write waits while GBrain computes the page's embedding, and
 * GBrain retries its request to the provider with a pause of almost a minute, so a write can take
 * minutes. A read (search) is fast.
 */
const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 5 * 60_000;

/**
 * How many rows one read request asks for (the remote call returns no more): an answer of this
 * length may have been cut off, so it is not taken as complete.
 */
export const READ_LIMIT = 100;

/** How long to wait for each group of operations. */
interface Timeouts {
  readonly readMs: number;
  readonly writeMs: number;
}

/** What the gate can do with GBrain for its own pages: write, find by text and delete. */
export interface GbrainPort {
  putPage(slug: string, content: string): Promise<void>;
  /** Soft-deletes a page. It disappears from search; GBrain can restore it for a few more days. */
  deletePage(slug: string): Promise<void>;
  /** Returns the search answer as text, which includes the slugs of the pages found. */
  search(text: string): Promise<string>;
}

/** Reading the state of memory: what the gate uses to see what a run left in GBrain. */
export interface GbrainInspector {
  /** Searches among pages of the named types; the answer is parsed. */
  searchHits(text: string, types: readonly string[]): Promise<SearchHit[]>;
  /** Returns the page by slug; `null` means there is no such page. */
  getPage(slug: string): Promise<PageRead | null>;
  getTimeline(slug: string): Promise<TimelineEntry[]>;
  /** Returns the facts about a page (`entity` is its slug). */
  facts(entity: string): Promise<FactRead[]>;
  listPages(type: string): Promise<PageSummary[]>;
}

/** A timeline event of a page: the day `YYYY-MM-DD`, the content and the source. */
export interface TimelineInput {
  readonly slug: string;
  readonly date: string;
  readonly summary: string;
  readonly source: string;
}

/**
 * A fact with its source: about a page (`entity` is its slug) or with no entity (`entity: null`).
 */
export interface FactInput {
  readonly fact: string;
  readonly provenance: string;
  readonly entity: string | null;
  readonly kind: string;
}

/** A link between pages; `type: null` means no type. */
export interface LinkInput {
  readonly from: string;
  readonly to: string;
  readonly type: string | null;
}

/** Memory entries: events and facts on existing pages, facts with no entity, links. */
export interface GbrainPlanter {
  addTimelineEntry(entry: TimelineInput): Promise<void>;
  /** Returns the id of the fact in GBrain. */
  remember(fact: FactInput): Promise<string>;
  addLink(link: LinkInput): Promise<void>;
}

/** Everything the App, the gate and the operator do with GBrain: each takes only what it needs. */
export type GbrainStore = GbrainPort & GbrainInspector & GbrainPlanter;

const contentSchema = z.array(z.looseObject({ type: z.string(), text: z.string().optional() }));

/** Returns the text of a tool's answer; non-text blocks are ignored. */
function textOf(content: unknown): string {
  const parsed = contentSchema.safeParse(content);

  return parsed.success ? parsed.data.map((block) => block.text ?? '').join('\n') : '';
}

/**
 * GBrain's answer that a tool refused: the answer text is kept, and refusals are told apart by
 * that text.
 */
export class GbrainToolError extends AppError {
  constructor(
    tool: string,
    readonly text: string,
  ) {
    super(`gbrain ${tool}: ${text}`);
  }
}

/**
 * The request did not reach GBrain or got no answer in time: a failure, not an answer to the
 * question.
 */
export class GbrainCallError extends AppError {}

/** The read reached the answer limit: an incomplete list would produce a false “nothing lost”. */
export class GbrainReadIncompleteError extends AppError {}

/**
 * Checks whether the error is a tool refusal from GBrain (not a connection failure). A tool
 * refusal is how GBrain rejects what it does not accept.
 */
export const isRefusal = (error: unknown): boolean => error instanceof GbrainToolError;

/**
 * Checks whether the error is the answer “no such page”. That answer is not a read failure but an
 * answer to the question.
 */
const isMissingPage = (error: unknown): boolean =>
  error instanceof GbrainToolError && error.text.includes('page_not_found');

/** Treats a list that did not reach the limit as complete. */
function complete<T>(rows: T[], what: string): T[] {
  if (rows.length >= READ_LIMIT) {
    throw new GbrainReadIncompleteError(
      `${what} has ${rows.length} rows, the limit of one read: the rest may be unread`,
    );
  }

  return rows;
}

/**
 * The App's GBrain client. The memory entries the system makes on its own behalf, the gate's
 * reads of what its runs left and the operator command all use this one App client,
 * `client_credentials` (`docs/2-system.md` § “Integration contract GBrain”).
 *
 * The client opens one connection per operation, not one for the whole session, because a gate
 * scenario with `--manual` lasts hours and the token's lifetime is much shorter. A failure is
 * named by its tool because “Request timed out” alone does not say which request got no answer.
 */
export class GbrainClient implements GbrainPort, GbrainInspector, GbrainPlanter {
  constructor(
    private readonly open: () => Promise<Transport>,
    private readonly timeouts: Timeouts = { readMs: READ_TIMEOUT_MS, writeMs: WRITE_TIMEOUT_MS },
  ) {}

  static of(token: GbrainToken, config: Pick<RunnerConfig, 'gbrainMcpUrl'>): GbrainClient {
    return new GbrainClient(async () => {
      const url = required(config.gbrainMcpUrl, 'RUNNER_GBRAIN_MCP_URL');
      const bearer = await token.accessToken(TOKEN_VALID_MS);

      return new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
      });
    });
  }

  /** `deadline` aborts the wait for the write. */
  async putPage(slug: string, content: string, deadline?: AbortSignal): Promise<void> {
    await this.call('put_page', { slug, content }, this.timeouts.writeMs, deadline);
  }

  /** A page that does not exist has nothing to delete, so its absence is not a cleanup failure. */
  async deletePage(slug: string): Promise<void> {
    try {
      await this.call('delete_page', { slug }, this.timeouts.writeMs);
    } catch (error) {
      if (isMissingPage(error)) return;

      throw error;
    }
  }

  search(text: string): Promise<string> {
    return this.call('search', { query: text }, this.timeouts.readMs);
  }

  async searchHits(text: string, types: readonly string[]): Promise<SearchHit[]> {
    return parseSearchHits(
      await this.call('search', { query: text, types: [...types] }, this.timeouts.readMs),
    );
  }

  async getPage(slug: string): Promise<PageRead | null> {
    try {
      return parsePage(await this.call('get_page', { slug }, this.timeouts.readMs));
    } catch (error) {
      if (isMissingPage(error)) return null;

      throw error;
    }
  }

  async getTimeline(slug: string): Promise<TimelineEntry[]> {
    return complete(
      parseTimeline(
        await this.call('get_timeline', { slug, limit: READ_LIMIT }, this.timeouts.readMs),
      ),
      `the timeline of ${slug}`,
    );
  }

  async facts(entity: string): Promise<FactRead[]> {
    return complete(
      parseFacts(await this.call('recall', { entity, limit: READ_LIMIT }, this.timeouts.readMs)),
      `the facts about ${entity}`,
    );
  }

  /**
   * Lists all pages of a type, `READ_LIMIT` per request. The pages come in slug order, which does
   * not shift while pages are written. A server that ignores `offset` would return the same page
   * of results again and the loop would never end, so that case is reported as an error.
   */
  async listPages(type: string): Promise<PageSummary[]> {
    const pages = new Map<string, PageSummary>();

    for (;;) {
      const batch = parsePageList(
        await this.call(
          'list_pages',
          { type, limit: READ_LIMIT, offset: pages.size, sort: 'slug' },
          this.timeouts.readMs,
        ),
      );
      const known = pages.size;

      for (const page of batch) pages.set(page.slug, page);

      if (batch.length < READ_LIMIT) return [...pages.values()];

      if (pages.size === known) {
        throw new GbrainReadIncompleteError(
          `the list of ${type} pages did not move past ${known} rows: the server ignores the offset`,
        );
      }
    }
  }

  async addTimelineEntry(entry: TimelineInput, deadline?: AbortSignal): Promise<void> {
    await this.call('add_timeline_entry', { ...entry }, this.timeouts.writeMs, deadline);
  }

  async remember(fact: FactInput, deadline?: AbortSignal): Promise<string> {
    const { entity, ...rest } = fact;
    const answer = await this.call(
      'remember',
      { ...rest, ...(entity === null ? {} : { entity }) },
      this.timeouts.writeMs,
      deadline,
    );

    return parseRemembered(answer).id;
  }

  async addLink(link: LinkInput): Promise<void> {
    await this.call(
      'add_link',
      { from: link.from, to: link.to, ...(link.type === null ? {} : { link_type: link.type }) },
      this.timeouts.writeMs,
    );
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    deadline?: AbortSignal,
  ): Promise<string> {
    const client = new Client({ name: 'personal-management-system-app', version: '1.0.0' });

    try {
      await client.connect(await this.open(), { timeout: this.timeouts.readMs, signal: deadline });

      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: timeoutMs,
        signal: deadline,
      });
      const text = textOf(result.content);

      if (result.isError === true) throw new GbrainToolError(name, text);

      return text;
    } catch (error) {
      if (error instanceof GbrainToolError) throw error;

      throw new GbrainCallError(`gbrain ${name}: ${messageOf(error)}`, { cause: error });
    } finally {
      await client.close();
    }
  }
}
