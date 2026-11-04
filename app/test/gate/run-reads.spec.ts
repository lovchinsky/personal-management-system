import { notionReadsOf } from './run-reads';

const PAGE = 'f6ae5ebc-ec61-f49f-e0ac-a9cc1cc82284';
const OTHER = '7946ba64-8051-f095-5063-392bd169f5d5';

/** Builds a tool call in the attempt stream together with the response to it. */
function call(
  name: string,
  input: unknown,
  result: string,
  options: { readonly error?: boolean; readonly at?: string } = {},
): unknown[] {
  const id = `use-${name}-${JSON.stringify(input).length}`;

  return [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } },
    {
      type: 'user',
      ...(options.at === undefined ? {} : { timestamp: options.at }),
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            ...(options.error ? { is_error: true } : {}),
            content: [{ type: 'text', text: result }],
          },
        ],
      },
    },
  ];
}

const rows = (...ids: string[]): string =>
  JSON.stringify({
    results: ids.map((id) => ({ url: `https://app.notion.com/${id.replaceAll('-', '')}` })),
    has_more: false,
  });

describe('notionReadsOf', () => {
  it('an sql query is metered; the returned rows are pages; the time comes from the response', () => {
    const [read] = notionReadsOf(
      call(
        'mcp__notion__notion-query-data-sources',
        {
          data: {
            mode: 'sql',
            data_source_urls: ['collection://b9ad9af9-77a7-e3f6-5d11-94aa9e563257'],
            query: 'SELECT url',
          },
        },
        rows(PAGE, OTHER),
        { at: '2026-10-21T08:00:00.000Z' },
      ),
    );

    expect(read).toEqual({
      tool: 'notion-query-data-sources',
      mode: 'sql',
      at: '2026-10-21T08:00:00.000Z',
      ok: true,
      refused: false,
      metered: true,
      pages: [PAGE, OTHER],
      dataSources: ['b9ad9af9-77a7-e3f6-5d11-94aa9e563257'],
    });
  });

  /** An unparsed response leaves unknown only the pages of the database the call addressed. */
  it('the databases of a call: for a query, those in its links; for an opened database, itself; for a search, unknown', () => {
    const reads = notionReadsOf([
      ...call(
        'mcp__notion__notion-query-data-sources',
        {
          data: {
            mode: 'sql',
            data_source_urls: ['collection://b9ad9af9-77a7-e3f6-5d11-94aa9e563257'],
          },
        },
        rows(PAGE),
      ),
      ...call(
        'mcp__notion__notion-fetch',
        { id: 'collection://b9ad9af9-77a7-e3f6-5d11-94aa9e563257' },
        '{"text":""}',
      ),
      ...call('mcp__notion__notion-fetch', { id: PAGE }, '{"text":""}'),
      ...call('mcp__notion__notion-search', { query: 'x' }, rows(PAGE)),
    ]);

    expect(reads.map((read) => read.dataSources)).toEqual([
      ['b9ad9af9-77a7-e3f6-5d11-94aa9e563257'],
      ['b9ad9af9-77a7-e3f6-5d11-94aa9e563257'],
      [],
      null,
    ]);
  });

  it('the default mode is `sql`; `rows` is metered too; `view` is not', () => {
    const reads = notionReadsOf([
      ...call('mcp__notion__notion-query-data-sources', { data: { query: 'SELECT url' } }, rows()),
      ...call('mcp__notion__notion-query-data-sources', { data: { mode: 'rows' } }, rows(PAGE)),
      ...call('mcp__notion__notion-query-data-sources', { data: { mode: 'view' } }, rows(OTHER)),
    ]);

    expect(reads.map((read) => [read.mode, read.metered])).toEqual([
      ['sql', true],
      ['rows', true],
      ['view', false],
    ]);
  });

  /**
   * A mode the parsing does not know is counted on the safe side, because it may have taken
   * allowance.
   */
  it('an unknown mode and a multi-source query are metered', () => {
    const reads = notionReadsOf([
      ...call('mcp__notion__notion-query-data-sources', { data: { mode: 'graph' } }, rows()),
      ...call('mcp__notion__notion-query-multiple-data-sources', {}, 'Try the full version', {
        error: true,
      }),
    ]);

    expect(reads.map((read) => [read.mode, read.metered, read.refused])).toEqual([
      [null, true, false],
      [null, true, false],
    ]);
  });

  it('a refusal for an exhausted allowance is `refused` and has no pages', () => {
    const [read] = notionReadsOf(
      call(
        'mcp__notion__notion-query-data-sources',
        { data: { mode: 'sql' } },
        'Your workspace has used up its Query Data Source allowance for SQL and rows-mode queries.',
        { error: true },
      ),
    );

    expect(read).toMatchObject({ ok: false, refused: true, metered: true, pages: [] });
  });

  it('the opened page is the one the call named; a data source is not a page', () => {
    const reads = notionReadsOf([
      ...call(
        'mcp__notion__notion-fetch',
        { id: `https://app.notion.com/p/${PAGE.replaceAll('-', '')}` },
        '{}',
      ),
      ...call(
        'mcp__notion__notion-fetch',
        { id: 'collection://d506ebca-5430-4925-3b55-7ea65f344d66' },
        '{}',
      ),
    ]);

    expect(reads.map((read) => read.pages)).toEqual([[PAGE], []]);
  });

  it('search returns the pages of its results', () => {
    const [read] = notionReadsOf(
      call(
        'mcp__notion__notion-search',
        { query: 'x' },
        JSON.stringify({ results: [{ id: PAGE, url: 'https://app.notion.com/p/x' }] }),
      ),
    );

    expect(read?.pages).toEqual([PAGE]);
  });

  /** No conclusion “nothing was returned” can be drawn from a response that was not parsed. */
  it('an unparsed query response means unknown pages', () => {
    const [read] = notionReadsOf(
      call('mcp__notion__notion-query-data-sources', { data: {} }, 'not json'),
    );

    expect(read?.pages).toBeNull();
  });

  /** A query that did not select `url` does not say which pages it returned. */
  it('rows without a page link mean unknown pages', () => {
    const [read] = notionReadsOf(
      call(
        'mcp__notion__notion-query-data-sources',
        { data: { mode: 'sql' } },
        JSON.stringify({ results: [{ Name: 'Задача', Status: 'Done' }] }),
      ),
    );

    expect(read?.pages).toBeNull();
  });

  /**
   * `SELECT COUNT(*)` counts pages and does not return them, so a review that counts the stale
   * ones loaded nothing.
   */
  it('a total row of only numbers returns no pages', () => {
    const [read] = notionReadsOf(
      call(
        'mcp__notion__notion-query-data-sources',
        { data: { mode: 'sql' } },
        JSON.stringify({ results: [{ stale: 2, total: 3, fresh: null }], has_more: false }),
      ),
    );

    expect(read?.pages).toEqual([]);
  });

  it('page comments return no pages, and tools outside Notion are not counted', () => {
    const reads = notionReadsOf([
      ...call('mcp__notion__notion-get-comments', { page_id: PAGE }, '{"text":"<discussions/>"}'),
      ...call('mcp__app__get_runtime_state', {}, '{}'),
    ]);

    expect(reads).toEqual([expect.objectContaining({ tool: 'notion-get-comments', pages: [] })]);
  });
});
