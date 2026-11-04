import { z } from 'zod';
import { canonicalNotionId } from '../../src/notion/client/notion-id';

/**
 * What a run read in Notion, taken from the attempt stream the runner hands to the gate
 * (`RunTap`). The run trace holds only call metadata (`GAP-07`), while the gate needs the input,
 * the response and the time. They show whether the run loaded too much (a review that reads the
 * whole backlog), how much of the Notion MCP query allowance the run spent and whether Notion
 * refused the run.
 */

/**
 * The mode of a data source query: `sql` and `rows` share the workspace allowance, `view` does not.
 */
type QueryMode = 'sql' | 'rows' | 'view';

export interface NotionRead {
  /** The name of the Notion MCP tool without the server prefix (`notion-fetch`). */
  readonly tool: string;
  /** The mode of a data source query; `null` means the call is not a data source query. */
  readonly mode: QueryMode | null;
  /** When the response arrived; `null` means the stream provided no time. */
  readonly at: string | null;
  readonly ok: boolean;
  /** Notion refused because the workspace query allowance is exhausted. */
  readonly refused: boolean;
  /**
   * The call spends the workspace query allowance: an `sql` or `rows` query, a multi-source query
   * and a query whose mode is not recognized. The last two are counted conservatively.
   */
  readonly metered: boolean;
  /**
   * The pages the call returned (canonical ids): query rows, search results, the opened page. Ids
   * merely mentioned in the page content are not included. `null` means the response was not
   * parsed, so no conclusion “nothing was returned” can be drawn from it.
   */
  readonly pages: readonly string[] | null;
  /**
   * The databases the call addressed (canonical ids). An unparsed response leaves unknown only the
   * pages of these databases. `null` means the call does not say which database it addressed
   * (search).
   */
  readonly dataSources: readonly string[] | null;
}

/** The prefix of the Notion MCP tools in a run. */
const NOTION_PREFIX = 'mcp__notion__';

/** The text of Notion's refusal for an exhausted workspace query allowance. */
const ALLOWANCE_REFUSAL = 'Query Data Source allowance';

const toolUseSchema = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

const assistantSchema = z.looseObject({
  type: z.literal('assistant'),
  message: z.looseObject({ content: z.array(z.unknown()) }),
});

const textPartSchema = z.looseObject({ type: z.string(), text: z.string().optional() });

const toolResultSchema = z.looseObject({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  is_error: z.boolean().optional(),
  content: z.union([z.string(), z.array(textPartSchema)]).optional(),
});

const userSchema = z.looseObject({
  type: z.literal('user'),
  timestamp: z.string().optional(),
  message: z.looseObject({ content: z.union([z.string(), z.array(z.unknown())]) }),
});

const queryInputSchema = z.looseObject({
  data: z
    .looseObject({
      mode: z.string().optional(),
      data_source_urls: z.array(z.string()).optional(),
    })
    .optional(),
});

const fetchInputSchema = z.looseObject({ id: z.string() });

/** The rows of a query or search response: each has the page's `url` or `id`. */
const rowsSchema = z.looseObject({
  results: z.array(z.looseObject({ url: z.string().optional(), id: z.string().optional() })),
});

/** 32 hexadecimal characters at the end of a Notion URL path, or an id with hyphens. */
const PAGE_ID = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?:[?#/]|$)/i;

/**
 * Returns the page id from an id or a Notion URL; `null` means the string names no page (a
 * `collection://` data source).
 */
function pageIdIn(text: string): string | null {
  if (text.startsWith('collection://')) return null;

  const match = PAGE_ID.exec(text);

  return match?.[1] === undefined ? null : canonicalNotionId(match[1]);
}

function textOf(result: z.infer<typeof toolResultSchema>): string {
  const { content } = result;

  if (content === undefined) return '';
  if (typeof content === 'string') return content;

  return content.map((part) => part.text ?? '').join('');
}

function modeOf(tool: string, input: unknown): QueryMode | null {
  if (tool !== 'notion-query-data-sources') return null;

  const mode = queryInputSchema.safeParse(input).data?.data?.mode;

  if (mode === undefined || mode === 'sql') return 'sql';

  return mode === 'rows' || mode === 'view' ? mode : null;
}

function rowsOf(text: string): string[] | null {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = rowsSchema.safeParse(json);

  if (!parsed.success) return null;

  const ids = parsed.data.results.flatMap((row) => {
    const id = pageIdIn(row.id ?? '') ?? pageIdIn(row.url ?? '');

    if (id !== null) return [id];

    // A row of only numbers is a total (`COUNT`, `SUM`): it returns no page. Any other row without
    // a page link (the query did not select `url`) does not say which page was returned.
    return Object.values(row).every((value) => typeof value === 'number' || value === null)
      ? []
      : [null];
  });

  return ids.every((id) => id !== null) ? ids.filter((id): id is string => id !== null) : null;
}

/** Returns the database id from a `collection://<id>` link; `null` means no database is named. */
function dataSourceIn(text: string): string | null {
  const match = /^collection:\/\/([0-9a-f-]{32,36})/i.exec(text);

  return match?.[1] === undefined ? null : canonicalNotionId(match[1]);
}

/** Returns the databases the call addressed; `null` means unspecified. */
function dataSourcesOf(tool: string, input: unknown): readonly string[] | null {
  switch (tool) {
    case 'notion-query-data-sources': {
      const urls = queryInputSchema.safeParse(input).data?.data?.data_source_urls;
      const ids = (urls ?? []).map(dataSourceIn);

      return ids.length > 0 && ids.every((id) => id !== null)
        ? ids.filter((id): id is string => id !== null)
        : null;
    }

    case 'notion-search':
    case 'notion-query-multiple-data-sources':
      return null;

    case 'notion-fetch': {
      const id = fetchInputSchema.safeParse(input).data?.id;

      if (id === undefined) return null;

      const source = dataSourceIn(id);

      return source === null ? [] : [source];
    }

    default:
      return [];
  }
}

/** Returns the pages a successful call returned; `null` means the response was not parsed. */
function pagesOf(tool: string, input: unknown, text: string): readonly string[] | null {
  switch (tool) {
    case 'notion-query-data-sources':
    case 'notion-search':
      return rowsOf(text);

    case 'notion-fetch': {
      const parsed = fetchInputSchema.safeParse(input);

      if (!parsed.success) return null;

      const id = pageIdIn(parsed.data.id);

      return id === null ? [] : [id];
    }

    default:
      return [];
  }
}

/** Returns the Notion reads of a run, in the order of the responses. */
export function notionReadsOf(transcript: readonly unknown[]): NotionRead[] {
  const uses = new Map<string, { readonly tool: string; readonly input: unknown }>();
  const reads: NotionRead[] = [];

  for (const message of transcript) {
    const assistant = assistantSchema.safeParse(message);

    if (assistant.success) {
      for (const part of assistant.data.message.content) {
        const use = toolUseSchema.safeParse(part);

        if (use.success && use.data.name.startsWith(NOTION_PREFIX)) {
          uses.set(use.data.id, {
            tool: use.data.name.slice(NOTION_PREFIX.length),
            input: use.data.input,
          });
        }
      }

      continue;
    }

    const user = userSchema.safeParse(message);

    if (!user.success || typeof user.data.message.content === 'string') continue;

    for (const part of user.data.message.content) {
      const result = toolResultSchema.safeParse(part);
      const use = result.success ? uses.get(result.data.tool_use_id) : undefined;

      if (!result.success || use === undefined) continue;

      const text = textOf(result.data);
      const ok = result.data.is_error !== true;
      const mode = modeOf(use.tool, use.input);

      reads.push({
        tool: use.tool,
        mode,
        at: user.data.timestamp ?? null,
        ok,
        refused: !ok && text.includes(ALLOWANCE_REFUSAL),
        metered:
          use.tool === 'notion-query-multiple-data-sources' ||
          (use.tool === 'notion-query-data-sources' && mode !== 'view'),
        pages: ok ? pagesOf(use.tool, use.input, text) : [],
        dataSources: dataSourcesOf(use.tool, use.input),
      });
    }
  }

  return reads;
}
