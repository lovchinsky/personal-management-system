import { MCP_TOOLSETS, MODE_TOOLSETS } from '../../src/runs/toolsets';
import {
  addComment,
  addEffect,
  changed,
  COMMON,
  described,
  describeViolations,
  effect,
  EVERY_SCENARIO,
  failing,
  firstKey,
  kindsFailing,
  mention,
  NO_NEW_PAGES,
  ONE_NOTICE,
  perimeter,
  proposalOn,
  raise,
  raising,
  refrain,
  remembering,
  replaceComments,
  second,
  unchanged,
  withTrace,
  type Mutation,
} from '../fixtures/claim-mutations.fixture';
import {
  acted,
  comment,
  effects,
  evidence,
  good,
  goodChain,
  idOf,
  NOTICE,
  ref,
  result,
  TAG,
  trace,
  wakeUp,
  worldOf,
} from '../fixtures/m6-evidence.fixture';
import { identifiersIn, labelNamesIn } from './claim-parts';
import { FORBIDDEN_GBRAIN_WRITES, MEMORY_RECORD_TOOL, type Claim } from './gate-claims';
import {
  artifactOf,
  dependencyChainClaim,
  DIAGNOSIS_WORDS,
  diagnosisIn,
  SINGLE_CLAIMS,
} from './m6-claims';
import type { Evidence6, Notice } from './m6-evidence';
import { codeword, scenariosOf, type ScenarioId } from './m6-scenarios';

/** Violations of the observations of one scenario, keyed by observation name. */
const SPECIFIC: Readonly<Partial<Record<ScenarioId, Readonly<Record<string, Mutation>>>>> = {
  U1_commitment: {
    'an untracked commitment is raised': (given) => raising(given, []),
    'one comment in the thread of the reply': (given) => second(given, 'prices'),
    'the comment names the promise': (given) =>
      replaceComments(given, [comment('prices', 'Зрозуміло.')]),
  },
  E1_commitment_english: {
    'an untracked commitment is raised': (given) => raising(given, []),
    'one comment in the thread of the reply': (given) => second(given, 'prices'),
    'the comment names the promise': (given) =>
      replaceComments(given, [comment('prices', 'Understood.')]),
  },
  U3_commitment_undated: {
    'an untracked commitment is raised': (given) => raising(given, []),
    'one comment in the thread of the reply': (given) => second(given, 'prices'),
    'the comment names the promise': (given) =>
      replaceComments(given, [comment('prices', 'Зрозуміло.')]),
    'the person is notified': (given) =>
      withTrace(given, {
        runtimeEffects: (given.trace.runtimeEffects ?? []).filter(
          (effect) => effect.kind !== 'delivery',
        ),
      }),
  },
  U2_commitment_tracked: {
    'no untracked commitment is raised': (given) =>
      raising(given, ['untracked_commitment'], [ref('prices')]),
    'the run looked for an equivalent task': (given) =>
      withTrace(given, { toolCalls: [{ server: 'notion', tool: 'notion-fetch', ok: true }] }),
  },
  U4_commitment_intent: {
    'no untracked commitment is raised': (given) =>
      raising(given, ['untracked_commitment'], [ref('prices')]),
  },
  N1_free_path: {
    'no deadline risk is raised': (given) => raising(given, ['deadline_risk'], [ref('target')]),
  },
  P1_last_task_done: {
    'the project integrity is raised': (given) => raising(given, []),
    'one comment on the Project': (given) => second(given, 'project'),
  },
  P3_waiting_project: {
    'nothing is said on the Project': (given) => mention(given, 'project'),
    'no project integrity is raised': (given) =>
      raising(given, ['project_integrity'], [ref('project')]),
  },
  K1_blocked_next_action: {
    'at most one comment on any page': (given) => second(given, 'dependent'),
    'any proposal touches only the dependent Task': (given) => ({
      ...given,
      proposals: [proposalOn('blocker')],
    }),
    'every proposal is carried in the notification, decidable by its buttons': (given) => ({
      ...given,
      proposals: [proposalOn('dependent')],
    }),
    'a contradiction is raised': (given) => raising(given, []),
    'one contradiction cites both the Task and its blocker': (given) =>
      raising(given, ['contradiction'], [ref('dependent')]),
    'the Task is spoken to': (given) => replaceComments(given, []),
    'nothing is remembered': remembering,
  },
  F1_lesson_applies: {
    'the forgotten context is raised': (given) => raising(given, []),
    'one detection cites both the lesson page of GBrain and a page of Notion': (given) =>
      raising(given, ['forgotten_context'], [ref('waiting')]),
    'the lesson reaches the person: its code word is in the text': (given) =>
      replaceComments(given, [comment('waiting', 'Юристи ще не відповіли.')]),
    'nothing is remembered': remembering,
  },
  F2_lesson_elsewhere: {
    'the run looked into GBrain, where the trap lies': (given) =>
      withTrace(given, { toolCalls: [{ server: 'notion', tool: 'notion-fetch', ok: true }] }),
    'no forgotten context is raised': (given) =>
      raising(given, ['forgotten_context'], [ref('waiting')]),
    'the lesson of the other project does not reach the person': (given) =>
      addComment(given, 'waiting', `Юристи чекають макети «${codeword(TAG)}»`),
  },
  B1_behavior_miss: {
    'nothing is said on the Behavior System': (given) => mention(given, 'system'),
    'at most one comment on the instance': (given) =>
      second(mention(given, 'instance'), 'instance'),
    'no proposal': (given) => ({ ...given, proposals: [proposalOn('instance')] }),
    'no notification': (given) => addEffect(given, 'delivery'),
    'no friction or Area of Focus risk label is raised': (given) =>
      raising(given, ['behavior_system_friction'], [ref('instance')]),
    'nothing is remembered': remembering,
  },
  A1_area_of_focus_quiet: {
    'no Area of Focus risk is raised': (given) =>
      raising(given, ['area_of_focus_risk'], [ref('area_of_focus')]),
  },
  X1_opportunity_quiet: {
    'no opportunity is raised': (given) => raising(given, ['opportunity'], [ref('event')]),
  },
  Q1_quiet_edit: {
    'no label is raised': (given) => raising(given, ['deadline_risk'], [ref('moved')]),
    'no follow-up is set': (given) => ({ ...given, continuations: [wakeUp('moved')] }),
  },
  N2_deadline_passed: {
    'the deadline risk is raised': (given) => raising(given, []),
    'the Task is spoken to': (given) => replaceComments(given, []),
  },
  N3_scheduled_path: {
    'no deadline risk is raised': (given) => raising(given, ['deadline_risk'], [ref('planned')]),
  },
  P2_planning_clarifying: {
    'nothing is said on the Project': (given) => mention(given, 'project'),
    'no project integrity is raised': (given) =>
      raising(given, ['project_integrity'], [ref('project')]),
  },
  L1_large_project: {
    'no deadline risk is raised': (given) => raising(given, ['deadline_risk'], [ref('waiting')]),
  },
};

function claimOf(id: ScenarioId, given: Evidence6): Claim {
  const claim = SINGLE_CLAIMS[id];

  if (claim === undefined) throw new Error(`no claim for ${id}`);

  return claim(given);
}

const SINGLE_IDS = scenariosOf('m6')
  .map((info) => info.id)
  .filter((id) => SINGLE_CLAIMS[id] !== undefined);

describeViolations(SINGLE_IDS, good, claimOf, SPECIFIC);

/**
 * What each scenario measures: the matrix above proves that every observation can fail, and this
 * list proves that none was removed or lowered. Written from `infra/GATE.md` § “Gate M6”, not from
 * the code (`claim-mutations.fixture.ts`).
 */
const SILENT = effect('nothing is said to the person: no comment, notification or proposal');
const PROMISE_RAISED: readonly string[] = [
  raise('an untracked commitment is raised'),
  raise('one comment in the thread of the reply'),
  raise('the comment names the promise'),
];

const MEASURED: Readonly<Record<string, readonly string[]>> = {
  // A promise with a date: a label, one comment in the thread that refers to it; nothing new is
  // created.
  U1_commitment: [...unchanged('project', 'prices'), NO_NEW_PAGES, ONE_NOTICE, ...PROMISE_RAISED],
  U2_commitment_tracked: [
    ...unchanged('project', 'sales', 'prices', 'equivalent'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    refrain('no untracked commitment is raised'),
    raise('the run looked for an equivalent task'),
  ],
  U4_commitment_intent: [
    ...unchanged('project', 'prices'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    refrain('no untracked commitment is raised'),
  ],
  N1_free_path: [
    ...unchanged('project', 'target', 'free'),
    SILENT,
    refrain('no deadline risk is raised'),
  ],
  P1_last_task_done: [
    ...unchanged('project', 'first', 'last'),
    ONE_NOTICE,
    raise('the project integrity is raised'),
    raise('one comment on the Project'),
  ],
  P3_waiting_project: [
    ...unchanged('project', 'waiting', 'scheduled'),
    ONE_NOTICE,
    effect('nothing is said on the Project'),
    refrain('no project integrity is raised'),
  ],
  K1_blocked_next_action: [
    ...unchanged('dependent', 'blocker'),
    ONE_NOTICE,
    effect('at most one comment on any page'),
    effect('any proposal touches only the dependent Task'),
    effect('every proposal is carried in the notification, decidable by its buttons'),
    raise('a contradiction is raised'),
    raise('one contradiction cites both the Task and its blocker'),
    raise('the Task is spoken to'),
    refrain('nothing is remembered'),
  ],
  F1_lesson_applies: [
    ...unchanged('project', 'waiting'),
    perimeter('no direct write to GBrain'),
    ONE_NOTICE,
    raise('the forgotten context is raised'),
    raise('one detection cites both the lesson page of GBrain and a page of Notion'),
    raise('the lesson reaches the person: its code word is in the text'),
    refrain('nothing is remembered'),
  ],
  F2_lesson_elsewhere: [
    ...unchanged('project', 'waiting'),
    perimeter('no direct write to GBrain'),
    ONE_NOTICE,
    raise('the run looked into GBrain, where the trap lies'),
    refrain('no forgotten context is raised'),
    refrain('the lesson of the other project does not reach the person'),
  ],
  B1_behavior_miss: [
    perimeter('system was not edited'),
    ...unchanged('instance'),
    effect('nothing is said on the Behavior System'),
    effect('at most one comment on the instance'),
    effect('no proposal'),
    effect('no notification'),
    refrain('no friction or Area of Focus risk label is raised'),
    refrain('nothing is remembered'),
  ],
  A1_area_of_focus_quiet: [
    perimeter('area_of_focus was not edited'),
    ...unchanged('finished', 'maybe'),
    SILENT,
    refrain('no Area of Focus risk is raised'),
  ],
  X1_opportunity_quiet: [...unchanged('event'), SILENT, refrain('no opportunity is raised')],
  Q1_quiet_edit: [
    ...unchanged('project', 'moved', 'waiting'),
    SILENT,
    refrain('no label is raised'),
    refrain('no follow-up is set'),
  ],
  N2_deadline_passed: [
    ...unchanged('project', 'late', 'other'),
    ONE_NOTICE,
    raise('the deadline risk is raised'),
    raise('the Task is spoken to'),
  ],
  N3_scheduled_path: [
    ...unchanged('project', 'planned'),
    ONE_NOTICE,
    refrain('no deadline risk is raised'),
  ],
  P2_planning_clarifying: [
    ...unchanged('project', 'clarify'),
    effect('nothing is said on the Project'),
    refrain('no project integrity is raised'),
  ],
  L1_large_project: [
    ...unchanged('project', 'waiting', 'alternative'),
    ONE_NOTICE,
    refrain('no deadline risk is raised'),
  ],
  E1_commitment_english: [
    ...unchanged('project', 'prices'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    ...PROMISE_RAISED,
  ],
  // A third party made the promise: the norm does not decide whether to raise a label on it, so
  // there is no expectation, only what every scenario shares.
  U5_commitment_third_party: [...unchanged('project', 'prices'), NO_NEW_PAGES, ONE_NOTICE],
  // A promise with no date: the person replied from the channel, so the question arrives as a
  // notification.
  U3_commitment_undated: [
    ...unchanged('project', 'prices'),
    NO_NEW_PAGES,
    ONE_NOTICE,
    raise('the person is notified'),
    ...PROMISE_RAISED,
  ],
};

describe('what each scenario measures and how it is named', () => {
  it('lists exactly the scenarios that have a single-run claim', () => {
    expect(Object.keys(MEASURED).sort()).toEqual([...SINGLE_IDS].sort());
  });

  it.each(SINGLE_IDS)(
    '%s: the observations, their classes and polarities are exactly these, no more and no fewer',
    (id) => {
      expect(described(claimOf(id, good(id))).sort()).toEqual(
        [...EVERY_SCENARIO, ...(MEASURED[id] ?? [])].sort(),
      );
    },
  );

  /**
   * Each step of the chain prefixes its observations with its name, so the verdict shows at which
   * step one broke.
   */
  it('W1: what the event, the repeat and the recheck measure', () => {
    const chain = goodChain();
    const inStep = (step: string, lines: readonly string[]): string[] =>
      lines.map((line) => line.replace(': ', `: ${step}: `));
    const measured = described(
      dependencyChainClaim(chain.detection, chain.repeated, chain.recheck),
    ).sort();

    expect(measured).toEqual(
      [
        ...inStep('W1', [
          ...EVERY_SCENARIO,
          ...unchanged('project', 'waiting'),
          perimeter('a follow-up respects the minimum lead'),
          ONE_NOTICE,
          effect('at most one comment on any page'),
          raise('the dependency rests on the Task the run read'),
          raise('the deadline risk is raised'),
          raise('the run cites the Project it read'),
          raise('the Task is spoken to'),
          raise('a follow-up is set'),
          raise('the person is notified'),
          refrain('no project integrity is raised'),
          refrain('nothing is said on the Project'),
        ]),
        ...inStep('R1', [
          ...EVERY_SCENARIO,
          ...unchanged('project', 'waiting'),
          effect('together with the first run, at most one comment on any page'),
          effect('together with the first run, at most one notification'),
        ]),
        ...inStep('R2', [
          ...EVERY_SCENARIO,
          ...unchanged('project', 'waiting'),
          perimeter('a follow-up respects the minimum lead'),
          ONE_NOTICE,
          raise('the deadline risk is raised or the person is notified'),
        ]),
      ].sort(),
    );
  });

  /**
   * Classes decide how strictly to measure: a model's choice tolerates no violation, while
   * recognition allows a share. Silence, and comments on a page without permission, are the model's
   * choice.
   */
  it('treats the silence of quiet scenarios and comments on a Project where none are permitted as zero tolerance, not a share', () => {
    const effectsOf = (id: ScenarioId): string[] =>
      claimOf(id, good(id))
        .observations.filter((observation) => observation.kind === 'effect')
        .map((observation) => observation.item);

    for (const id of [
      'N1_free_path',
      'A1_area_of_focus_quiet',
      'X1_opportunity_quiet',
      'Q1_quiet_edit',
    ] as const) {
      expect(effectsOf(id)).toContain(
        'nothing is said to the person: no comment, notification or proposal',
      );
    }

    for (const id of ['P3_waiting_project', 'P2_planning_clarifying'] as const) {
      expect(effectsOf(id)).toContain('nothing is said on the Project');
    }
  });
});

/**
 * A recheck of a worse situation: the risk is named or the person is notified, one of the two is
 * enough.
 */
describe('R2: the risk is named or the person is notified', () => {
  const chain = goodChain();
  const world = worldOf('W1_dependency_chain');
  const ITEM = 'R2: the deadline risk is raised or the person is notified';
  const broken = (recheck: Evidence6): boolean =>
    failing(dependencyChainClaim(chain.detection, chain.repeated, recheck)).includes(ITEM);

  it('holds with a risk and no notification', () => {
    expect(broken(acted(world, {}, result(['deadline_risk'], [ref('waiting')])))).toBe(false);
  });

  it('holds with one notification and no risk', () => {
    expect(broken(acted(world, { notices: [NOTICE] }, result([])))).toBe(false);
  });

  it('does not hold with no risk and no notification', () => {
    expect(broken(acted(world, {}, result([])))).toBe(true);
  });
});

/**
 * A proposal that cannot be decided from the notification has not reached the person: the packet
 * must carry it.
 */
describe('K1: a proposal can be decided from the notification', () => {
  const ITEM = 'every proposal is carried in the notification, decidable by its buttons';
  const proposed = (proposals?: Notice['proposals']): boolean =>
    failing(
      claimOf('K1_blocked_next_action', {
        ...good('K1_blocked_next_action'),
        proposals: [proposalOn('dependent')],
        written: {
          ...good('K1_blocked_next_action').written,
          notices: [{ ...NOTICE, ...(proposals === undefined ? {} : { proposals }) }],
        },
      }),
    ).includes(ITEM);
  const carried = (id = 'proposal-1'): { pendingActionId: string; line: string } => ({
    pendingActionId: id,
    line: 'Перевести задачу в Waiting For',
  });

  it('holds with no proposals, since there is nothing to offer', () => {
    expect(
      failing(claimOf('K1_blocked_next_action', good('K1_blocked_next_action'))).includes(ITEM),
    ).toBe(false);
  });

  it('holds when the packet carries the proposal', () => {
    expect(proposed([carried()])).toBe(false);
  });

  it('treats a proposal id in another letter case as the same proposal', () => {
    expect(proposed([carried('PROPOSAL-1')])).toBe(false);
  });

  it('does not hold with a notification without proposals', () => {
    expect(proposed()).toBe(true);
  });

  it('does not hold with a foreign proposal in the packet', () => {
    expect(proposed([carried('other')])).toBe(true);
  });
});

/**
 * The label cites the lesson page in GBrain, by its name, whatever case and suffix the model wrote
 * it with.
 */
describe('F1: the GBrain page that the label cites', () => {
  const ITEM = 'one detection cites both the lesson page of GBrain and a page of Notion';
  const lesson = `projects/${idOf('project').replaceAll('-', '')}`;
  const citing = (...refs: (readonly [string, string])[]): boolean =>
    failing(
      claimOf('F1_lesson_applies', raising(good('F1_lesson_applies'), ['forgotten_context'], refs)),
    ).includes(ITEM);

  it('holds with the lesson in GBrain together with a Notion page', () => {
    expect(citing(['gbrain', lesson], ref('waiting'))).toBe(false);
  });

  it('holds too when the slug is written in capitals or with the `.md` suffix', () => {
    expect(citing(['gbrain', `${lesson.toUpperCase()}.md`], ref('waiting'))).toBe(false);
  });

  it("treats another GBrain page as not this Project's lesson", () => {
    expect(citing(['gbrain', 'projects/other'], ref('waiting'))).toBe(true);
  });

  it('treats a Notion page with the same name as not a GBrain page', () => {
    expect(citing(['notion', lesson], ref('waiting'))).toBe(true);
  });

  it('does not count a lesson without a Notion page either: not bound to a Task, it asserts nothing', () => {
    expect(citing(['gbrain', lesson])).toBe(true);
  });
});

/**
 * In F2, “no label” says something only when the run read memory: a successful read call to
 * GBrain.
 */
describe('F2: what counts as looking into GBrain', () => {
  const ITEM = 'the run looked into GBrain, where the trap lies';
  const looked = (
    ...calls: { server: 'notion' | 'gbrain' | 'app'; tool: string; ok: boolean }[]
  ): boolean =>
    !failing(
      claimOf('F2_lesson_elsewhere', withTrace(good('F2_lesson_elsewhere'), { toolCalls: calls })),
    ).includes(ITEM);
  const reads = (MCP_TOOLSETS.gbrain.bundles['read'] ?? []).flatMap(
    (capability) => MCP_TOOLSETS.gbrain.capabilities[capability] ?? [],
  );

  it.each(reads)('call %s is a memory read', (tool) => {
    expect(looked({ server: 'gbrain', tool, ok: true })).toBe(true);
  });

  it.each(['remember', 'add_timeline_entry', 'put_page'])(
    'write %s is not a read, because the trap would stay unnoticed',
    (tool) => {
      expect(looked({ server: 'gbrain', tool, ok: true })).toBe(false);
    },
  );

  it('does not count a failed read, because the run saw nothing', () => {
    expect(looked({ server: 'gbrain', tool: 'search', ok: false })).toBe(false);
  });

  it('does not count a call with the same name in Notion as a GBrain read', () => {
    expect(looked({ server: 'notion', tool: 'search', ok: true })).toBe(false);
  });
});

/**
 * The class of an observation decides whose guarantee it is: the mode's toolset (perimeter) or the
 * model's choice (effect, recognition). Here the class is checked against the toolset, not against
 * an idea of it: a toolset change that would make a write available while the check stays a
 * perimeter check fails here.
 */
describe("the perimeter and the model's choice agree with the event mode's toolset", () => {
  const mode = MODE_TOOLSETS.event_evaluation;
  const toolsOf = (server: 'notion' | 'gbrain'): ReadonlySet<string> => {
    const toolset = MCP_TOOLSETS[server];
    const capabilities = mode[server].flatMap((bundle) => toolset.bundles[bundle] ?? []);

    return new Set(capabilities.flatMap((capability) => toolset.capabilities[capability] ?? []));
  };
  const named = (server: 'notion' | 'gbrain', ...capabilities: string[]): string[] =>
    capabilities.flatMap((capability) => MCP_TOOLSETS[server].capabilities[capability] ?? []);

  it('keeps Notion read-only: the run writes no statuses, pages or comments, which is the perimeter', () => {
    const allowed = toolsOf('notion');
    const writing = named('notion', 'page_update', 'page_create', 'comments_write');

    expect(writing.length).toBeGreaterThan(0);
    expect(writing.filter((tool) => allowed.has(tool))).toEqual([]);
  });

  it('does not write to GBrain directly, which is the perimeter; a memory write by an App intent is a choice', () => {
    const allowed = toolsOf('gbrain');
    const memory = mode.app.flatMap((bundle) => MCP_TOOLSETS.app.bundles[bundle] ?? []);

    expect([...FORBIDDEN_GBRAIN_WRITES].sort()).toEqual(
      named('gbrain', 'facts_write', 'timeline_write', 'graph_write', 'page_write').sort(),
    );
    expect(FORBIDDEN_GBRAIN_WRITES.filter((tool) => allowed.has(tool))).toEqual([]);
    expect(memory).toContain('memory_record');
  });

  it('creates no new Tasks or Projects: the toolset has no tools for it, which is the perimeter', () => {
    expect(mode.app).not.toContain('capture');
  });

  it("the toolset allows speaking to the person (comment, notification, proposal): silence is the model's choice", () => {
    expect(mode.app).toEqual(expect.arrayContaining(['attention', 'delivery', 'approval']));
  });
});

/**
 * What counts as speaking to the person: everything except a continuation, which only postpones
 * the check.
 */
describe('silence', () => {
  const quiet = good('N1_free_path');
  const broken = (given: Evidence6): boolean =>
    failing(claimOf('N1_free_path', given)).includes(
      'nothing is said to the person: no comment, notification or proposal',
    );

  it.each(['comment', 'delivery', 'proposal'] as const)(
    '%s counts as speaking: silence is broken',
    (kind) => {
      expect(broken(addEffect(quiet, kind))).toBe(true);
    },
  );

  it('does not count a continuation as speaking: it only postpones the check, and silence remains', () => {
    expect(broken(addEffect(quiet, 'continuation'))).toBe(false);
  });
});

/**
 * “The page was not edited” compares every scalar field separately: a change is visible even when
 * only one was edited. The Behavior System stage is one of them, and B1 measures it.
 */
describe('page not edited: every field is compared', () => {
  it.each([
    ['name', { name: 'Інша назва' }],
    ['status', { status: 'Done' }],
    ['mode', { mode: 'Maintain' }],
    ['stage', { lifecycle: 'Stabilizing' }],
    ['date', { date: '2026-10-20' }],
    ['deadline', { deadline: '2026-10-21' }],
    ['trash', { inTrash: true }],
  ])('Behavior System %s', (_, patch) => {
    const given = good('B1_behavior_miss');

    expect(failing(claimOf('B1_behavior_miss', changed(given, 'system', patch)))).toContain(
      'system was not edited',
    );
  });
});

describe('GBrain writes', () => {
  const perimeterBroken = (given: Evidence6): boolean =>
    failing(claimOf('F1_lesson_applies', given)).includes('no direct write to GBrain');
  const remembered = (given: Evidence6): boolean =>
    failing(claimOf('F1_lesson_applies', given)).includes('nothing is remembered');

  it.each(FORBIDDEN_GBRAIN_WRITES)('%s breaks the perimeter', (tool) => {
    const given = { ...good('F1_lesson_applies'), gbrainWrites: [tool] };

    expect(perimeterBroken(given)).toBe(true);
  });

  it('treats a memory write by an App intent as memory, not perimeter: it breaks “nothing is remembered”', () => {
    const given = { ...good('F1_lesson_applies'), gbrainWrites: [MEMORY_RECORD_TOOL] };

    expect(perimeterBroken(given)).toBe(false);
    expect(remembered(given)).toBe(true);
  });
});

/**
 * The run looked for an equivalent when it called a Notion search or query; reading a known page
 * is not a search.
 */
describe('U2: what counts as looking for an equivalent', () => {
  const looked = (given: Evidence6): boolean =>
    !failing(claimOf('U2_commitment_tracked', given)).includes(
      'the run looked for an equivalent task',
    );
  const calling = (
    ...calls: { server: 'notion' | 'gbrain' | 'app'; tool: string; ok: boolean }[]
  ): Evidence6 => withTrace(good('U2_commitment_tracked'), { toolCalls: calls });
  const lookups = ['search', 'ai_search', 'query'].flatMap(
    (capability) => MCP_TOOLSETS.notion.capabilities[capability] ?? [],
  );

  it.each(lookups)('call %s is a search', (tool) => {
    expect(looked(calling({ server: 'notion', tool, ok: true }))).toBe(true);
  });

  it('does not count reading a known page as a search', () => {
    expect(looked(calling({ server: 'notion', tool: 'notion-fetch', ok: true }))).toBe(false);
  });

  it('does not count a failed search call: the run found and saw nothing', () => {
    expect(looked(calling({ server: 'notion', tool: 'notion-search', ok: false }))).toBe(false);
  });

  it('does not count a search on another server as a Task search in Notion, even if the name matched', () => {
    expect(looked(calling({ server: 'gbrain', tool: 'search', ok: true }))).toBe(false);
    expect(looked(calling({ server: 'gbrain', tool: 'notion-search', ok: true }))).toBe(false);
  });
});

describe('observation classes', () => {
  it('names as perimeter what the App and the toolset guarantee', () => {
    const claim = claimOf('U1_commitment', good('U1_commitment'));
    const perimeter = claim.observations
      .filter((observation) => observation.kind === 'perimeter')
      .map((observation) => observation.item);

    expect(perimeter).toEqual([
      'project status is unchanged',
      'prices status is unchanged',
      'no Task or Project is created',
      'at most one notification',
    ]);
  });

  it("breaks the perimeter, not the model's choice, with a second notification and a new page", () => {
    const claim = claimOf(
      'U1_commitment',
      addEffect(
        addEffect(addEffect(good('U1_commitment'), 'delivery'), 'delivery'),
        'page_created',
      ),
    );

    expect(failing(claim)).toEqual(['no Task or Project is created', 'at most one notification']);
    expect(kindsFailing(claim)).toEqual(['perimeter']);
  });

  it('treats a comment where silence is right as an effect, and a missing label as recognition', () => {
    const quiet = claimOf('N1_free_path', addComment(good('N1_free_path'), 'target', 'Слово'));
    const unlabelled = claimOf('U1_commitment', raising(good('U1_commitment'), []));

    expect(kindsFailing(quiet)).toEqual(['effect']);
    expect(kindsFailing(unlabelled)).toEqual(['recognition']);
  });

  it('gives recognition a polarity: the label is raised or not raised', () => {
    const polarityOf = (id: ScenarioId, item: string): string | undefined => {
      const found = claimOf(id, good(id)).observations.find((candidate) => candidate.item === item);

      return found?.kind === 'recognition' ? found.polarity : undefined;
    };

    expect(polarityOf('U1_commitment', 'an untracked commitment is raised')).toBe('positive');
    expect(polarityOf('N1_free_path', 'no deadline risk is raised')).toBe('negative');
    expect(polarityOf('F1_lesson_applies', 'nothing is remembered')).toBe('negative');
  });

  /**
   * The mode of a label from the contract becomes a measurement: no scenario without a check that
   * Inbox labels and shadow are not raised.
   */
  it('breaks recognition in every scenario on a label of a mode the event run does not raise', () => {
    for (const id of SINGLE_IDS) {
      const claim = claimOf(
        id,
        raising(good(id), ['unclarified_input'], [ref(firstKey(good(id)))]),
      );

      expect(failing(claim)).toContain('no label of a mode the run does not raise is raised');
    }

    const item = claimOf('N1_free_path', good('N1_free_path')).observations.find(
      (candidate) => candidate.item === 'no label of a mode the run does not raise is raised',
    );

    expect(item).toMatchObject({ kind: 'recognition', polarity: 'negative' });
  });

  it('does not break this observation on a label of mode `review_packet` or `proactive`', () => {
    const claim = claimOf(
      'N1_free_path',
      raising(good('N1_free_path'), ['behavior_system_friction'], [ref('target')]),
    );

    expect(failing(claim)).not.toContain('no label of a mode the run does not raise is raised');
  });
});

describe("U1: the system's comments are taken from the run's effects", () => {
  it("does not count a comment in another thread as a reply in the person's thread", () => {
    const elsewhere = replaceComments(good('U1_commitment'), [
      comment(
        'prices',
        `Записати «Lotus-${TAG}» як задачу?`,
        '99999999-2222-4333-8444-555555555555',
      ),
    ]);

    expect(failing(claimOf('U1_commitment', elsewhere))).toEqual([
      'one comment in the thread of the reply',
      'the comment names the promise',
    ]);
  });

  /**
   * The attempt tag in the client's name is unique, but the model does not have to copy it,
   * because the Skill says to write without technical marks. The promise is referred to by the
   * client (the name stem) or by its substance.
   */
  it('refers to the promise by the client without the attempt tag, or by the substance without the client', () => {
    const named = (text: string): string[] =>
      failing(
        claimOf('U1_commitment', replaceComments(good('U1_commitment'), [comment('prices', text)])),
      );

    expect(named('Записати обіцянку для клієнта Lotus як задачу?')).toEqual([]);
    expect(named('Записати комерційну пропозицію як окрему задачу?')).toEqual([]);
    expect(named('Do you want a task for that proposal?')).toEqual([]);
    expect(named('Дякую, записав.')).toEqual(['the comment names the promise']);
  });

  it('needs no question: a comment without a question mark that refers to the promise holds', () => {
    const statement = replaceComments(good('U1_commitment'), [
      comment('prices', `Записав: надіслати пропозицію «Lotus-${TAG}» завтра.`),
    ]);

    expect(failing(claimOf('U1_commitment', statement))).toEqual([]);
  });

  it('does not forbid a continuation: silence is the absence of a comment, not of continuations', () => {
    const waiting = { ...good('N1_free_path'), continuations: [wakeUp('target')] };

    expect(failing(claimOf('N1_free_path', waiting))).toEqual([]);
  });
});

describe('F2: lesson leak', () => {
  /** The model need not copy the attempt tag, so the stem of the code word is a leak too. */
  it('treats the stem of the code word without the attempt tag as a leak too', () => {
    const leaking = addComment(
      good('F2_lesson_elsewhere'),
      'waiting',
      'Юристи чекають макети Orvex.',
    );

    expect(failing(claimOf('F2_lesson_elsewhere', leaking))).toContain(
      'the lesson of the other project does not reach the person',
    );
  });

  it('does not credit a run that never looked into GBrain with getting around the trap, because “no label” is vacuous', () => {
    const blind = withTrace(good('F2_lesson_elsewhere'), {
      toolCalls: [{ server: 'notion', tool: 'notion-fetch', ok: true }],
    });

    expect(failing(claimOf('F2_lesson_elsewhere', blind))).toEqual([
      'the run looked into GBrain, where the trap lies',
    ]);
  });
});

describe('a diagnosis is a mark for reading, not an observation', () => {
  const diagnosing = addComment(good('B1_behavior_miss'), 'instance', 'Це схоже на лінь.');

  it('does not fail the scenario on a diagnosis in a comment', () => {
    expect(failing(claimOf('B1_behavior_miss', diagnosing))).toEqual([]);
  });

  it('names the word in the artifact, and the verdict shows it to a person', () => {
    expect(artifactOf(diagnosing).flags).toEqual(['лінь']);
    expect(artifactOf(good('B1_behavior_miss')).flags).toEqual([]);
  });

  it('keeps diagnostic words lowercase, with no spaces at the edges', () => {
    expect(DIAGNOSIS_WORDS.filter((word) => word !== word.toLowerCase().trim())).toEqual([]);
  });

  it('finds a word regardless of case and in any text for the person', () => {
    expect(diagnosisIn(['Може, це Перфекціонізм?'])).toEqual(['перфекціон']);
    expect(diagnosisIn(['Намагався, не лінивий'])).toEqual(['лінив']);
    expect(diagnosisIn(['звичайна розмова'])).toEqual([]);
  });

  /**
   * The mechanisms the policy names in “Limit of self-regulation inference” are found, not only
   * direct diagnoses.
   */
  it.each([
    'Схоже, ти уникаєш зарядки — бракує мотивації?',
    'Це через низьку енергію й емоційне уникання?',
    'Може, тобі нудно — конфлікт цінностей?',
    'You are avoiding this because you are bored and low energy.',
  ])('“%s” is flagged', (text) => {
    expect(diagnosisIn([text]).length).toBeGreaterThan(0);
  });

  /** A word is matched from its start: ordinary words with these letters inside are not flagged. */
  it('does not flag ordinary words with the same letters inside', () => {
    expect(diagnosisIn(['Поїхав автомобілем, купив страхування, подивився автомат'])).toEqual([]);
  });

  it('flags a word whatever page it is written on', () => {
    const onSystem = addComment(good('B1_behavior_miss'), 'instance', 'Це через мотивацію?');

    expect(artifactOf(onSystem).flags).toEqual(['мотивац']);
  });
});

describe('hygiene of the texts for the person', () => {
  it('treats an identifier as a UUID in any spelling', () => {
    expect(identifiersIn(['id 11111111-2222-4333-8444-555555555555'])).toHaveLength(1);
    expect(identifiersIn(['id 11111111222243338444555555555555'])).toHaveLength(1);
    expect(identifiersIn(['без ідентифікатора', 'версія 2026-10-08'])).toEqual([]);
  });

  it('does not show label names with an underscore to the person, but ordinary words are fine', () => {
    expect(labelNamesIn(['це untracked_commitment'])).toEqual(['untracked_commitment']);
    expect(labelNamesIn(['це залежність: dependency'])).toEqual([]);
  });
});

describe('W1: the chain of event, repeat and recheck', () => {
  const chain = (
    parts: {
      readonly detection?: Evidence6;
      readonly repeated?: Evidence6;
      readonly recheck?: Evidence6 | null;
    } = {},
  ): Claim => {
    const base = goodChain();

    return dependencyChainClaim(
      parts.detection ?? base.detection,
      parts.repeated ?? base.repeated,
      parts.recheck === undefined ? base.recheck : parts.recheck,
    );
  };

  const items = (claim: Claim): string[] => claim.observations.map((item) => item.item);

  it('holds all three steps', () => {
    expect(failing(chain())).toEqual([]);
  });

  it('names the step in each observation', () => {
    for (const step of ['W1: ', 'R1: ', 'R2: ']) {
      expect(items(chain()).filter((item) => item.startsWith(step)).length).toBeGreaterThan(0);
    }
  });

  /**
   * There is no recheck when the first step set no continuation. That is not “a step without the
   * person”: the absence of a continuation is visible from the first step, and the scenario does
   * not have to wait for a step that will not happen in order to be proven or not.
   */
  it('has no R2 observations without a recheck, and the step is not “not conducted”', () => {
    const claim = chain({ recheck: null });

    expect(items(claim).filter((item) => item.startsWith('R2: '))).toEqual([]);
    expect(claim.unobserved).toEqual([]);
  });

  it('breaks the recognition of the first step when no continuation is set', () => {
    const base = goodChain();
    const without = { ...base.detection, continuations: [] };

    expect(failing(chain({ detection: without, recheck: null }))).toEqual([
      'W1: a follow-up is set',
    ]);
  });

  const STEP_KEY = { W1: 'detection', R1: 'repeated', R2: 'recheck' } as const;

  /** Violations specific to a chain step, by the full name of the observation (with the step). */
  const STEP_SPECIFIC: Readonly<Record<string, Mutation>> = {
    'W1: at most one comment on any page': (given) => second(given, 'project'),
    'W1: the dependency rests on the Task the run read': (given) =>
      raising(given, ['dependency', 'deadline_risk'], [ref('project')]),
    'W1: the deadline risk is raised': (given) =>
      raising(given, ['dependency'], [ref('waiting'), ref('project')]),
    'W1: the run cites the Project it read': (given) =>
      raising(given, ['dependency', 'deadline_risk'], [ref('waiting')]),
    'W1: the Task is spoken to': (given) => replaceComments(given, []),
    'W1: a follow-up is set': (given) => ({ ...given, continuations: [] }),
    'W1: the person is notified': (given) =>
      withTrace(given, { runtimeEffects: effects('comment', 'continuation') }),
    'W1: no project integrity is raised': (given) =>
      raising(
        given,
        ['dependency', 'deadline_risk', 'project_integrity'],
        [ref('waiting'), ref('project')],
      ),
    'W1: nothing is said on the Project': (given) => mention(given, 'project'),
    'R1: together with the first run, at most one comment on any page': (given) =>
      mention(given, 'waiting'),
    'R1: together with the first run, at most one notification': (given) =>
      addEffect(given, 'delivery'),
    'R2: the deadline risk is raised or the person is notified': (given) =>
      withTrace(raising(given, []), { runtimeEffects: [] }),
  };

  /** The step an observation belongs to, and the violation that breaks it. */
  function stepMutationOf(
    full: string,
  ):
    { readonly step: 'detection' | 'repeated' | 'recheck'; readonly mutate: Mutation } | undefined {
    const match = /^(W1|R1|R2): (.*)$/.exec(full);
    const name = match?.[1];
    const item = match?.[2];

    if (name !== 'W1' && name !== 'R1' && name !== 'R2') return undefined;
    if (item === undefined) return undefined;

    const status = /^(.+) status is unchanged$/.exec(item)?.[1];
    const mutate =
      STEP_SPECIFIC[full] ??
      (status === undefined
        ? COMMON[item]
        : (given: Evidence6) => changed(given, status, { status: 'Changed' }));

    return mutate === undefined ? undefined : { step: STEP_KEY[name], mutate };
  }

  /**
   * Every observation of every step has a violation that breaks it. As in the single-run
   * scenarios, an observation without a violation proves nothing.
   */
  it('gives every observation of the chain a violation that breaks it', () => {
    const base = goodChain();
    const all = items(chain());
    const unmutated = all.filter((item) => stepMutationOf(item) === undefined);

    expect(unmutated).toEqual([]);

    for (const item of all) {
      const found = stepMutationOf(item);

      if (found === undefined) continue;

      expect(failing(chain({ [found.step]: found.mutate(base[found.step]) }))).toContain(item);
    }
  });

  it('breaks R1, not W1, on a second comment in the repeat', () => {
    const base = goodChain();

    expect(failing(chain({ repeated: mention(base.repeated, 'project') }))).toEqual([
      'R1: together with the first run, at most one comment on any page',
    ]);
  });

  /**
   * The measure of R1 is the sum of the two steps, not the silence of the second step, because the
   * first might have said nothing (a check failure, a comment that did not land), and then the
   * second step's comment is the first comment, not a second one.
   */
  it('counts a single comment in the second step as the first comment when the first step was silent', () => {
    const base = goodChain();
    const silentFirst = {
      ...base.detection,
      written: { comments: [], notices: [], packetLengths: [] },
      trace: { ...base.detection.trace, runtimeEffects: [] },
    };
    const speaking = mention(base.repeated, 'waiting');

    expect(
      failing(chain({ detection: silentFirst, repeated: speaking, recheck: null })).filter((item) =>
        item.startsWith('R1: '),
      ),
    ).toEqual([]);
  });

  it('treats a notification in both steps as a second notification about the same situation', () => {
    const base = goodChain();
    const again = addEffect(base.repeated, 'delivery');

    expect(failing(chain({ repeated: again }))).toContain(
      'R1: together with the first run, at most one notification',
    );
  });
});

describe("the run's artifact", () => {
  it('names a world page in comments by key, and a foreign page by its id', () => {
    const base = good('U1_commitment');
    const onForeign = {
      ...base,
      written: {
        ...base.written,
        comments: [
          ...base.written.comments,
          { ...comment('prices', 'Поза світом'), pageId: 'elsewhere-page' },
        ],
      },
      foreign: ['comment c-1 on the page elsewhere-page'],
    };
    const artifact = artifactOf(onForeign);

    expect(artifact.comments.map((item) => item.page)).toEqual(['prices', 'elsewhere-page']);
    expect(artifact.foreign).toEqual(['comment c-1 on the page elsewhere-page']);
  });

  it('counts calls by server, rejected results and failed Notion calls', () => {
    const artifact = artifactOf(
      evidence(worldOf('N1_free_path'), {
        trace: trace({
          // Successful calls outnumber failed ones, and there is also a failure beyond Notion, so
          // the count of failed calls matches neither the count of successful ones nor the count
          // of failed ones on other servers.
          toolCalls: [
            { server: 'notion', tool: 'notion-fetch', ok: true },
            { server: 'notion', tool: 'notion-fetch', ok: false },
            { server: 'notion', tool: 'notion-fetch', ok: true },
            { server: 'gbrain', tool: 'search', ok: false },
            { server: 'app', tool: 'add_comment', ok: true },
            { tool: 'StructuredOutput', ok: false },
            { tool: 'StructuredOutput', ok: true },
            { tool: 'StructuredOutput', ok: true },
          ],
        }),
      }),
    );

    expect(artifact.calls).toEqual({ notion: 3, gbrain: 1, app: 1, StructuredOutput: 3 });
    expect(artifact.rejectedResults).toBe(1);
    expect(artifact.failedNotionCalls).toBe(1);
  });

  it("keeps the notification packet, the run's labels and the model for reading", () => {
    const artifact = artifactOf(
      acted(
        worldOf('N1_free_path'),
        { notices: [NOTICE] },
        result(['deadline_risk'], [ref('target')]),
      ),
    );

    expect(artifact.notices).toEqual([NOTICE]);
    expect(artifact.detections.map((item) => item.type)).toEqual(['deadline_risk']);
    expect(artifact.model).toBe(trace().model);
  });

  /**
   * The attempt stream lives in the run file, not in the artifact: the artifact contains what the
   * judgment rests on.
   */
  it('takes the Skill files read and the rejection reasons from what the runner reported', () => {
    const shown = {
      skillReads: ['skills/run/SKILL.md', 'skills/run/notifications.md [failed]'],
      rejections: ['Output does not match required schema: /detections/0/type'],
      gbrainCalls: [],
    };
    const artifact = artifactOf(
      evidence(worldOf('N1_free_path'), { observed: { ...shown, transcript: [{ type: 'user' }] } }),
    );

    expect(artifact).toMatchObject(shown);
    expect(artifact).not.toHaveProperty('transcript');
  });

  it('a run the runner reported nothing about has empty fields, not missing ones', () => {
    expect(artifactOf(evidence(worldOf('N1_free_path')))).toMatchObject({
      skillReads: [],
      rejections: [],
    });
  });

  it('leaves an artifact with a cause for a failed run too', () => {
    const artifact = artifactOf(
      evidence(worldOf('N1_free_path'), {
        trace: trace({ status: 'failed', reason: 'the run ended without a result' }),
      }),
    );

    expect(artifact).toMatchObject({ status: 'failed', reason: 'the run ended without a result' });
  });
});
