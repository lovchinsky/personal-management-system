import { DECISION_MARKER, GBRAIN_CALL_BUDGET } from '../../src/knowledge/memory-writes';
import {
  addComment,
  addEffect,
  described,
  describeViolations,
  effect,
  EVERY_SCENARIO,
  failing,
  NO_NEW_PAGES,
  ONE_NOTICE,
  perimeter,
  raise,
  raising,
  refrain,
  replaceComments,
  unchanged,
  withTrace,
  type Violations,
} from '../fixtures/claim-mutations.fixture';
import { comment, ref, result, TAG, THREAD } from '../fixtures/m6-evidence.fixture';
import { entry, fact, goodM7, search, slugOf, stateOf } from '../fixtures/m7-evidence.fixture';
import type { Claim } from './gate-claims';
import type { Evidence6 } from './m6-evidence';
import { scenariosOf, type ScenarioId } from './m6-scenarios';
import { M7_CLAIMS } from './m7-claims';
import { LESSON_STEM, SUBJECT_STEM, TRAP_STEM, type M7ScenarioId } from './m7-scenarios';
import type { MemoryEvidence, MemoryState } from './memory-evidence';

const isM7 = (id: ScenarioId): id is M7ScenarioId => id in M7_CLAIMS;

const M7_IDS: readonly M7ScenarioId[] = scenariosOf('m7')
  .map((info) => info.id)
  .filter(isM7);

function claimOf(id: M7ScenarioId, given: Evidence6): Claim {
  return M7_CLAIMS[id](given);
}

const withMemory = (given: Evidence6, patch: Partial<MemoryEvidence>): Evidence6 => ({
  ...given,
  memory: { ...given.memory, ...patch },
});

/** Replaces the state of the page after the run. */
const afterOf = (given: Evidence6, key: string, state: MemoryState): Evidence6 =>
  withMemory(given, { after: { ...given.memory.after, [key]: state } });

/** Makes the run write: the tool name is among the writes. */
const writing = (given: Evidence6, tool = 'add_timeline_entry'): Evidence6 => ({
  ...given,
  gbrainWrites: [...given.gbrainWrites, tool],
});

/** Adds one more memory write that landed on the page with this slug. */
const recordingOn = (given: Evidence6, slug: string): Evidence6 =>
  withTrace(given, {
    runtimeEffects: [...(given.trace.runtimeEffects ?? []), { kind: 'memory_entry', id: slug }],
  });

/** Puts the memory intent in the run trace before any GBrain read. */
const recordingFirst = (given: Evidence6): Evidence6 => {
  const calls = given.trace.toolCalls ?? [];

  return withTrace(given, {
    toolCalls: [
      ...calls.filter((call) => call.server === 'app'),
      ...calls.filter((call) => call.server !== 'app'),
    ],
  });
};

/** Makes the run not call GBrain: only Notion is in the run trace. */
const withoutGbrain = (given: Evidence6): Evidence6 =>
  withTrace(given, { toolCalls: [{ server: 'notion', tool: 'notion-fetch', ok: true }] });

/** Replaces the calls of the run. */
const calling = (given: Evidence6, calls: MemoryEvidence['calls']): Evidence6 =>
  withMemory(given, { calls });

/** Builds a call that reads the links of the anchor. */
const linksBy = (
  tool: string,
  input: Readonly<Record<string, string>> = {},
): MemoryEvidence['calls'][number] => ({
  tool,
  ok: true,
  input: { slug: slugOf('anchor'), ...input },
});

/** Makes the run read the links of the anchor with these calls instead of a graph traversal. */
const listingLinks = (given: Evidence6, calls: MemoryEvidence['calls']): Evidence6 =>
  calling(given, [
    ...given.memory.calls.filter((call) => call.tool !== 'traverse_graph'),
    ...calls,
  ]);

/** Makes the run not read the anchor: there is no `get_page` among the calls. */
const withoutRead = (given: Evidence6): Evidence6 =>
  calling(
    given,
    given.memory.calls.filter((call) => call.tool !== 'get_page'),
  );

/** Makes the anchor after the run what it was before the run: nothing is added. */
const asBefore = (given: Evidence6): Evidence6 =>
  afterOf(given, 'anchor', given.memory.before['anchor'] ?? stateOf('anchor'));

/** Builds a sample in which the page changed: its text is not the same. */
const rewritten = (given: Evidence6, key: string): Evidence6 =>
  afterOf(given, key, stateOf(key, { compiledTruth: '# Інше\n' }));

/** Violations of the observations of one scenario, listed by observation name. */
const SPECIFIC: Readonly<Partial<Record<M7ScenarioId, Violations>>> = {
  H1_routine_done: {
    'nothing is remembered': (given) => writing(given),
    'the page is as it was': (given) => rewritten(given, 'anchor'),
  },
  H2_routine_answer: {
    'nothing is remembered': (given) => writing(given, 'remember'),
    'the page is as it was': (given) => rewritten(given, 'anchor'),
  },
  H3_two_anchors: {
    'nothing is remembered': (given) => writing(given),
    'neither anchor is changed': (given) => rewritten(given, 'copy'),
    'no detection cites either anchor': (given) =>
      raising(given, ['dependency'], [['gbrain', slugOf('anchor')]]),
    'the run looked into GBrain': withoutGbrain,
    'the run says that GBrain holds several pages for the project': (given) =>
      replaceComments(withTrace(given, { result: result(['dependency'], [ref('waiting')], []) }), [
        comment('waiting', 'Договір ще не підписано.'),
      ]),
    'no forgotten context is raised': (given) =>
      raising(given, ['forgotten_context'], [ref('waiting')]),
    'the lesson on the first page does not reach the person': (given) =>
      addComment(given, 'waiting', `Юристи чекають макети «${LESSON_STEM}-${TAG}»`),
  },
  H4_decision_stated: {
    'one timeline entry is added to the anchor': (given) => asBefore(given),
    [`the entry starts with ${DECISION_MARKER} and gives the choice the person stated`]: (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', { timeline: [entry('Старт.'), entry(`Платежі через ${SUBJECT_STEM}.`)] }),
      ),
    'the entry names its source': (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', {
          timeline: [entry('Старт.'), entry(`${DECISION_MARKER} через ${SUBJECT_STEM}.`, ' ')],
        }),
      ),
    'every memory entry lands on the anchor': (given) => recordingOn(given, slugOf('other')),
    'the text of the anchor is as it was': (given) => rewritten(given, 'anchor'),
    'the run read the anchor before it recorded': (given) => withoutRead(recordingFirst(given)),
  },
  H5_decision_stored: {
    'no timeline entry is added': (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', {
          timeline: [...(given.memory.after['anchor']?.timeline ?? []), entry('Ще подія.')],
        }),
      ),
    'no fact is added': (given) =>
      afterOf(given, 'anchor', stateOf('anchor', { facts: [fact('Новий факт.')] })),
    'nothing is remembered': (given) => writing(given, 'remember'),
    'the run read the anchor, where the decision lies': (given) => withoutRead(given),
  },
  H6_fact_stated: {
    'one fact is added to the anchor': (given) => asBefore(given),
    'the fact is what the person stated': (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', { facts: [fact('Бюджет погоджено.'), fact('Щось інше.')] }),
      ),
    'the fact is about the anchor': (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', {
          facts: [fact('Бюджет погоджено.'), fact(`Про ${SUBJECT_STEM}.`, 'other')],
        }),
      ),
    'every memory entry lands on the anchor': (given) => recordingOn(given, slugOf('other')),
    'the text of the anchor keeps every line it had': (given) => rewritten(given, 'anchor'),
    'the run read the anchor before it recorded': (given) => recordingFirst(given),
  },
  H7_no_anchor: {
    'the project had no anchor before the run': (given) =>
      withMemory(given, {
        before: {
          ...given.memory.before,
          anchor: given.memory.after['anchor'] ?? stateOf('anchor'),
        },
      }),
    'an anchor of the project is created by convention': (given) =>
      afterOf(given, 'anchor', { page: null, timeline: [], facts: [] }),
    'one timeline entry is added to it': (given) =>
      afterOf(given, 'anchor', {
        page: given.memory.after['anchor']?.page ?? null,
        timeline: [],
        facts: [],
      }),
    [`the entry starts with ${DECISION_MARKER} and gives the choice the person stated`]: (given) =>
      afterOf(given, 'anchor', {
        page: given.memory.after['anchor']?.page ?? null,
        timeline: [entry('Платежі через провайдера.')],
        facts: [],
      }),
    'every memory entry lands on that anchor': (given) => recordingOn(given, slugOf('other')),
    'the other anchor is as it was': (given) => rewritten(given, 'other'),
    'at most one comment in the thread of the reply': (given) =>
      addComment(given, 'provider', 'Ще одне слово', THREAD),
    'the person hears nothing about how memory is stored': (given) =>
      addComment(given, 'provider', 'У GBrain для проєкту немає сторінки.', THREAD),
  },
  H8_below_threshold: {
    'nothing is remembered': (given) => writing(given),
    'the page is as it was': (given) => rewritten(given, 'anchor'),
    'no proposal': (given) => ({
      ...given,
      proposals: [{ id: 'proposal-1', status: 'proposed', effects: [] }],
    }),
    'no notification': (given) => addEffect(given, 'delivery'),
    'no friction or Area of Focus risk label is raised': (given) =>
      raising(given, ['behavior_system_friction'], [ref('instance')]),
  },
  H9_structure_first: {
    'nothing is remembered': (given) => writing(given),
    'the forgotten context is raised': (given) => raising(given, []),
    'one detection cites the lesson that the anchor links to and a page of Notion': (given) =>
      raising(given, ['forgotten_context'], [ref('waiting')]),
    'the lesson reaches the person: its code word is in the text': (given) =>
      replaceComments(given, [comment('waiting', 'Юристи ще не відповіли.')]),
    'the run reads the anchor before any free-text search': (given) =>
      calling(given, [
        { tool: 'query', ok: true, input: { query: 'договір' } },
        ...given.memory.calls,
      ]),
    'the run lists the links of the anchor from both sides': (given) =>
      listingLinks(given, [linksBy('get_backlinks')]),
    [`the run stays within ${GBRAIN_CALL_BUDGET} GBrain calls`]: (given) =>
      calling(given, [...given.memory.calls, search]),
    'the lesson of the similar project does not reach the person': (given) =>
      addComment(given, 'waiting', `Юристи чекають макети «${TRAP_STEM}-${TAG}»`),
  },
  H11_lesson_stated: {
    'one fact is added to the anchor': (given) => asBefore(given),
    "the fact is the lesson in the person's words": (given) =>
      afterOf(given, 'anchor', stateOf('anchor', { facts: [fact('Договори без макетів.')] })),
    'the fact is about the anchor': (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', { facts: [fact(`Про ${SUBJECT_STEM}.`, 'other')] }),
      ),
    'no timeline entry is added': (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', {
          facts: given.memory.after['anchor']?.facts ?? [],
          timeline: [entry(`Урок: ${SUBJECT_STEM}.`)],
        }),
      ),
    'every memory entry lands on the anchor': (given) => recordingOn(given, slugOf('other')),
  },
  H10_standard_stated: {
    'one fact is added to the anchor of the Area of Focus': (given) => asBefore(given),
    'the fact starts with Standard: and is of kind preference': (given) =>
      afterOf(given, 'anchor', stateOf('anchor', { facts: [fact('Дві пробіжки.', 'anchor')] })),
    'the fact is about the anchor of the Area of Focus': (given) =>
      afterOf(
        given,
        'anchor',
        stateOf('anchor', { facts: [fact('Standard: дві.', 'other', 'preference')] }),
      ),
  },
};

describeViolations(M7_IDS, goodM7, claimOf, SPECIFIC);

/**
 * What each scenario measures: the matrix above proves that every observation can fail, and this
 * list proves that none was dropped or lowered. Written from `infra/GATE.md` § “Gate M7”, not from
 * the code (`claim-mutations.fixture.ts`).
 */
const NO_DIRECT_WRITES = perimeter('no direct write to GBrain');
/** A routine case: nothing is written, the page is as it was. */
const ROUTINE: readonly string[] = [
  NO_NEW_PAGES,
  ONE_NOTICE,
  NO_DIRECT_WRITES,
  effect('nothing is remembered'),
  effect('the page is as it was'),
];

const READ_FIRST = raise('the run read the anchor before it recorded');

const MEASURED: Readonly<Record<M7ScenarioId, readonly string[]>> = {
  H1_routine_done: [...unchanged('project', 'finished', 'next', 'later'), ...ROUTINE],
  H2_routine_answer: [...unchanged('project', 'check'), ...ROUTINE],
  H3_two_anchors: [
    ...unchanged('project', 'waiting'),
    NO_DIRECT_WRITES,
    ONE_NOTICE,
    effect('nothing is remembered'),
    effect('neither anchor is changed'),
    effect('no detection cites either anchor'),
    raise('the run looked into GBrain'),
    raise('the run says that GBrain holds several pages for the project'),
    refrain('no forgotten context is raised'),
    refrain('the lesson on the first page does not reach the person'),
  ],
  H4_decision_stated: [
    ...unchanged('project', 'provider'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    NO_DIRECT_WRITES,
    effect('one timeline entry is added to the anchor'),
    effect('the entry starts with Decision: and gives the choice the person stated'),
    effect('the entry names its source'),
    effect('every memory entry lands on the anchor'),
    effect('the text of the anchor is as it was'),
    READ_FIRST,
  ],
  H5_decision_stored: [
    ...unchanged('project', 'provider'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    NO_DIRECT_WRITES,
    effect('no timeline entry is added'),
    effect('no fact is added'),
    effect('nothing is remembered'),
    raise('the run read the anchor, where the decision lies'),
  ],
  H6_fact_stated: [
    ...unchanged('project', 'mockups'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    NO_DIRECT_WRITES,
    effect('one fact is added to the anchor'),
    effect('the fact is what the person stated'),
    effect('the fact is about the anchor'),
    effect('every memory entry lands on the anchor'),
    effect('the text of the anchor keeps every line it had'),
    READ_FIRST,
  ],
  H7_no_anchor: [
    ...unchanged('project', 'provider'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    NO_DIRECT_WRITES,
    effect('the project had no anchor before the run'),
    effect('an anchor of the project is created by convention'),
    effect('one timeline entry is added to it'),
    effect('the entry starts with Decision: and gives the choice the person stated'),
    effect('every memory entry lands on that anchor'),
    effect('the other anchor is as it was'),
    effect('at most one comment in the thread of the reply'),
    refrain('the person hears nothing about how memory is stored'),
  ],
  H8_below_threshold: [
    perimeter('system was not edited'),
    ...unchanged('instance'),
    NO_DIRECT_WRITES,
    effect('nothing is remembered'),
    effect('the page is as it was'),
    effect('no proposal'),
    effect('no notification'),
    refrain('no friction or Area of Focus risk label is raised'),
  ],
  H9_structure_first: [
    ...unchanged('project', 'waiting'),
    NO_DIRECT_WRITES,
    ONE_NOTICE,
    effect('nothing is remembered'),
    raise('the forgotten context is raised'),
    raise('one detection cites the lesson that the anchor links to and a page of Notion'),
    raise('the lesson reaches the person: its code word is in the text'),
    raise('the run reads the anchor before any free-text search'),
    raise('the run lists the links of the anchor from both sides'),
    raise(`the run stays within ${GBRAIN_CALL_BUDGET} GBrain calls`),
    refrain('the lesson of the similar project does not reach the person'),
  ],
  // The norm of an Area of Focus has no acceptance scenario: all that H10 measures is recognition.
  H10_standard_stated: [
    ...unchanged('area_of_focus', 'jog'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    NO_DIRECT_WRITES,
    raise('one fact is added to the anchor of the Area of Focus'),
    raise('the fact starts with Standard: and is of kind preference'),
    raise('the fact is about the anchor of the Area of Focus'),
  ],
  // A lesson in the person's words has no acceptance scenario: all that H11 measures is
  // recognition.
  H11_lesson_stated: [
    ...unchanged('project', 'waiting'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    NO_DIRECT_WRITES,
    raise('one fact is added to the anchor'),
    raise("the fact is the lesson in the person's words"),
    raise('the fact is about the anchor'),
    raise('no timeline entry is added'),
    raise('every memory entry lands on the anchor'),
  ],
};

describe('what each M7 scenario measures and how it is named', () => {
  it('the list covers exactly the scenarios of the suite', () => {
    expect(Object.keys(MEASURED).sort()).toEqual([...M7_IDS].sort());
    expect(Object.keys(M7_CLAIMS).sort()).toEqual([...M7_IDS].sort());
  });

  it.each(M7_IDS)(
    '%s: the observations, their classes and polarities are these, no more and no fewer',
    (id) => {
      expect(described(claimOf(id, goodM7(id))).sort()).toEqual(
        [...EVERY_SCENARIO, ...MEASURED[id]].sort(),
      );
    },
  );

  /**
   * The classes decide how strictly to measure: a write to memory and its absence are the model's
   * choice, which tolerates no violation; recognition allows a share.
   */
  it('a write and the absence of a write are zero tolerance, not a share', () => {
    const effectsOf = (id: M7ScenarioId): string[] =>
      claimOf(id, goodM7(id))
        .observations.filter((observation) => observation.kind === 'effect')
        .map((observation) => observation.item);

    for (const id of ['H1_routine_done', 'H2_routine_answer'] as const) {
      expect(effectsOf(id)).toContain('nothing is remembered');
    }

    expect(effectsOf('H4_decision_stated')).toContain('one timeline entry is added to the anchor');
    expect(effectsOf('H6_fact_stated')).toContain('one fact is added to the anchor');
    expect(effectsOf('H7_no_anchor')).toContain(
      'an anchor of the project is created by convention',
    );
    expect(effectsOf('H7_no_anchor')).toContain('one timeline entry is added to it');
  });

  it('a reply that has no word about several pages does not prove the run said it', () => {
    const given = goodM7('H3_two_anchors');
    const silent = replaceComments(
      withTrace(given, { result: result(['dependency'], [ref('waiting')]) }),
      [comment('waiting', 'Договір ще не підписано.')],
    );

    expect(failing(claimOf('H3_two_anchors', silent))).toEqual([
      'the run says that GBrain holds several pages for the project',
    ]);
  });

  it("the word about several pages is found both in the label's uncertainties and in the text for the person", () => {
    const given = goodM7('H3_two_anchors');
    const inTexts = replaceComments(
      withTrace(given, { result: result(['dependency'], [ref('waiting')], []) }),
      [comment('waiting', 'Для проєкту в пам’яті дві сторінки, тому я не покладався на жодну.')],
    );
    const inUncertainties = replaceComments(given, [
      comment('waiting', 'Договір ще не підписано.'),
    ]);

    expect(failing(claimOf('H3_two_anchors', inTexts))).toEqual([]);
    expect(failing(claimOf('H3_two_anchors', inUncertainties))).toEqual([]);
  });

  it.each([
    'У GBrain є два anchor-и для проєкту, жоден не використано.',
    'Для проєкту знайшлися обидві сторінки, тому я не покладався на жодну.',
    'GBrain holds two pages for the project.',
  ])('the count of pages as a word or a digit is also a word about several pages: %s', (text) => {
    const given = goodM7('H3_two_anchors');
    const said = replaceComments(
      withTrace(given, { result: result(['dependency'], [ref('waiting')], []) }),
      [comment('waiting', text)],
    );

    expect(failing(claimOf('H3_two_anchors', said))).toEqual([]);
  });

  it('a search by topic before reading the anchor breaks structure before search, and a search for the anchor by id does not', () => {
    const given = goodM7('H9_structure_first');
    const byTopic = calling(given, [
      { tool: 'search', ok: true, input: { query: 'договір юристи підписання' } },
      ...given.memory.calls,
    ]);
    const byId = calling(given, [
      {
        tool: 'search',
        ok: true,
        input: { query: '"a0865184-6cda-69f0-e8e0-3884c8610ce5"', types: ['project'] },
      },
      ...given.memory.calls.filter((call) => call.tool !== 'search'),
    ]);

    expect(failing(claimOf('H9_structure_first', byTopic))).toContain(
      'the run reads the anchor before any free-text search',
    );
    expect(failing(claimOf('H9_structure_first', byId))).toEqual([]);
  });

  it('a read of the anchor that happened but came last does not count as structure before search', () => {
    const given = goodM7('H9_structure_first');
    const late = calling(given, [
      { tool: 'query', ok: true, input: { query: 'договір' } },
      ...given.memory.calls.filter((call) => call.tool === 'get_page'),
    ]);

    expect(failing(claimOf('H9_structure_first', late))).toContain(
      'the run reads the anchor before any free-text search',
    );
  });

  it.each<[string, MemoryEvidence['calls'], boolean]>([
    ['graph traversal with no direction', [linksBy('traverse_graph')], true],
    [
      'graph traversal in both directions',
      [linksBy('traverse_graph', { direction: 'both' })],
      true,
    ],
    [
      'outgoing and incoming as separate calls',
      [linksBy('get_links'), linksBy('get_backlinks')],
      true,
    ],
    ['incoming only', [linksBy('get_backlinks')], false],
    ['outgoing only', [linksBy('get_links')], false],
    ['graph traversal only to the anchor', [linksBy('traverse_graph', { direction: 'in' })], false],
    [
      'both sides, but of another page',
      [{ ...linksBy('traverse_graph'), input: { slug: slugOf('similar') } }],
      false,
    ],
    ['a call that failed', [{ ...linksBy('traverse_graph'), ok: false }], false],
  ])("the anchor's links from both sides: %s", (_name, calls, holds) => {
    const item = 'the run lists the links of the anchor from both sides';
    const failed: string[] = failing(
      claimOf('H9_structure_first', listingLinks(goodM7('H9_structure_first'), calls)),
    );

    expect(failed.includes(item)).toBe(!holds);
  });

  it('a slug in a label reference with a .md extension or in another case is the same page', () => {
    const given = goodM7('H9_structure_first');
    const cited = withTrace(given, {
      result: result(
        ['forgotten_context'],
        [['gbrain', `${slugOf('lesson').toUpperCase()}.md`], ref('waiting')],
      ),
    });

    expect(failing(claimOf('H9_structure_first', cited))).toEqual([]);
  });
});
