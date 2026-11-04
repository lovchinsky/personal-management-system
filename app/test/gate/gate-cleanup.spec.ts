import { cleanupVerdict, emptyResidue, GateCleanup, pagesOutside, UNMANAGED } from './gate-cleanup';

const DASHED = '0f1e2d3c-4b5a-4968-8776-655443322110';
const COMPACT = '0f1e2d3c4b5a49688776655443322110';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('pagesOutside', () => {
  const residue = { ...emptyResidue(), pages: [DASHED] };

  it('a gate page in both spellings is its own', () => {
    expect(pagesOutside(residue, [DASHED, COMPACT])).toEqual([]);
  });

  it('a foreign page is returned', () => {
    expect(pagesOutside(residue, [DASHED, OTHER])).toEqual([OTHER]);
  });

  it("without gate pages no page is the gate's own", () => {
    expect(pagesOutside(emptyResidue(), [DASHED])).toEqual([DASHED]);
  });
});

describe('cleanupVerdict', () => {
  it('empty residue is clean, and what the gate cannot clean up is always named', () => {
    expect(cleanupVerdict([])).toEqual({ clean: true, left: [], unmanaged: UNMANAGED });
    expect(UNMANAGED.length).toBeGreaterThan(0);
  });

  it('any residue means not clean', () => {
    expect(cleanupVerdict(['page x: boom']).clean).toBe(false);
  });
});

/** Builds witness ports: a log of calls in order, and failures by step name. */
function ports(options: { fail?: readonly string[]; trashed?: readonly string[] } = {}): {
  calls: string[];
  wheres: Map<string, unknown>;
  cleanup: GateCleanup;
} {
  const calls: string[] = [];
  const wheres = new Map<string, unknown>();
  const failing = new Set(options.fail ?? []);
  const deleting = (
    name: string,
  ): { deleteMany: (args: { where: unknown }) => Promise<unknown> } => ({
    deleteMany: ({ where }) => {
      calls.push(name);
      wheres.set(name, where);

      return failing.has(name) ? Promise.reject(new Error(`${name} failed`)) : Promise.resolve({});
    },
  });

  const cleanup = new GateCleanup({
    outbox: deleting('outbox'),
    continuations: deleting('continuations'),
    windows: deleting('windows'),
    proposals: deleting('proposals'),
    occurrences: deleting('occurrences'),
    discussions: deleting('discussions'),
    sweepMarks: deleting('sweep marks'),
    reconciliations: deleting('reconciliations'),
    gbrain: {
      deletePage: (slug) => {
        calls.push(`gbrain ${slug}`);

        return failing.has(`gbrain ${slug}`)
          ? Promise.reject(new Error('GBrain is down'))
          : Promise.resolve();
      },
    },
    inTrash: (id) => Promise.resolve(options.trashed?.includes(id) ?? false),
    trash: (id) => {
      calls.push(`trash ${id}`);

      return failing.has(`trash ${id}`)
        ? Promise.reject(new Error('Notion is down'))
        : Promise.resolve();
    },
  });

  return { calls, wheres, cleanup };
}

describe('GateCleanup', () => {
  const residue = { ...emptyResidue(), pages: ['p1', 'p2'], threads: ['t1'], runs: ['r1'] };

  it('cleans up first what is dangerous for the main system, then Notion, and hygiene last', async () => {
    const { calls, cleanup } = ports();

    expect(await cleanup.clean(residue)).toEqual([]);
    expect(calls).toEqual([
      'outbox',
      'continuations',
      'windows',
      'proposals',
      'occurrences',
      'trash p1',
      'trash p2',
      'discussions',
      'sweep marks',
      'reconciliations',
    ]);
  });

  /**
   * The deletion condition is the only thing that separates the attempt's rows from the rest of
   * the gate database. An empty register selects nothing, and a full one only its own.
   */
  it('an empty register selects no row', async () => {
    const { wheres, cleanup } = ports();

    await cleanup.clean(emptyResidue());

    expect(Object.fromEntries(wheres)).toEqual({
      outbox: {
        OR: [{ idempotencyKey: { in: [] } }, { discussionId: { in: [] } }, { id: { in: [] } }],
      },
      continuations: {
        OR: [{ discussionId: { in: [] } }, { notionPageId: { in: [] } }, { id: { in: [] } }],
      },
      windows: { OR: [{ pageId: { in: [] } }, { discussionId: { in: [] } }] },
      proposals: {
        OR: [{ proposedByRunId: { in: [] } }, { discussionId: { in: [] } }, { id: { in: [] } }],
      },
      occurrences: { id: { in: [] } },
      discussions: { OR: [{ discussionId: { in: [] } }, { pageId: { in: [] } }] },
      'sweep marks': { pageId: { in: [] } },
      reconciliations: { discussionId: { in: [] } },
    });
  });

  it('the register selects only its own rows, with ids both as recorded and in canonical form', async () => {
    const { wheres, cleanup } = ports();
    const own = {
      ...emptyResidue(),
      pages: [COMPACT],
      threads: [COMPACT],
      runs: ['run-1'],
      outboxKeys: ['key-1'],
      deliveries: ['delivery-1'],
      continuations: ['check-1'],
      proposals: ['proposal-1'],
      occurrences: ['occurrence-1'],
    };
    const both = [COMPACT, DASHED];

    await cleanup.clean(own);

    expect(Object.fromEntries(wheres)).toEqual({
      outbox: {
        OR: [
          { idempotencyKey: { in: ['key-1'] } },
          { discussionId: { in: both } },
          { id: { in: ['delivery-1'] } },
        ],
      },
      continuations: {
        OR: [
          { discussionId: { in: both } },
          { notionPageId: { in: both } },
          { id: { in: ['check-1'] } },
        ],
      },
      windows: { OR: [{ pageId: { in: both } }, { discussionId: { in: both } }] },
      proposals: {
        OR: [
          { proposedByRunId: { in: ['run-1'] } },
          { discussionId: { in: both } },
          { id: { in: ['proposal-1'] } },
        ],
      },
      occurrences: { id: { in: ['occurrence-1'] } },
      discussions: { OR: [{ discussionId: { in: both } }, { pageId: { in: both } }] },
      'sweep marks': { pageId: { in: both } },
      reconciliations: { discussionId: { in: both } },
    });
  });

  /** A GBrain page that the gate wrote is deleted last; nothing foreign or extra is touched. */
  it('a GBrain page from the register is deleted after Notion, threads, and the sweep and reconciliation memory', async () => {
    const { calls, cleanup } = ports();

    await cleanup.clean({ ...residue, gbrainPages: ['projects/gate-m5-fixture'] });

    expect(calls.at(-2)).toBe('reconciliations');
    expect(calls.at(-1)).toBe('gbrain projects/gate-m5-fixture');
  });

  it('deletes nothing in GBrain without a recorded page', async () => {
    const { calls, cleanup } = ports();

    await cleanup.clean(residue);

    expect(calls.filter((call) => call.startsWith('gbrain'))).toEqual([]);
  });

  it('a second cleanup of the same register does not delete the page again', async () => {
    const { calls, cleanup } = ports();
    const registered = { ...residue, gbrainPages: ['projects/gate-m5-fixture'] };

    await cleanup.clean(registered);
    await cleanup.clean(registered);

    expect(calls.filter((call) => call.startsWith('gbrain'))).toHaveLength(1);
  });

  it('a failure to delete a GBrain page stays in the residue and does not stop the rest', async () => {
    const { calls, cleanup } = ports({ fail: ['gbrain projects/gate-m5-fixture'] });

    expect(await cleanup.clean({ ...residue, gbrainPages: ['projects/gate-m5-fixture'] })).toEqual([
      'gbrain projects/gate-m5-fixture: GBrain is down',
    ]);
    expect(calls).toContain('trash p2');
  });

  it('a step failure does not stop the rest and stays in the residue', async () => {
    const { calls, cleanup } = ports({ fail: ['continuations'] });

    expect(await cleanup.clean(residue)).toEqual(['continuations: continuations failed']);
    expect(calls).toContain('discussions');
    expect(calls).toContain('trash p2');
  });

  it('an unavailable Notion leaves the page in the residue but does not stop the database cleanup', async () => {
    const { calls, cleanup } = ports({ fail: ['trash p1'] });

    expect(await cleanup.clean(residue)).toEqual(['page p1: Notion is down']);
    expect(calls).toEqual(
      expect.arrayContaining(['outbox', 'proposals', 'trash p2', 'discussions']),
    );
  });

  it('a page failure is retried once, not endlessly', async () => {
    const { calls, cleanup } = ports({ fail: ['trash p1'] });

    await cleanup.clean(residue);

    expect(calls.filter((call) => call === 'trash p1')).toHaveLength(2);
  });

  it('does not touch a page that is already in the trash', async () => {
    const { calls, cleanup } = ports({ trashed: ['p1'] });

    await cleanup.clean(residue);

    expect(calls).not.toContain('trash p1');
    expect(calls).toContain('trash p2');
  });

  it('does not throw even when everything fails', async () => {
    const { cleanup } = ports({
      fail: [
        'outbox',
        'continuations',
        'windows',
        'proposals',
        'discussions',
        'trash p1',
        'trash p2',
      ],
    });

    await expect(cleanup.clean(residue)).resolves.toHaveLength(7);
  });
});
