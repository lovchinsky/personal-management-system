import type { GbrainCall } from '../../src/claude/runner/run-tap';
import { anchorSlug } from '../../src/knowledge/anchor-page';
import type { FactRead, PageRead, TimelineEntry } from '../../src/knowledge/gbrain-pages';
import { DECISION_MARKER, STANDARD_MARKER } from '../../src/knowledge/memory-writes';
import type { AppliedEffect } from '../../src/runs/run-effects';
import type { ToolCall } from '../../src/runs/run-outcome';
import { MEMORY_RECORD_TOOL } from '../gate/gate-claims';
import type { World } from '../gate/m5-scenarios';
import type { Evidence6 } from '../gate/m6-evidence';
import { LESSON_STEM, M7_RUNS, SUBJECT_STEM, type M7ScenarioId } from '../gate/m7-scenarios';
import type { MemoryEvidence, MemoryState } from '../gate/memory-evidence';
import { ALPHA_ID, pageRead } from './gbrain-pages.fixture';
import { comment, effects, evidence, ref, result, TAG, THREAD, trace } from './m6-evidence.fixture';

/**
 * Evidence of the gate M7 runs, assembled without GBrain, Notion or the model, in exactly the
 * form `m7-claims.ts` sees it. Each scenario has an all-correct sample, from which the test
 * derives the violations observation by observation.
 */

/** Slugs of memory pages in the samples, by the page key of the scenario. */
const SLUGS: Readonly<Record<string, string>> = {
  anchor: 'projects/aaaa',
  copy: 'projects/copy-aaaa',
  mention: 'notes/meeting-aaaa',
  lesson: 'lessons/signing-aaaa',
  similar: 'projects/bbbb',
  other: 'projects/cccc',
};

/** Returns the slug of a memory page by its key. */
export function slugOf(key: string): string {
  const slug = SLUGS[key];

  if (slug === undefined) throw new Error(`no slug for the page ${key}`);

  return slug;
}

const TODAY = '2026-10-08';

export const entry = (summary: string, source = 'Notion: сторінка проєкту'): TimelineEntry => ({
  date: TODAY,
  summary,
  source,
  detail: '',
});

export const fact = (text: string, key = 'anchor', kind = 'fact'): FactRead => ({
  fact: text,
  kind,
  entitySlug: slugOf(key),
  provenance: 'Notion: нитка',
});

/** Builds the state of a page: its text, events and facts. */
export function stateOf(
  key: string,
  patch: {
    readonly compiledTruth?: string;
    readonly timeline?: readonly TimelineEntry[];
    readonly facts?: readonly FactRead[];
  } = {},
): MemoryState {
  return {
    page: pageRead({
      slug: slugOf(key),
      compiledTruth: patch.compiledTruth ?? `# Сторінка\n\nNotion: ${key}\n\nНотатка.\n`,
    }),
    timeline: patch.timeline ?? [],
    facts: patch.facts ?? [],
  };
}

const read = (key: string, ok = true): GbrainCall => ({
  tool: 'get_page',
  ok,
  input: { slug: slugOf(key) },
});

export const search: GbrainCall = {
  tool: 'search',
  ok: true,
  input: { query: ALPHA_ID, types: ['project'] },
};

/** There is no page at the address yet. */
const ABSENT: MemoryState = { page: null, timeline: [], facts: [] };

/** The address of the world Project's anchor by convention: the App creates it in H7. */
const CREATED_SLUG = anchorSlug('project', ALPHA_ID);

/**
 * Builds the anchor of the world Project that the App created by convention: the name, the id and
 * the identity line.
 */
const createdAnchor = (): PageRead =>
  pageRead({
    slug: CREATED_SLUG,
    title: 'Редизайн кабінету',
    compiledTruth: `# Редизайн кабінету\n\nNotion: ${ALPHA_ID}\n`,
    frontmatter: { notion_id: ALPHA_ID, aliases: [] },
  });

/** Builds the memory evidence: the state before and after the run, and the calls of the run. */
function memoryOf(
  before: Readonly<Record<string, MemoryState>>,
  after: Readonly<Record<string, MemoryState>>,
  calls: readonly GbrainCall[],
): MemoryEvidence {
  const keys = Object.keys(before);

  return {
    slugs: Object.fromEntries(keys.map((key) => [key, slugOf(key)])),
    before,
    after,
    calls,
  };
}

/**
 * Builds memory evidence in which the state stays the same: pages with these states before the run
 * and after it.
 */
const kept = (
  states: Readonly<Record<string, MemoryState>>,
  calls: readonly GbrainCall[],
): MemoryEvidence => memoryOf(states, states, calls);

/** What the run did: what it said to the person, the result, the GBrain calls and the writes. */
interface Run {
  readonly comments?: readonly Evidence6['written']['comments'][number][];
  readonly result?: { outcome: string; detections: unknown[] };
  readonly memory: MemoryEvidence;
  readonly discussionId?: string | null;
  /** Slugs of the pages the run's memory writes land on: one per write. */
  readonly recorded?: readonly string[];
  /** The anchors the App created for these writes. */
  readonly created?: readonly string[];
}

/**
 * Builds a run with its evidence: the GBrain reads come from memory, the memory writes are an App
 * intent after the reads, and the trace effects are the created anchors, memory writes and
 * comments.
 */
function ran(world: World, run: Run): Evidence6 {
  const comments = run.comments ?? [];
  const recorded = run.recorded ?? [];
  const applied: AppliedEffect[] = [
    ...(run.created ?? []).map((slug): AppliedEffect => ({ kind: 'memory_anchor', id: slug })),
    ...recorded.map((slug): AppliedEffect => ({ kind: 'memory_entry', id: slug })),
    ...effects(...comments.map((): 'comment' => 'comment')),
  ];

  return evidence(world, {
    trace: trace({
      result: run.result ?? result([]),
      toolCalls: [
        { server: 'notion', tool: 'notion-fetch', ok: true },
        ...run.memory.calls.map((call): ToolCall => ({
          server: 'gbrain',
          tool: call.tool,
          ok: call.ok,
        })),
        ...recorded.map((): ToolCall => ({ server: 'app', tool: MEMORY_RECORD_TOOL, ok: true })),
      ],
      runtimeEffects: applied,
    }),
    written: { comments, notices: [], packetLengths: [] },
    gbrainWrites: recorded.map(() => MEMORY_RECORD_TOOL),
    discussionId: run.discussionId ?? null,
    memory: run.memory,
  });
}

/** The person's words before the run, written in the thread. */
const subject = `${SUBJECT_STEM}-${TAG}`;

/**
 * Builds a run that did everything it had to, for a gate M7 scenario. The test derives violations
 * from it.
 */
export function goodM7(id: M7ScenarioId): Evidence6 {
  const world = M7_RUNS[id].world(TAG);

  switch (id) {
    case 'H1_routine_done': {
      const states = { anchor: stateOf('anchor', { timeline: [entry('Проєкт стартував.')] }) };

      return ran(world, { memory: kept(states, [search, read('anchor')]) });
    }

    case 'H2_routine_answer': {
      const states = { anchor: stateOf('anchor') };

      return ran(world, {
        comments: [comment('check', 'Дякую, перевірку записано на понеділок.')],
        memory: kept(states, [search, read('anchor')]),
        discussionId: THREAD,
      });
    }

    case 'H3_two_anchors': {
      const states = {
        anchor: stateOf('anchor', {
          compiledTruth: `# Сторінка\n\nNotion: x\n\nУрок ${LESSON_STEM}.\n`,
        }),
        copy: stateOf('copy'),
        mention: stateOf('mention'),
      };

      return ran(world, {
        comments: [
          comment('waiting', 'Договір ще не підписано. У пам’яті кілька сторінок цього проєкту.'),
        ],
        result: result(
          ['dependency'],
          [ref('waiting'), ref('project')],
          ['GBrain holds two pages for the project, so I used none of them.'],
        ),
        memory: kept(states, [search, read('anchor'), read('copy')]),
      });
    }

    case 'H4_decision_stated': {
      const decision = entry(`${DECISION_MARKER} платежі через «${subject}».`);
      const before = { anchor: stateOf('anchor', { timeline: [entry('Старт.')] }) };
      const after = { anchor: stateOf('anchor', { timeline: [entry('Старт.'), decision] }) };

      return ran(world, {
        comments: [comment('provider', 'Записав рішення.')],
        memory: memoryOf(before, after, [search, read('anchor')]),
        recorded: [slugOf('anchor')],
        discussionId: THREAD,
      });
    }

    case 'H5_decision_stored': {
      const states = {
        anchor: stateOf('anchor', {
          timeline: [entry('Старт.'), entry(`${DECISION_MARKER} платежі через «${subject}».`)],
        }),
      };

      return ran(world, {
        comments: [comment('provider', 'Це рішення вже записано.')],
        memory: kept(states, [search, read('anchor')]),
        discussionId: THREAD,
      });
    }

    case 'H6_fact_stated': {
      const text = `Замовник «${subject}» приймає макети лише по четвергах до полудня.`;
      const before = { anchor: stateOf('anchor', { facts: [fact('Бюджет погоджено.')] }) };
      const after = {
        anchor: stateOf('anchor', {
          compiledTruth: `# Сторінка\n\nNotion: anchor\n\nНотатка.\n\n- ${text}\n`,
          facts: [fact('Бюджет погоджено.'), fact(text)],
        }),
      };

      return ran(world, {
        comments: [comment('mockups', 'Запам’ятав.')],
        memory: memoryOf(before, after, [search, read('anchor')]),
        recorded: [slugOf('anchor')],
        discussionId: THREAD,
      });
    }

    case 'H7_no_anchor': {
      const decision = entry(`${DECISION_MARKER} платежі через «${subject}».`);
      const before = { anchor: ABSENT, other: stateOf('other') };
      const after = {
        anchor: { page: createdAnchor(), timeline: [decision], facts: [] },
        other: stateOf('other'),
      };
      const given = ran(world, {
        comments: [comment('provider', 'Дякую, рішення запам’ятав.')],
        memory: {
          slugs: { anchor: CREATED_SLUG, other: slugOf('other') },
          before,
          after,
          calls: [search],
        },
        recorded: [CREATED_SLUG],
        created: [CREATED_SLUG],
        discussionId: THREAD,
      });
      const project = given.after['project'];

      return project === undefined
        ? given
        : { ...given, after: { ...given.after, project: { ...project, id: ALPHA_ID } } };
    }

    case 'H8_below_threshold': {
      const states = { anchor: stateOf('anchor', { timeline: [entry('Читання пропущено.')] }) };

      return ran(world, { memory: kept(states, [search, read('anchor')]) });
    }

    case 'H9_structure_first': {
      const states = {
        anchor: stateOf('anchor'),
        lesson: stateOf('lesson'),
        similar: stateOf('similar'),
      };

      return ran(world, {
        comments: [comment('waiting', `Юристи чекають макети «${LESSON_STEM}-${TAG}».`)],
        result: result(['forgotten_context'], [['gbrain', slugOf('lesson')], ref('waiting')]),
        memory: kept(states, [
          search,
          read('anchor'),
          { tool: 'traverse_graph', ok: true, input: { slug: slugOf('anchor'), depth: 1 } },
          read('lesson'),
        ]),
      });
    }

    case 'H10_standard_stated': {
      const text = `${STANDARD_MARKER} дві пробіжки на тиждень.`;
      const before = { anchor: stateOf('anchor') };
      const after = { anchor: stateOf('anchor', { facts: [fact(text, 'anchor', 'preference')] }) };

      return ran(world, {
        comments: [comment('jog', 'Записав.')],
        memory: memoryOf(before, after, [search, read('anchor')]),
        recorded: [slugOf('anchor')],
        discussionId: THREAD,
      });
    }

    case 'H11_lesson_stated': {
      const text = `Юристи «${subject}» не рухають договір без фінальних макетів.`;
      const before = { anchor: stateOf('anchor') };
      const after = { anchor: stateOf('anchor', { facts: [fact(text)] }) };

      return ran(world, {
        comments: [comment('waiting', 'Запам’ятав цей урок.')],
        memory: memoryOf(before, after, [search, read('anchor')]),
        recorded: [slugOf('anchor')],
        discussionId: THREAD,
      });
    }
  }
}
