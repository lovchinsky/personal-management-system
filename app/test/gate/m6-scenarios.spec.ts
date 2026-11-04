import { RELEVANT_SLOTS } from '../../src/intake/notion/relevance.gate';
import { SINGLE_CLAIMS } from './m6-claims';
import { PROMISE_TOMORROW, variantOf } from './m6-phrasing';
import {
  CHAIN_SLOTS,
  clientOf,
  codeword,
  plantedMemoryOf,
  PROCEDURES,
  SCENARIOS,
  scenariosOf,
  shortOf,
  SINGLE_RUNS,
  tagOf,
  variantNumber,
  worldOf,
  type ScenarioId,
} from './m6-scenarios';
import type { M7ScenarioId } from './m7-scenarios';
import type { M8ScenarioId } from './m8-scenarios';
import type { M9ScenarioId } from './m9-scenarios';

const TAG = '4821-u1-1';

/**
 * The scenarios of suite M6: the catalog is shared with M7, but the descriptions here are only
 * about M6.
 */
const M6_SCENARIOS = scenariosOf('m6');

describe('gate M6 scenarios', () => {
  it('count and distribution: 14 blocking, 7 recorded, held-out are U2, U4, X1, Q1 and U5', () => {
    expect(M6_SCENARIOS.filter((info) => info.tier === 'blocking')).toHaveLength(14);
    expect(M6_SCENARIOS.filter((info) => info.tier === 'recorded')).toHaveLength(7);
    expect(M6_SCENARIOS.filter((info) => info.heldOut).map((info) => shortOf(info.id))).toEqual([
      'U2',
      'U4',
      'X1',
      'Q1',
      'U5',
    ]);
  });

  it('adoption is only U3 and N3: the baseline fails them by construction', () => {
    expect(
      SCENARIOS.filter((info) => info.purpose === 'adoption').map((info) => shortOf(info.id)),
    ).toEqual(['N3', 'U3']);
  });

  /**
   * A prefix identifies a scenario in the `--only` option of its suite, so it must be unique in the
   * suite.
   */
  it('ids are not repeated, and the prefixes for --only are unique within a suite', () => {
    const ids = SCENARIOS.map((info) => info.id);

    expect(new Set(ids).size).toBe(ids.length);

    for (const suite of ['m6', 'm7', 'm8', 'm9'] as const) {
      const names = scenariosOf(suite).map((info) => shortOf(info.id));

      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('each scenario is described in exactly one way: a single-run one with a claim, the rest as a procedure', () => {
    const described = SCENARIOS.map((info) => [
      info.id,
      (SINGLE_RUNS[info.id] !== undefined) !== (PROCEDURES[info.id] !== undefined),
    ]);
    const unclaimed = SCENARIOS.filter(
      (info) => SINGLE_RUNS[info.id] !== undefined && SINGLE_CLAIMS[info.id] === undefined,
    );

    expect(described.filter(([, once]) => !once)).toEqual([]);
    expect(unclaimed).toEqual([]);

    expect(
      SCENARIOS.filter(
        (info) => !['m8', 'm9'].includes(info.suite) && PROCEDURES[info.id] !== undefined,
      ).map((info) => info.id),
    ).toEqual(['W1_dependency_chain']);
  });

  describe.each(SCENARIOS.map((info) => info.id))('%s', (id) => {
    const world = worldOf(id, TAG);

    it('page keys are not repeated, and references lead to pages created earlier', () => {
      const created = new Set<string>();

      for (const page of world) {
        expect(created.has(page.key)).toBe(false);

        const links = [
          ...(page.type === 'task'
            ? [page.project, page.areaOfFocus, page.behaviorSystem, ...(page.blockedBy ?? [])]
            : []),
          ...(page.type === 'area_of_focus' ? (page.identities ?? []) : []),
          ...(page.type === 'key_result' ? [page.objective] : []),
        ].filter((key): key is string => key !== undefined);

        for (const key of links) expect(created.has(key)).toBe(true);

        created.add(page.key);
      }
    });

    it('names contain the attempt tag: the worlds of two attempts do not coincide', () => {
      const other = worldOf(id, '9999-u1-2').map((page) => page.name);

      for (const [index, page] of world.entries()) {
        expect(page.name).toContain(TAG);
        expect(page.name).not.toBe(other[index]);
      }
    });

    it('the event of a single-run scenario and of the chain refers to a page of the world', () => {
      const keys = world.map((page) => page.key);
      const trigger = SINGLE_RUNS[id]?.trigger;

      if (trigger === undefined && id !== 'W1_dependency_chain') return;

      expect(keys).toContain(trigger?.page ?? 'waiting');
    });
  });

  it('event slots wake the run: each is among the relevant slots of the ingress', () => {
    const relevant: readonly string[] = RELEVANT_SLOTS;
    const slots = [
      ...CHAIN_SLOTS,
      ...Object.values(SINGLE_RUNS).flatMap((spec) =>
        spec?.trigger.kind === 'edit' ? spec.trigger.slots : [],
      ),
    ];

    expect(slots.filter((slot) => !relevant.includes(slot))).toEqual([]);
    expect(slots.length).toBeGreaterThan(CHAIN_SLOTS.length);
  });

  it("a reply has the attempt tag in the person's words and a non-empty thread opening", () => {
    const replies = Object.values(SINGLE_RUNS).flatMap((spec) =>
      spec?.trigger.kind === 'reply' ? [spec.trigger] : [],
    );

    expect(replies.length).toBeGreaterThan(0);
    expect(replies.filter((trigger) => !trigger.words(TAG, 1).includes(TAG))).toEqual([]);
    expect(replies.filter((trigger) => trigger.opening.length === 0)).toEqual([]);
  });

  /**
   * The opening of a thread says nothing about time: the person answers a question, not a date
   * suggested to them.
   */
  it('the thread is opened neutrally: without words about time', () => {
    const openings = Object.values(SINGLE_RUNS).flatMap((spec) =>
      spec?.trigger.kind === 'reply' ? [spec.trigger.opening] : [],
    );

    expect(
      openings.filter((text) => /тижн|вчора|завтра|сьогодні|днів|місяц|ранку/i.test(text)),
    ).toEqual([]);
  });

  it('W1: the world of the chain is a Task awaiting an external answer, the date has come, the deadline is in two days', () => {
    const waiting = worldOf('W1_dependency_chain', TAG).find((page) => page.key === 'waiting');

    expect(waiting).toMatchObject({
      status: 'Waiting For',
      dateInDays: -1,
      deadlineInDays: 2,
    });
  });

  it("U scenarios: the person's words mention the promise; an equivalent exists only in U2", () => {
    const withEquivalent = (id: ScenarioId): boolean =>
      worldOf(id, TAG).some((page) => page.key === 'equivalent');

    expect(withEquivalent('U2_commitment_tracked')).toBe(true);
    expect(withEquivalent('U1_commitment')).toBe(false);
    expect(withEquivalent('U3_commitment_undated')).toBe(false);

    for (const id of [
      'U1_commitment',
      'U3_commitment_undated',
      'E1_commitment_english',
      'U4_commitment_intent',
      'U5_commitment_third_party',
    ] as const) {
      const trigger = SINGLE_RUNS[id]?.trigger;

      expect(trigger?.kind === 'reply' ? trigger.words(TAG, 1) : '').toMatch(/proposal|пропозиці/);
    }
  });

  it("U2: the equivalent is in another project and is worded differently from the person's promise", () => {
    const world = worldOf('U2_commitment_tracked', TAG);
    const equivalent = world.find((page) => page.key === 'equivalent');
    const trigger = SINGLE_RUNS.U2_commitment_tracked?.trigger;

    expect(equivalent).toMatchObject({ type: 'task', project: 'sales' });
    expect(world.find((page) => page.key === 'sales')).toMatchObject({ type: 'project' });
    expect(equivalent?.name).toContain(clientOf(TAG));
    expect(equivalent?.name).not.toContain('комерційну');

    for (const variant of [1, 2, 3]) {
      const said = trigger?.kind === 'reply' ? trigger.words(TAG, variant) : '';

      expect(said).not.toContain('цінову пропозицію');
    }

    expect(SINGLE_RUNS.U2_commitment_tracked?.findable?.key).toBe('equivalent');
    expect(SINGLE_RUNS.U2_commitment_tracked?.findable?.query(TAG)).toBe(clientOf(TAG));
  });

  /**
   * Every pool variant names the client: the search finds the equivalent by it, and the comment
   * refers to the promise by it.
   */
  it('every variant of every pool names the client, and three trials take different variants', () => {
    for (const id of [
      'U1_commitment',
      'U3_commitment_undated',
      'E1_commitment_english',
      'U4_commitment_intent',
      'U5_commitment_third_party',
    ] as const) {
      const trigger = SINGLE_RUNS[id]?.trigger;
      const said = [1, 2, 3, 4].map((trial) =>
        trigger?.kind === 'reply' ? trigger.words(TAG, trial) : '',
      );

      expect(said.every((text) => text.includes(clientOf(TAG)))).toBe(true);
      expect(new Set(said.slice(0, 3)).size).toBe(3);
      expect(said[3]).toBe(said[0]);
    }
  });

  it('a pool variant is chosen by the trial number and wraps around', () => {
    expect(variantOf(PROMISE_TOMORROW, 1)).toBe(PROMISE_TOMORROW[0]);
    expect(variantOf(PROMISE_TOMORROW, 3)).toBe(PROMISE_TOMORROW[2]);
    expect(variantOf(PROMISE_TOMORROW, 4)).toBe(PROMISE_TOMORROW[0]);
  });

  /**
   * The model sees the tag in page names, so the tag does not name the scenario (`u1` would hint
   * which test this is). The gate run and the hexadecimal characters make the names different for
   * every combination.
   */
  it('attempt tag: every combination is different, short, fit for a slug and does not name the scenario', () => {
    const tags = SCENARIOS.flatMap((info) =>
      [1, 2, 3, 9].flatMap((trial) =>
        [0, 1].map((attempt) => tagOf({ run: '4821', scenario: info.id, trial, attempt })),
      ),
    );

    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.filter((tag) => !/^4821-[0-9a-f]{6}$/.test(tag))).toEqual([]);
  });

  it('the tag depends on the gate run by more than a suffix: another gate run, another name', () => {
    const id = { scenario: 'U1_commitment', trial: 1, attempt: 0 } as const;

    expect(tagOf({ ...id, run: '4821' })).not.toBe(tagOf({ ...id, run: '4822' }));
  });

  /**
   * The three acceptance trials see all three pool variants, and gate runs start with different
   * ones, so that a check on a single trial would not look at the first variant every time.
   */
  it('variant number: the trials of one gate run differ, and gate runs are shifted', () => {
    const at = (run: string, trial: number): number =>
      variantNumber({ run, scenario: 'U1_commitment', trial, attempt: 0 });
    const variants = (run: string): number[] => [1, 2, 3].map((trial) => (at(run, trial) - 1) % 3);

    expect(new Set(variants('4821')).size).toBe(3);
    expect(new Set(variants('4822')).size).toBe(3);
    expect(variants('4821')[0]).not.toBe(variants('4822')[0]);
  });

  it('a retry after a failure takes the same variant as the attempt it replaces', () => {
    const first = variantNumber({
      run: '4821',
      scenario: 'F1_lesson_applies',
      trial: 2,
      attempt: 0,
    });
    const retry = variantNumber({
      run: '4821',
      scenario: 'F1_lesson_applies',
      trial: 2,
      attempt: 1,
    });

    expect(retry).toBe(first);
  });

  it("F1 and F2: the word is absent from the F2 anchor, and present on the page of another project and in the F1 anchor; the anchor belongs to the world's project", () => {
    const word = codeword(TAG);
    const f1 = plantedMemoryOf('F1_lesson_applies', TAG);
    const f2 = plantedMemoryOf('F2_lesson_elsewhere', TAG);
    const text = (pages: typeof f1): string[] => pages.map((page) => page.paragraphs.join(' '));

    expect(text(f1).every((body) => body.includes(word))).toBe(true);
    expect(f1.map((page) => page.kind === 'anchor' && page.of)).toEqual(['project']);

    const [anchor, similar] = f2;

    expect(anchor?.kind === 'anchor' && anchor.of).toBe('project');
    expect(anchor?.paragraphs.join(' ')).not.toContain(word);
    expect(similar?.kind === 'anchor' && similar.of).toBeNull();
    expect(similar?.paragraphs.join(' ')).toContain(word);
    expect(f2.every((page) => !/gate/i.test(page.paragraphs.join(' ')))).toBe(true);
  });

  /**
   * The F2 trap must be reachable: search by topic finds the page of another project, not only
   * search by its id.
   */
  it('F2: the page of another project has its own title and a query that finds it by topic', () => {
    const [anchor, similar] = plantedMemoryOf('F2_lesson_elsewhere', TAG);
    const world = worldOf('F2_lesson_elsewhere', TAG);

    expect(similar?.title).not.toBe(anchor?.title);
    expect(similar?.title).toContain('Меридіан');
    expect(world.map((page) => page.name).join(' ')).not.toContain('Меридіан');
    expect(similar?.discoverableBy).toMatch(/юристи/);
    expect(similar?.paragraphs.join(' ')).toContain('Меридіан');
  });

  /** The lesson is a constraint that slows signing down, not a tactic the policy example names. */
  it('every variant of the lesson names the mockups and does not advise escalation', () => {
    for (const trial of [1, 2, 3]) {
      const [lesson] = plantedMemoryOf('F1_lesson_applies', TAG, trial);
      const text = lesson?.paragraphs.join(' ') ?? '';

      expect(text).toContain(codeword(TAG));
      expect(text).toMatch(/макет/);
      expect(text).not.toMatch(/ескалац/i);
    }
  });

  it('the code word is in Latin letters and includes the attempt tag', () => {
    expect(codeword(TAG)).toBe(`Orvex-${TAG}`);
  });

  it('Q1 and L1 are a project of twelve Tasks; in L1 the only free path is the alternative', () => {
    const tasks = (id: ScenarioId) => worldOf(id, TAG).filter((page) => page.type === 'task');
    const open = tasks('L1_large_project').filter(
      (page) => page.type === 'task' && page.status === 'Next Action',
    );

    expect(tasks('Q1_quiet_edit')).toHaveLength(12);
    expect(tasks('L1_large_project')).toHaveLength(12);
    expect(open.map((page) => page.key)).toEqual(['alternative']);
  });

  it('B1: a Behavior System in `Installing` and a failed instance linked to it', () => {
    const world = worldOf('B1_behavior_miss', TAG);

    expect(world.find((page) => page.key === 'system')).toMatchObject({
      type: 'behavior_system',
      lifecycle: 'Installing',
    });
    expect(world.find((page) => page.key === 'instance')).toMatchObject({
      status: 'Failed',
      behaviorSystem: 'system',
    });
  });
});

/**
 * The worlds and events of the scenarios, written down from their description in `infra/GATE.md`
 * § “Gate M6”, not from the code that builds them. `readProblems` checks a world only against its
 * own description, so an edit that quietly changes a scenario (a deadline, the mode of an Area of
 * Focus, the status of a Task, the event page) would stay green: here it fails, and the change has
 * to be made deliberately in both places. Page names are not in the list: they contain the attempt
 * tag.
 */
describe('what each scenario describes: the world and the event', () => {
  type Facts = Readonly<Record<string, unknown>>;

  const active: Facts = { key: 'project', type: 'project', status: 'Active' };
  const task = (key: string, status: string, rest: Facts = {}): Facts => ({
    key,
    type: 'task',
    status,
    ...rest,
  });
  const inProject = { project: 'project' };
  const done = (...keys: string[]): Facts[] => keys.map((key) => task(key, 'Done', inProject));
  const edit = (page: string, ...slots: string[]): Facts => ({ kind: 'edit', page, slots });
  const reply = (page: string): Facts => ({ kind: 'reply', page });

  const waitingForAnswer: Facts[] = [
    active,
    task('waiting', 'Waiting For', { ...inProject, dateInDays: -1, deadlineInDays: 2 }),
  ];
  const promise: Facts[] = [active, task('prices', 'Next Action', inProject)];

  const DESIGNED: Readonly<
    Record<
      Exclude<ScenarioId, M7ScenarioId | M8ScenarioId | M9ScenarioId>,
      { world: Facts[]; trigger: Facts }
    >
  > = {
    U1_commitment: { world: promise, trigger: reply('prices') },
    U2_commitment_tracked: {
      world: [
        ...promise,
        { key: 'sales', type: 'project', status: 'Active' },
        task('equivalent', 'Next Action', { project: 'sales' }),
      ],
      trigger: reply('prices'),
    },
    U4_commitment_intent: { world: promise, trigger: reply('prices') },
    U5_commitment_third_party: { world: promise, trigger: reply('prices') },
    U3_commitment_undated: { world: promise, trigger: reply('prices') },
    E1_commitment_english: { world: promise, trigger: reply('prices') },
    W1_dependency_chain: { world: waitingForAnswer, trigger: edit('waiting', 'task.date') },
    N1_free_path: {
      world: [
        active,
        task('target', 'Next Action', { ...inProject, deadlineInDays: 2 }),
        task('free', 'Next Action', inProject),
      ],
      trigger: edit('target', 'task.deadline'),
    },
    P1_last_task_done: {
      world: [active, ...done('first', 'last')],
      trigger: edit('last', 'task.status'),
    },
    P3_waiting_project: {
      world: [
        active,
        task('waiting', 'Waiting For', { ...inProject, dateInDays: -1, deadlineInDays: 10 }),
        task('scheduled', 'Scheduled', { ...inProject, dateInDays: 3 }),
      ],
      trigger: edit('waiting', 'task.status'),
    },
    K1_blocked_next_action: {
      world: [
        active,
        task('blocker', 'Next Action', inProject),
        task('dependent', 'Next Action', { ...inProject, blockedBy: ['blocker'] }),
      ],
      trigger: edit('dependent', 'task.dependencies'),
    },
    F1_lesson_applies: { world: waitingForAnswer, trigger: edit('waiting', 'task.date') },
    F2_lesson_elsewhere: { world: waitingForAnswer, trigger: edit('waiting', 'task.date') },
    B1_behavior_miss: {
      world: [
        { key: 'system', type: 'behavior_system', lifecycle: 'Installing' },
        task('instance', 'Failed', { behaviorSystem: 'system', deadlineInDays: -1 }),
      ],
      trigger: edit('instance', 'task.status'),
    },
    A1_area_of_focus_quiet: {
      world: [
        { key: 'area_of_focus', type: 'area_of_focus', mode: 'Advance' },
        task('finished', 'Done', { areaOfFocus: 'area_of_focus' }),
        task('maybe', 'Someday/Maybe', { areaOfFocus: 'area_of_focus' }),
      ],
      trigger: edit('area_of_focus', 'area_of_focus.mode'),
    },
    X1_opportunity_quiet: {
      world: [task('event', 'Someday/Maybe', { dateInDays: 5 })],
      trigger: edit('event', 'task.date'),
    },
    Q1_quiet_edit: {
      world: [
        active,
        ...done('t01', 't02', 't03', 't04', 't05', 't06'),
        task('t07', 'Next Action', inProject),
        task('t08', 'Next Action', inProject),
        task('t09', 'Scheduled', { ...inProject, dateInDays: 3 }),
        task('t10', 'Scheduled', { ...inProject, dateInDays: 7 }),
        task('moved', 'Next Action', { ...inProject, deadlineInDays: 9 }),
        task('waiting', 'Waiting For', { ...inProject, dateInDays: 4, deadlineInDays: 20 }),
      ],
      trigger: edit('moved', 'task.deadline'),
    },
    N2_deadline_passed: {
      world: [
        active,
        task('late', 'Next Action', { ...inProject, deadlineInDays: -1 }),
        task('other', 'Next Action', inProject),
      ],
      trigger: edit('late', 'task.deadline'),
    },
    N3_scheduled_path: {
      world: [
        active,
        task('planned', 'Scheduled', { ...inProject, dateInDays: 3, deadlineInDays: 10 }),
      ],
      trigger: edit('planned', 'task.date'),
    },
    P2_planning_clarifying: {
      world: [
        { key: 'project', type: 'project', status: 'Planning' },
        task('clarify', 'Next Action', inProject),
      ],
      trigger: edit('project', 'project.status'),
    },
    L1_large_project: {
      world: [
        active,
        ...done('t01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10'),
        task('waiting', 'Waiting For', { ...inProject, dateInDays: -1, deadlineInDays: 2 }),
        task('alternative', 'Next Action', inProject),
      ],
      trigger: edit('waiting', 'task.date'),
    },
  };

  /**
   * Returns a world page without its name. The name contains the attempt tag, and the content of
   * the page is what the scenario describes.
   */
  const factsOf = (page: object): Facts =>
    Object.fromEntries(Object.entries(page).filter(([field]) => field !== 'name'));

  it('the list covers every scenario of the M6 suite', () => {
    expect(Object.keys(DESIGNED).sort()).toEqual(M6_SCENARIOS.map((info) => info.id).sort());
  });

  const isDesigned = (id: ScenarioId): id is keyof typeof DESIGNED => id in DESIGNED;

  it.each(M6_SCENARIOS.map((info) => info.id).filter(isDesigned))(
    '%s: the world and the event are as described',
    (id) => {
      const designed = DESIGNED[id];
      const spec = SINGLE_RUNS[id];
      const trigger =
        spec === undefined
          ? edit('waiting', ...CHAIN_SLOTS)
          : spec.trigger.kind === 'edit'
            ? edit(spec.trigger.page, ...spec.trigger.slots)
            : reply(spec.trigger.page);

      expect(worldOf(id, TAG).map(factsOf)).toEqual(designed.world);
      expect(trigger).toEqual(designed.trigger);
    },
  );
});
