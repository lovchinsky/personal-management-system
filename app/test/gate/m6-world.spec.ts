import { Test } from '@nestjs/testing';
import { Client } from '@notionhq/client';
import type { AttemptView } from '../../src/claude/runner/run-tap';
import { appConfig } from '../../src/config/app.config';
import type { GbrainStore } from '../../src/memory/gbrain-client';
import { PrismaService } from '../../src/platform/db/prisma.service';
import type { TraceView } from '../../src/runs/run-traces';
import { textsOf } from '../../src/texts/texts';
import { FakeGbrain } from '../fixtures/fake-gbrain.fixture';
import {
  BOT,
  effects,
  evidence,
  idOf,
  NOTICE,
  THREAD,
  trace,
  worldOf,
} from '../fixtures/m6-evidence.fixture';
import { HarnessError, InfrastructureError } from './gate-attempts';
import type { Evidence, PageSnapshot, ProposalView } from './gate-claims';
import { emptyResidue } from './gate-cleanup';
import type { Waiting } from './gbrain-fixture';
import { M6World } from './m6-world';
import { NO_MEMORY_STATES } from './memory-evidence';
import { packetLength } from './packet-length';
import { RunViews } from './run-views';
import type { AnchorMemory, PlainMemory } from './scenario-kit';
import type { Ids } from './scenario-world';

const WORLD = worldOf('U1_commitment');
const IDS: Ids = Object.fromEntries(WORLD.map((page) => [page.key, idOf(page.key)]));
const OUTSIDE = 'elsewhere-page';
const QUICK: Waiting = { attempts: 2, pauseMs: 0, sleep: () => Promise.resolve() };

interface Comment {
  readonly id: string;
  readonly page: string;
  readonly discussion?: string;
  readonly text?: string;
  readonly parent?: 'page_id' | 'block_id';
}

/** A Notion comment as `comments.retrieve` returns it. */
function notionComment({
  id,
  page,
  discussion = THREAD,
  text = 'Слово',
  parent = 'page_id',
}: Comment): object {
  return {
    object: 'comment',
    id,
    parent:
      parent === 'page_id'
        ? { type: 'page_id', page_id: page }
        : { type: 'block_id', block_id: page },
    discussion_id: discussion,
    rich_text: [{ plain_text: text }],
    created_by: { id: BOT },
  };
}

interface Rows {
  readonly comments?: readonly object[];
  readonly checks?: readonly object[];
  readonly outbox?: readonly object[];
  /** The proposals the run produced: the evidence base reads them, not the table. */
  readonly proposals?: readonly ProposalView[];
}

/** A world over a fake Notion and `app_db`: a run's effects are expanded from the tables' rows. */
async function worldOver(
  rows: Rows,
  gbrain?: FakeGbrain,
  requested: (boolean | undefined)[] = [],
  seen: Readonly<Record<string, AttemptView>> = {},
): Promise<M6World> {
  const comments = new Map((rows.comments ?? []).map((item) => [Reflect.get(item, 'id'), item]));
  const inList = (where: { id: { in: string[] } }, table: readonly object[]): object[] =>
    table.filter((row) => where.id.in.includes(String(Reflect.get(row, 'id'))));
  const notion = {
    comments: {
      retrieve: ({ comment_id: id }: { comment_id: string }) => {
        const found = comments.get(id);

        return found === undefined
          ? Promise.reject(new Error(`no comment ${id}`))
          : Promise.resolve(found);
      },
    },
  };
  const prisma = {
    scheduledCheck: {
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(inList(where, rows.checks ?? [])),
    },
    notificationOutbox: {
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(inList(where, rows.outbox ?? [])),
    },
  };
  const views = new RunViews({
    appMcpUrl: undefined,
    notionQueryAllowance: 10,
    transcriptsDir: undefined,
  });

  for (const [runId, view] of Object.entries(seen)) views.attempted(runId, view);

  const app = await Test.createTestingModule({
    providers: [
      { provide: Client, useValue: notion },
      { provide: PrismaService, useValue: prisma },
      { provide: RunViews, useValue: views },
      { provide: appConfig.KEY, useValue: { ...appConfig(), language: 'uk' } },
    ],
  }).compile();

  class Probe extends M6World {
    override snapshots(_ids: Ids, withComments?: boolean): Promise<Record<string, PageSnapshot>> {
      requested.push(withComments);

      return Promise.resolve(evidence(WORLD).after);
    }

    protected override evidenceBase(
      step: string,
      run: TraceView,
      before: Record<string, PageSnapshot>,
      after: Record<string, PageSnapshot>,
    ): Promise<Omit<Evidence, 'continuations'>> {
      const given = evidence(WORLD, { step, trace: run, before, after });

      return Promise.resolve({
        step: given.step,
        trace: given.trace,
        before: given.before,
        after: given.after,
        proposals: rows.proposals ?? given.proposals,
        gbrainWrites: given.gbrainWrites,
        bot: given.bot,
        statusProperty: given.statusProperty,
      });
    }

    override gbrain(): GbrainStore {
      if (gbrain === undefined) throw new Error('the test gave no GBrain');

      return gbrain;
    }
  }

  return new Probe(app, 'm6');
}

const run = (...kinds: Parameters<typeof effects>): TraceView =>
  trace({
    runtimeEffects: effects(...kinds).map((effect, index) => ({
      ...effect,
      id: `${effect.kind}-${index}`,
    })),
  });

describe('M6World: evidence from the effects of a run', () => {
  it('a comment is expanded from Notion: the page, the thread in canonical form, the words and the author', async () => {
    const world = await worldOver({
      comments: [
        notionComment({ id: 'comment-0', page: idOf('prices'), text: 'Записати обіцянку?' }),
      ],
    });
    const given = await world.evidenceFor(
      'reply',
      run('comment'),
      IDS,
      {},
      THREAD,
      NO_MEMORY_STATES,
    );

    expect(given.written.comments).toEqual([
      {
        id: 'comment-0',
        pageId: idOf('prices'),
        discussionId: THREAD,
        text: 'Записати обіцянку?',
        author: BOT,
      },
    ]);
    expect(given.foreign).toEqual([]);
    expect(given.discussionId).toBe(THREAD);
  });

  /**
   * A comment that landed outside the world is foreign data, and the verdict names it together with
   * the page and the thread. The thread may have been in normal operation before, so it is not
   * entered in the cleanup registry, because cleaning up by thread would delete production rows.
   */
  it('a write outside the pages of the world is foreign: named together with the page and the thread', async () => {
    const world = await worldOver({
      comments: [
        notionComment({
          id: 'comment-0',
          page: OUTSIDE,
          discussion: 'bbbbbbbb-1111-4222-8333-444444444444',
        }),
      ],
    });
    const given = await world.evidenceFor('run', run('comment'), IDS, {}, null, NO_MEMORY_STATES);

    expect(given.foreign).toEqual([
      'comment comment-0 on the page elsewhere-page (thread bbbbbbbb-1111-4222-8333-444444444444)',
    ]);
  });

  it('a comment on a block, not a page, names the block and also stays foreign', async () => {
    const world = await worldOver({
      comments: [notionComment({ id: 'comment-0', page: 'block-1', parent: 'block_id' })],
    });
    const given = await world.evidenceFor('run', run('comment'), IDS, {}, null, NO_MEMORY_STATES);

    expect(given.written.comments[0]?.pageId).toBe('block-1');
    expect(given.foreign).toEqual([`comment comment-0 on the page block-1 (thread ${THREAD})`]);
  });

  it('a continuation the run scheduled comes with its id, page and thread; a foreign one is named', async () => {
    const world = await worldOver({
      checks: [
        {
          id: 'continuation-0',
          reasonCode: 'await_external_event',
          runAt: new Date('2026-10-08T12:00:00.000Z'),
          notionPageId: idOf('prices'),
          discussionId: THREAD,
        },
        {
          id: 'continuation-1',
          reasonCode: 'user_snooze',
          runAt: new Date('2026-10-09T12:00:00.000Z'),
          notionPageId: OUTSIDE,
          discussionId: null,
        },
      ],
    });
    const given = await world.evidenceFor(
      'run',
      run('continuation', 'continuation'),
      IDS,
      {},
      null,
      NO_MEMORY_STATES,
    );

    expect(given.continuations).toEqual([
      {
        id: 'continuation-0',
        reasonCode: 'await_external_event',
        runAt: '2026-10-08T12:00:00.000Z',
        pageId: idOf('prices'),
        discussionId: THREAD,
      },
      {
        id: 'continuation-1',
        reasonCode: 'user_snooze',
        runAt: '2026-10-09T12:00:00.000Z',
        pageId: OUTSIDE,
        discussionId: null,
      },
    ]);
    expect(given.foreign).toEqual([
      'follow-up continuation-1 on the page elsewhere-page (thread none)',
    ]);
  });

  /**
   * A proposal for a page outside the world is also a foreign write: the verdict names it, because
   * it could change a real page of the owner if approved.
   */
  it('a proposal for a page outside the world is foreign and named together with the page; one for a page of the world is not', async () => {
    const effect = (pageId: string): ProposalView['effects'][number] => ({
      pageId,
      propertyId: 'status',
      option: null,
      value: 'Done',
    });
    const world = await worldOver({
      proposals: [
        { id: 'proposal-0', status: 'pending', effects: [effect(idOf('prices'))] },
        { id: 'proposal-1', status: 'pending', effects: [effect(OUTSIDE), effect(idOf('prices'))] },
      ],
    });
    const given = await world.evidenceFor(
      'run',
      run('proposal', 'proposal'),
      IDS,
      {},
      null,
      NO_MEMORY_STATES,
    );

    expect(given.foreign).toEqual(['proposal proposal-1 on the page elsewhere-page']);
  });

  it('foreign writes of different kinds are combined in one list: comment, continuation, proposal', async () => {
    const world = await worldOver({
      comments: [notionComment({ id: 'comment-0', page: OUTSIDE })],
      checks: [
        {
          id: 'continuation-1',
          reasonCode: 'user_snooze',
          runAt: new Date('2026-10-09T12:00:00.000Z'),
          notionPageId: OUTSIDE,
          discussionId: null,
        },
      ],
      proposals: [
        {
          id: 'proposal-2',
          status: 'pending',
          effects: [{ pageId: OUTSIDE, propertyId: 'status', option: null, value: 'Done' }],
        },
      ],
    });
    const given = await world.evidenceFor(
      'run',
      run('comment', 'continuation', 'proposal'),
      IDS,
      {},
      null,
      NO_MEMORY_STATES,
    );

    expect(given.foreign.map((line) => line.split(' ')[0])).toEqual([
      'comment',
      'follow-up',
      'proposal',
    ]);
  });

  it('a delivery is expanded into a notification packet; a run without deliveries does not ask the queue', async () => {
    const world = await worldOver({ outbox: [{ id: 'delivery-0', payload: NOTICE }] });

    const delivered = (
      await world.evidenceFor('run', run('delivery'), IDS, {}, null, NO_MEMORY_STATES)
    ).written;

    expect(delivered.notices).toEqual([NOTICE]);
    // The world measures the length in the language of the App, using the same rendering that
    // produces the packet for the person.
    expect(delivered.packetLengths).toEqual([packetLength(NOTICE, textsOf('uk').telegram)]);
    expect(
      (await world.evidenceFor('run', trace(), IDS, {}, null, NO_MEMORY_STATES)).written,
    ).toEqual({
      comments: [],
      notices: [],
      packetLengths: [],
    });
  });

  it('a delivery payload of a different shape is a conduct fault, not a run that said nothing', async () => {
    const world = await worldOver({
      outbox: [{ id: 'delivery-0', payload: { text: 'інша форма' } }],
    });

    await expect(
      world.evidenceFor('run', run('delivery'), IDS, {}, null, NO_MEMORY_STATES),
    ).rejects.toThrow(HarnessError);
  });

  it('what the runner reported about a run, the files read and the rejections, is looked up by the id of its run trace', async () => {
    const view = {
      skillReads: ['skills/run/SKILL.md'],
      rejections: ['Output does not match required schema: /detections/0/type'],
      gbrainCalls: [{ tool: 'search', ok: true, input: { query: 'x' } }],
      transcript: [],
    };
    const given = trace();
    const world = await worldOver({}, undefined, [], { [given.id]: view });

    expect(
      (await world.evidenceFor('run', given, IDS, {}, null, NO_MEMORY_STATES)).observed,
    ).toEqual(view);
  });

  it('a run the runner reported nothing about has empty observations, not an error', async () => {
    const world = await worldOver({});

    expect(
      (await world.evidenceFor('run', trace(), IDS, {}, null, NO_MEMORY_STATES)).observed,
    ).toEqual({
      skillReads: [],
      rejections: [],
      gbrainCalls: [],
      transcript: [],
    });
  });

  /**
   * The run's words come from its effects: the snapshot of the pages does not read comments,
   * because that is an extra request for each page.
   */
  it('the page snapshot for the evidence is taken without comments', async () => {
    const requested: (boolean | undefined)[] = [];
    const world = await worldOver({}, undefined, requested);

    await world.evidenceFor('run', trace(), IDS, {}, null, NO_MEMORY_STATES);

    expect(requested).toEqual([false]);
  });

  it('a comment without text is an infrastructure failure, not an empty text', async () => {
    const world = await worldOver({ comments: [{ object: 'comment', id: 'comment-0' }] });

    await expect(
      world.evidenceFor('run', run('comment'), IDS, {}, null, NO_MEMORY_STATES),
    ).rejects.toThrow(InfrastructureError);
  });
});

describe('M6World: scenario memory', () => {
  /**
   * The anchor of the world's project: the id of its page is a real UUID, because the slug of an
   * anchor is derived from the id.
   */
  const PRICES = 'a0865184-6cda-69f0-e8e0-3884c8610ce5';
  const ids: Ids = { ...IDS, prices: PRICES };
  const SLUG = `projects/${PRICES.replaceAll('-', '')}`;

  const OWN: AnchorMemory = {
    kind: 'anchor',
    key: 'similar',
    of: null,
    type: 'project',
    title: 'Запуск сайту «Меридіан-4821-f2-1»',
    paragraphs: ['Урок'],
    discoverableBy: 'договір юристи підписання макети',
  };

  /** A page with no topic query: it is searched for by id only. */
  const withoutTopic = (page: AnchorMemory): AnchorMemory => ({
    ...page,
    discoverableBy: undefined,
  });

  it('the anchor of another project, which search by topic finds, is planted and entered in the registry', async () => {
    const gbrain = new FakeGbrain(true);
    const world = await worldOver({}, gbrain);
    const residue = emptyResidue();

    await world.plantMemory([OWN], ids, residue, QUICK);

    expect(gbrain.written).toHaveLength(1);
    expect(gbrain.written[0]).toMatch(/^projects\/[0-9a-f]{32}$/);
    expect(residue.gbrainPages).toEqual(gbrain.written);
  });

  /** A trap that search by topic does not surface checks nothing: a harness fault, not behavior. */
  it('a page that search by topic does not find is a harness fault in the scenario description', async () => {
    const world = await worldOver({}, new FakeGbrain(false));

    await expect(world.plantMemory([OWN], ids, emptyResidue(), QUICK)).rejects.toThrow(
      HarnessError,
    );
  });

  it('a page with no topic query is checked by id only', async () => {
    const world = await worldOver({}, new FakeGbrain(false));
    const plain = withoutTopic(OWN);

    await expect(world.plantMemory([plain], ids, emptyResidue(), QUICK)).resolves.toBeUndefined();
  });

  it('after a stop memory is not planted, because a GBrain page that would appear after the cleanup would stay', async () => {
    const gbrain = new FakeGbrain(true);
    const world = await worldOver({}, gbrain);

    await world.abandon();

    await expect(world.plantMemory([OWN], ids, emptyResidue(), QUICK)).rejects.toThrow(
      'stopped by a signal',
    );
    expect(gbrain.written).toEqual([]);
  });

  it("the anchor of the world's project is planted under a slug derived from the id of the project page in the world", async () => {
    const gbrain = new FakeGbrain(true);
    const world = await worldOver({}, gbrain);
    const rest = withoutTopic(OWN);

    await world.plantMemory([{ ...rest, of: 'prices' }], ids, emptyResidue(), QUICK);

    expect(gbrain.written).toEqual([SLUG]);
    expect(gbrain.pages.get(SLUG)?.frontmatter['notion_id']).toBe(PRICES);
  });

  it('events, facts and links are put on pages that are already written', async () => {
    const gbrain = new FakeGbrain(true);
    const world = await worldOver({}, gbrain);
    const residue = emptyResidue();
    const anchor: AnchorMemory = {
      kind: 'anchor',
      key: 'anchor',
      of: 'prices',
      type: 'project',
      title: 'Сайт',
      paragraphs: [],
      timeline: [{ date: '2026-10-01', summary: 'Старт', source: 'notion:thread' }],
      facts: ['Бюджет 10 тис.'],
    };
    const lesson: PlainMemory = {
      kind: 'page',
      key: 'lesson',
      slug: 'lessons/orvex',
      type: 'note',
      title: 'Урок',
      paragraphs: ['Текст'],
      mentions: 'prices',
      linksTo: { key: 'anchor', type: 'derived_from' },
    };

    await world.plantMemory([anchor, lesson], ids, residue, QUICK);

    expect(gbrain.timelines.get(SLUG)?.map((entry) => entry.summary)).toEqual(['Старт']);
    expect(gbrain.factsBy.get(SLUG)?.map((fact) => fact.fact)).toEqual(['Бюджет 10 тис.']);
    expect(gbrain.links).toEqual([{ from: 'lessons/orvex', to: SLUG, type: 'derived_from' }]);
    expect(residue.gbrainPages).toEqual([SLUG, 'lessons/orvex']);
  });

  it('pages planted in two steps for one attempt are read together', async () => {
    const world = await worldOver({}, new FakeGbrain(true));
    const residue = emptyResidue();
    const note = (key: string, slug: string): PlainMemory => ({
      kind: 'page',
      key,
      slug,
      type: 'note',
      title: key,
      paragraphs: [],
    });

    await world.plantMemory([note('first', 'notes/first')], ids, residue, QUICK);
    await world.plantMemory([note('second', 'notes/second')], ids, residue, QUICK);

    const { slugs } = await world.memoryStates(residue);

    expect(slugs).toEqual({ first: 'notes/first', second: 'notes/second' });
  });

  it('a link to a page that is not planted yet is a harness fault in the scenario description', async () => {
    const world = await worldOver({}, new FakeGbrain(true));
    const lesson: PlainMemory = {
      kind: 'page',
      key: 'lesson',
      slug: 'lessons/orvex',
      type: 'note',
      title: 'Урок',
      paragraphs: [],
      linksTo: { key: 'anchor', type: null },
    };

    await expect(world.plantMemory([lesson], ids, emptyResidue(), QUICK)).rejects.toThrow(
      HarnessError,
    );
  });

  it('the state of planted pages is read by key: the page, the events and the facts', async () => {
    const gbrain = new FakeGbrain(true);
    const world = await worldOver({}, gbrain);
    const residue = emptyResidue();
    const rest = withoutTopic(OWN);

    await world.plantMemory([{ ...rest, key: 'anchor', of: 'prices' }], ids, residue, QUICK);

    const { slugs, states } = await world.memoryStates(residue);

    expect(slugs).toEqual({ anchor: SLUG });
    expect(states['anchor']?.page?.slug).toBe(SLUG);
    expect(states['anchor']?.timeline).toEqual([]);
  });
});
