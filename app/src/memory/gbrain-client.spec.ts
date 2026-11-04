import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { GbrainClient, GbrainReadIncompleteError, isRefusal, READ_LIMIT } from './gbrain-client';

const NOTION_ID = 'a0865184-6cda-69f0-e8e0-3884c8610ce5';
const NAMED = '[{"slug":"projects/a","title":"x"}]';

interface Reply {
  /** The answer; a function receives the call's arguments (for lists that come in pages). */
  readonly text: string | ((args: Readonly<Record<string, unknown>>) => string);
  readonly isError?: boolean;
  readonly hang?: boolean;
}

/**
 * Creates a fake in-memory GBrain. It records what it was sent and answers with `reply`, or stays
 * silent if `hang`.
 */
function fakeGbrain(reply: Reply): {
  calls: { tool: string; args: Readonly<Record<string, unknown>> }[];
  open: () => Promise<Transport>;
} {
  const calls: { tool: string; args: Readonly<Record<string, unknown>> }[] = [];
  const respond = (
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<CallToolResult> => {
    calls.push({ tool, args });

    return reply.hang
      ? new Promise(() => undefined)
      : Promise.resolve({
          content: [
            {
              type: 'text',
              text: typeof reply.text === 'string' ? reply.text : reply.text(args),
            },
          ],
          ...(reply.isError ? { isError: true } : {}),
        });
  };
  const tools: Readonly<Record<string, z.ZodRawShape>> = {
    put_page: { slug: z.string(), content: z.string() },
    search: { query: z.string(), types: z.array(z.string()).optional() },
    delete_page: { slug: z.string() },
    get_page: { slug: z.string() },
    get_timeline: { slug: z.string(), limit: z.number().optional() },
    recall: { entity: z.string(), limit: z.number().optional() },
    list_pages: {
      type: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      sort: z.string().optional(),
    },
    add_timeline_entry: {
      slug: z.string(),
      date: z.string(),
      summary: z.string(),
      source: z.string(),
    },
    remember: {
      fact: z.string(),
      provenance: z.string(),
      entity: z.string().optional(),
      kind: z.string(),
    },
    add_link: { from: z.string(), to: z.string(), link_type: z.string().optional() },
  };

  return {
    calls,
    open: async () => {
      const server = new McpServer({ name: 'fake-gbrain', version: '1.0.0' });

      for (const [name, inputSchema] of Object.entries(tools)) {
        server.registerTool(name, { inputSchema: z.object(inputSchema) }, (args) =>
          respond(name, args),
        );
      }

      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();

      await server.connect(serverSide);

      return clientSide;
    },
  };
}

describe('GbrainClient: writing and cleanup', () => {
  it('writes a page with the `put_page` tool, passing the slug and the content', async () => {
    const gbrain = fakeGbrain({ text: '{"status":"created"}' });

    await new GbrainClient(gbrain.open).putPage('projects/a', '# a');

    expect(gbrain.calls).toEqual([
      { tool: 'put_page', args: { slug: 'projects/a', content: '# a' } },
    ]);
  });

  it('deletes a page with the `delete_page` tool, passing the slug', async () => {
    const gbrain = fakeGbrain({ text: '{"status":"deleted"}' });

    await new GbrainClient(gbrain.open).deletePage('projects/a');

    expect(gbrain.calls).toEqual([{ tool: 'delete_page', args: { slug: 'projects/a' } }]);
  });

  it('deleting a page that does not exist is not a failure', async () => {
    const gbrain = fakeGbrain({ text: '{"error":"page_not_found"}', isError: true });

    await expect(new GbrainClient(gbrain.open).deletePage('projects/a')).resolves.toBeUndefined();
  });

  it('any other refusal to delete stays a failure', async () => {
    const gbrain = fakeGbrain({ text: '{"error":"scope_denied"}', isError: true });

    await expect(new GbrainClient(gbrain.open).deletePage('projects/a')).rejects.toThrow(
      'gbrain delete_page: {"error":"scope_denied"}',
    );
  });

  it('an error answer from a tool becomes an exception with the answer text', async () => {
    const gbrain = fakeGbrain({ text: 'slug is not allowed', isError: true });

    await expect(new GbrainClient(gbrain.open).putPage('projects/a', '# a')).rejects.toThrow(
      'gbrain put_page: slug is not allowed',
    );
  });

  /** Without the tool name, “Request timed out” does not say which request got no answer. */
  it('the error for a request that got no answer names its tool', async () => {
    const gbrain = fakeGbrain({ text: '', hang: true });
    const client = new GbrainClient(gbrain.open, { readMs: 50, writeMs: 50 });

    await expect(client.putPage('projects/a', '# a')).rejects.toThrow(
      /gbrain put_page: .*timed out/i,
    );
  });

  it('the deadline aborts a write that is waiting for an answer', async () => {
    const gbrain = fakeGbrain({ text: '', hang: true });
    const deadline = new AbortController();
    const writing = new GbrainClient(gbrain.open).addTimelineEntry(
      { slug: 'projects/a', date: '2026-10-14', summary: 'Decision: так', source: 'Розмова' },
      deadline.signal,
    );

    deadline.abort(new Error('the run reached its deadline'));

    await expect(writing).rejects.toThrow(
      'gbrain add_timeline_entry: the run reached its deadline',
    );
  });
});

describe('GbrainClient: search', () => {
  it('search by text passes `query` and returns the answer text', async () => {
    const gbrain = fakeGbrain({ text: NAMED });

    await expect(new GbrainClient(gbrain.open).search(NOTION_ID)).resolves.toBe(NAMED);
    expect(gbrain.calls).toEqual([{ tool: 'search', args: { query: NOTION_ID } }]);
  });

  it('search among types passes `types` and parses the answer', async () => {
    const gbrain = fakeGbrain({
      text: '[{"slug":"projects/a","title":"A","type":"project","evidence":"keyword_exact"}]',
    });

    await expect(
      new GbrainClient(gbrain.open).searchHits(NOTION_ID, ['project', 'area_of_focus']),
    ).resolves.toEqual([
      { slug: 'projects/a', title: 'A', type: 'project', evidence: 'keyword_exact' },
    ]);
    expect(gbrain.calls).toEqual([
      { tool: 'search', args: { query: NOTION_ID, types: ['project', 'area_of_focus'] } },
    ]);
  });
});

describe('GbrainClient: reading state', () => {
  const PAGE = JSON.stringify({
    slug: 'projects/a',
    type: 'project',
    title: 'A',
    compiled_truth: '# A',
    timeline: '',
    frontmatter: {},
    deleted_at: null,
  });

  it('reads a page, and returns `null` for a page that does not exist', async () => {
    await expect(
      new GbrainClient(fakeGbrain({ text: PAGE }).open).getPage('projects/a'),
    ).resolves.toMatchObject({ slug: 'projects/a', deleted: false });
    await expect(
      new GbrainClient(
        fakeGbrain({ text: '{"error":"page_not_found"}', isError: true }).open,
      ).getPage('projects/a'),
    ).resolves.toBeNull();
  });

  it('a page read failure other than “no such page” stays a failure', async () => {
    const gbrain = fakeGbrain({ text: '{"error":"scope_denied"}', isError: true });

    await expect(new GbrainClient(gbrain.open).getPage('projects/a')).rejects.toThrow(
      'gbrain get_page',
    );
  });

  it('reads events, facts and the list of pages by type', async () => {
    const timeline = fakeGbrain({
      text: '[{"date":"2026-10-13T00:00:00.000Z","source":"s","summary":"x","detail":""}]',
    });
    const facts = fakeGbrain({
      text: '{"facts":[{"fact":"f","kind":"fact","entity_slug":"projects/a","provenance":"p"}]}',
    });
    const pages = fakeGbrain({ text: '[{"slug":"projects/a","type":"project","title":"A"}]' });

    await expect(new GbrainClient(timeline.open).getTimeline('projects/a')).resolves.toHaveLength(
      1,
    );
    await expect(new GbrainClient(facts.open).facts('projects/a')).resolves.toHaveLength(1);
    await expect(new GbrainClient(pages.open).listPages('project')).resolves.toEqual([
      { slug: 'projects/a', type: 'project', title: 'A' },
    ]);
    expect(pages.calls).toEqual([
      { tool: 'list_pages', args: { type: 'project', limit: READ_LIMIT, offset: 0, sort: 'slug' } },
    ]);
  });

  it('a list longer than one request is read in pages until a short one arrives', async () => {
    const rows = (from: number, count: number): string =>
      JSON.stringify(
        Array.from({ length: count }, (_, index) => ({
          slug: `projects/p${from + index}`,
          type: 'project',
          title: 'P',
        })),
      );
    const gbrain = fakeGbrain({
      text: (args) => (args['offset'] === 0 ? rows(0, READ_LIMIT) : rows(READ_LIMIT, 3)),
    });

    await expect(new GbrainClient(gbrain.open).listPages('project')).resolves.toHaveLength(
      READ_LIMIT + 3,
    );
    expect(gbrain.calls.map((call) => call.args['offset'])).toEqual([0, READ_LIMIT]);
  });

  it('a server that ignores the offset does not let the list run on forever', async () => {
    const full = JSON.stringify(
      Array.from({ length: READ_LIMIT }, (_, index) => ({
        slug: `projects/p${index}`,
        type: 'project',
        title: 'P',
      })),
    );
    const gbrain = fakeGbrain({ text: full });

    await expect(new GbrainClient(gbrain.open).listPages('project')).rejects.toThrow(
      GbrainReadIncompleteError,
    );
    expect(gbrain.calls).toHaveLength(2);
  });

  it('events and facts that reached the answer limit are not taken as complete', async () => {
    const timeline = fakeGbrain({
      text: JSON.stringify(
        Array.from({ length: READ_LIMIT }, () => ({
          date: '2026-10-13',
          source: 's',
          summary: 'x',
          detail: '',
        })),
      ),
    });
    const facts = fakeGbrain({
      text: JSON.stringify({
        facts: Array.from({ length: READ_LIMIT }, () => ({
          fact: 'f',
          kind: 'fact',
          entity_slug: 'projects/a',
          provenance: 'p',
        })),
      }),
    });

    await expect(new GbrainClient(timeline.open).getTimeline('projects/a')).rejects.toThrow(
      GbrainReadIncompleteError,
    );
    await expect(new GbrainClient(facts.open).facts('projects/a')).rejects.toThrow(
      GbrainReadIncompleteError,
    );
  });
});

describe('GbrainClient: refusal and failure', () => {
  it('tells a tool refusal from a connection failure', async () => {
    const refusing = fakeGbrain({ text: '{"error":"unknown_link_type"}', isError: true });
    const silent = fakeGbrain({ text: '', hang: true });
    const refusal: unknown = await new GbrainClient(refusing.open)
      .addLink({ from: 'projects/a', to: 'lessons/b', type: 'invented' })
      .catch((error: unknown) => error);
    const failure: unknown = await new GbrainClient(silent.open, { readMs: 50, writeMs: 50 })
      .addLink({ from: 'projects/a', to: 'lessons/b', type: 'derived_from' })
      .catch((error: unknown) => error);

    expect(isRefusal(refusal)).toBe(true);
    expect(isRefusal(failure)).toBe(false);
    expect(failure).toBeInstanceOf(Error);
  });
});

describe('GbrainClient: scenario memory writes', () => {
  it('adds a timeline event, a fact about a page and a link', async () => {
    const gbrain = fakeGbrain({ text: '{"id":"7","status":"inserted"}' });
    const client = new GbrainClient(gbrain.open);

    await client.addTimelineEntry({
      slug: 'projects/a',
      date: '2026-10-13',
      summary: 'Kickoff',
      source: 's',
    });

    const id: string = await client.remember({
      fact: 'f',
      provenance: 'p',
      entity: 'projects/a',
      kind: 'fact',
    });

    await client.addLink({ from: 'projects/a', to: 'lessons/b', type: 'derived_from' });
    await client.addLink({ from: 'projects/a', to: 'lessons/c', type: null });

    expect(id).toBe('7');
    expect(gbrain.calls.map((call) => call.tool)).toEqual([
      'add_timeline_entry',
      'remember',
      'add_link',
      'add_link',
    ]);
    expect(gbrain.calls[2]?.args).toEqual({
      from: 'projects/a',
      to: 'lessons/b',
      link_type: 'derived_from',
    });
    expect(gbrain.calls[3]?.args).toEqual({ from: 'projects/a', to: 'lessons/c' });
  });

  it('a fact with no entity is sent without the `entity` field', async () => {
    const gbrain = fakeGbrain({ text: '{"id":"8","status":"inserted"}' });
    const client = new GbrainClient(gbrain.open);

    await client.remember({ fact: 'f', provenance: 'p', entity: null, kind: 'fact' });

    expect(gbrain.calls[0]?.args).toEqual({ fact: 'f', provenance: 'p', kind: 'fact' });
  });
});
