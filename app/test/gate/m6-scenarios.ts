import type { RunProvenance } from '../../src/runs/provenance';
import type { World, WorldPage } from './m5-scenarios';
import {
  INTENT_ONLY,
  LESSONS,
  PROMISE_ENGLISH,
  PROMISE_TOMORROW,
  PROMISE_TRACKED,
  PROMISE_UNDATED,
  THIRD_PARTY,
  variantOf,
  type Phrase,
} from './m6-phrasing';
import { M7_RUNS, type M7ScenarioId } from './m7-scenarios';
import { M8_PROCEDURES, type M8ScenarioId } from './m8-scenarios';
import { M9_PROCEDURES, type M9ScenarioId } from './m9-scenarios';
import {
  brand,
  digestOf,
  isPlanted,
  otherOf,
  replyOn,
  similarProject,
  task,
  waitingWorld,
  type MemoryPage,
  type PlantedMemory,
  type Procedure,
  type SingleRun,
  type Tag,
  type Trigger,
} from './scenario-kit';

/**
 * Gate M6 scenarios (`docs/5-plan.md` § “M6 — Universal Detector”): the world that must exist
 * before the run, and the event that wakes the run. The expectations are in `m6-claims.ts`: the
 * world and what must come out of it are two claims, and the second is checked first.
 *
 * The input is live data in Ukrainian, as a person would write it; **effects** are what is
 * checked. Each attempt builds the world anew under its own tag (`tag`): page names and GBrain
 * slugs are not repeated between attempts or between gate runs, so the Skill's search does not find
 * a page from an earlier attempt or an earlier gate run.
 */
export type ScenarioId =
  | 'U1_commitment'
  | 'U2_commitment_tracked'
  | 'W1_dependency_chain'
  | 'N1_free_path'
  | 'P1_last_task_done'
  | 'P3_waiting_project'
  | 'K1_blocked_next_action'
  | 'F1_lesson_applies'
  | 'F2_lesson_elsewhere'
  | 'B1_behavior_miss'
  | 'A1_area_of_focus_quiet'
  | 'X1_opportunity_quiet'
  | 'Q1_quiet_edit'
  | 'N2_deadline_passed'
  | 'N3_scheduled_path'
  | 'P2_planning_clarifying'
  | 'L1_large_project'
  | 'E1_commitment_english'
  | 'U3_commitment_undated'
  | 'U4_commitment_intent'
  | 'U5_commitment_third_party'
  | M7ScenarioId
  | M8ScenarioId
  | M9ScenarioId;

/** Blocking proves the verdict; recorded is only recorded. */
type Tier = 'blocking' | 'recorded';

/**
 * What the scenario is for. `acceptance` proves a norm the Skill must already satisfy. `adoption`
 * measures what the Skill cannot do before the changes, by construction, so its failure on the
 * baseline is not evidence of quality but the starting point that the gain is measured from.
 */
type Purpose = 'acceptance' | 'adoption';

/**
 * A suite of scenarios that has its own gate command: M6 measures the detector, M7 GBrain memory,
 * M8 scheduled reviews, the sweep, the reconciliation of resolved threads and ingress by page
 * content, M9 the proposals and the person's decisions on them.
 */
export type Suite = 'm6' | 'm7' | 'm8' | 'm9';

/** A suite's name in the verdict and in the command's messages. */
export const GATE_LABEL: Readonly<Record<Suite, 'M6' | 'M7' | 'M8' | 'M9'>> = {
  m6: 'M6',
  m7: 'M7',
  m8: 'M8',
  m9: 'M9',
};

export interface ScenarioInfo {
  readonly suite: Suite;
  readonly id: ScenarioId;
  readonly tier: Tier;
  /** Not read while the Skill text is being iterated, only in the comparison and at the end. */
  readonly heldOut: boolean;
  /** What the scenario proves, for the verdict. */
  readonly proves: readonly string[];
  readonly purpose: Purpose;
  /** How many model runs one trial includes; 0 means a scenario without a model. */
  readonly models: number;
  /** How many of them are autonomous: they spend the daily limit and are counted by the breaker. */
  readonly budgeted: number;
  /**
   * The origin of the scenario's runs. Its run gates must be open before a trial: for an
   * autonomous origin, together with the breaker and the daily limit. Without an origin, only the
   * gates that apply to all runs.
   */
  readonly provenance?: RunProvenance;
}

const acceptance = (
  id: ScenarioId,
  tier: Tier,
  heldOut: boolean,
  proves: readonly string[],
): ScenarioInfo => ({
  suite: 'm6',
  id,
  tier,
  heldOut,
  proves,
  purpose: 'acceptance',
  models: 1,
  budgeted: 0,
});

/** The origin of the recheck of chain W1: autonomous. */
const RECHECK: RunProvenance = { origin: 'scheduled_check', reasonCode: 'await_external_event' };

/**
 * Creates a scenario of suite M8. It is not held out, because the Skill text is not iterated on
 * this suite.
 */
const m8 = (
  id: M8ScenarioId,
  tier: Tier,
  proves: readonly string[],
  runs: Pick<ScenarioInfo, 'models' | 'budgeted' | 'provenance'>,
): ScenarioInfo => ({
  suite: 'm8',
  id,
  tier,
  heldOut: false,
  proves,
  purpose: 'acceptance',
  ...runs,
});

/**
 * Creates a scenario of suite M9. It is not held out, because the Skill text is not iterated on
 * this suite.
 */
const m9 = (
  id: M9ScenarioId,
  tier: Tier,
  proves: readonly string[],
  runs: Pick<ScenarioInfo, 'models' | 'budgeted' | 'provenance'>,
): ScenarioInfo => ({
  suite: 'm9',
  id,
  tier,
  heldOut: false,
  proves,
  purpose: 'acceptance',
  ...runs,
});

/** A recheck of a thread that a run scheduled: autonomous, with budget and breaker. */
const RECHECK_RUN = {
  models: 1,
  budgeted: 1,
  provenance: { origin: 'scheduled_check', reasonCode: 'await_external_event' },
} as const;

/**
 * Runs in response to the person's words in the channel and in a thread: exempt from the budget
 * and the breaker.
 */
const ON_WORDS = { budgeted: 0, provenance: { origin: 'channel_inbound' } } as const;

/** A scheduled review: one run, exempt from the budget and the breaker. */
const REVIEW_RUN = { models: 1, budgeted: 0, provenance: { origin: 'review_schedule' } } as const;

/** Creates a scenario of suite M7, the same as `acceptance` but about GBrain memory. */
const lifecycle = (
  id: M7ScenarioId,
  tier: Tier,
  heldOut: boolean,
  proves: readonly string[],
): ScenarioInfo => ({ ...acceptance(id, tier, heldOut, proves), suite: 'm7' });

export const SCENARIOS: readonly ScenarioInfo[] = [
  acceptance('U1_commitment', 'blocking', false, ['3-policy § Untracked']),
  acceptance('U2_commitment_tracked', 'blocking', true, ['3-policy § Untracked']),
  acceptance('U4_commitment_intent', 'blocking', true, ['3-policy § Untracked']),
  {
    ...acceptance('W1_dependency_chain', 'blocking', false, ['SCEN-19-13']),
    models: 3,
    budgeted: 1,
    provenance: RECHECK,
  },
  acceptance('N1_free_path', 'blocking', false, ['SCEN-19-12']),
  acceptance('P1_last_task_done', 'blocking', false, ['3-policy § Project']),
  acceptance('P3_waiting_project', 'blocking', false, ['3-policy § Project']),
  acceptance('K1_blocked_next_action', 'blocking', false, ['3-policy § Contradiction']),
  acceptance('F1_lesson_applies', 'blocking', false, ['SCEN-19-29']),
  acceptance('F2_lesson_elsewhere', 'blocking', false, ['SCEN-19-28']),
  acceptance('B1_behavior_miss', 'blocking', false, ['SCEN-19-45']),
  acceptance('A1_area_of_focus_quiet', 'blocking', false, [
    '3-policy § Proactive',
    '3-policy § Direction',
  ]),
  acceptance('X1_opportunity_quiet', 'blocking', true, ['3-policy § Proactive']),
  acceptance('Q1_quiet_edit', 'blocking', true, ['3-policy § Intervention']),
  acceptance('N2_deadline_passed', 'recorded', false, []),
  { ...acceptance('N3_scheduled_path', 'recorded', false, []), purpose: 'adoption' },
  acceptance('P2_planning_clarifying', 'recorded', false, []),
  acceptance('L1_large_project', 'recorded', false, []),
  acceptance('E1_commitment_english', 'recorded', false, []),
  { ...acceptance('U3_commitment_undated', 'recorded', false, []), purpose: 'adoption' },
  acceptance('U5_commitment_third_party', 'recorded', true, []),
  lifecycle('H1_routine_done', 'blocking', false, ['SCEN-19-30']),
  lifecycle('H2_routine_answer', 'blocking', false, ['SCEN-19-30']),
  lifecycle('H3_two_anchors', 'blocking', false, ['SCEN-19-38']),
  lifecycle('H4_decision_stated', 'blocking', false, ['SCEN-19-31']),
  lifecycle('H5_decision_stored', 'blocking', true, ['SCEN-19-31']),
  lifecycle('H6_fact_stated', 'blocking', false, ['3-policy § Fact']),
  lifecycle('H7_no_anchor', 'blocking', true, ['3-policy § Anchor']),
  lifecycle('H8_below_threshold', 'blocking', false, ['SCEN-21-5']),
  lifecycle('H9_structure_first', 'blocking', false, ['SCEN-19-29']),
  lifecycle('H10_standard_stated', 'recorded', false, []),
  lifecycle('H11_lesson_stated', 'recorded', false, ['3-policy § Lesson']),
  // C1 goes first: its resolution of the thread is the only step that needs an operator.
  m8('C1_resolution_reconciled', 'blocking', ['SCEN-19-39'], { models: 0, budgeted: 0 }),
  m8('D1_daily_control', 'blocking', ['SCEN-19-48'], REVIEW_RUN),
  m8('W1_weekly_review', 'blocking', ['SCEN-21-8', 'SCEN-19-46'], REVIEW_RUN),
  m8('S1_strategic_review', 'blocking', ['SCEN-19-47', 'SCEN-19-22'], REVIEW_RUN),
  m8('SW1_safety_sweep', 'blocking', ['SCEN-19-39'], {
    models: 1,
    budgeted: 1,
    provenance: { origin: 'scheduled_check', reasonCode: 'safety_recheck' },
  }),
  m8('X1_body_commitment', 'blocking', ['3-policy § Untracked'], {
    models: 1,
    budgeted: 1,
    provenance: { origin: 'evaluation_window' },
  }),
  m8('S2_strategic_lesson', 'recorded', [], REVIEW_RUN),
  m8('DP1_deep_review', 'recorded', [], REVIEW_RUN),
  m9(
    'AP1_proposal_approved',
    'blocking',
    ['5-plan § M9 (1)', '5-plan § M9 (3)', '5-plan § M9 (5)', 'SCEN-64-20', 'SCEN-64-21'],
    { models: 2, ...ON_WORDS },
  ),
  m9('AP2_outpaced_reproposed', 'blocking', ['5-plan § M9 (4)', 'INV-027'], {
    models: 2,
    ...ON_WORDS,
  }),
  m9('AP3_rejected_kept', 'blocking', ['ADR 0043', '5-plan § M9 (6)'], RECHECK_RUN),
  m9('AP4_deadline_instruction', 'blocking', ['INV-211'], { models: 1, ...ON_WORDS }),
  // The AP3 control: without a rejection the same world must yield a proposal, otherwise the
  // silence in AP3 is vacuous.
  m9('AP5_unblocked_proposed', 'recorded', [], RECHECK_RUN),
];

/** Returns the scenarios of a suite in catalog order. */
export const scenariosOf = (suite: Suite): ScenarioInfo[] =>
  SCENARIOS.filter((info) => info.suite === suite);

/**
 * Returns the id prefix that identifies a scenario in `--only` and in the attempt tag: `U1` for
 * `U1_commitment`.
 */
export const shortOf = (id: ScenarioId): string => id.split('_')[0] ?? id;

/**
 * What identifies an attempt: a gate run, a scenario, a trial (`--trials`) and an attempt within it
 * (a retry after an infrastructure failure). A retry gets its own tag in the world, so what a
 * failed attempt left does not become an extra page in the search of the next attempt.
 */
export interface AttemptId {
  readonly run: string;
  readonly scenario: ScenarioId;
  readonly trial: number;
  readonly attempt: number;
}

export function tagOf({ run, scenario, trial, attempt }: AttemptId): Tag {
  return `${run}-${digestOf(`${scenario}:${trial}:${attempt}`)}`;
}

/**
 * Returns the number of the phrasing variant for an attempt. The trials of one gate run take
 * different pool variants (so the three acceptance trials see all three), while gate runs start at
 * different variants, so that a check on a single trial would not look at the first variant every
 * time.
 */
export const variantNumber = ({ run, trial }: AttemptId): number =>
  trial + Number.parseInt(run, 10);

/**
 * The stem of the client's name: the client is found by it even if the model did not copy the
 * attempt tag over.
 */
export const CLIENT_STEM = 'Lotus';

/**
 * Returns the name of the client that the person promises an offer to. The name appears in the
 * person's words and in the equivalent Task.
 */
export const clientOf = (tag: Tag): string => `${CLIENT_STEM}-${tag}`;

/**
 * The stem of the code word: the lesson leak is found by it, even if the model did not copy the tag
 * over.
 */
export const CODEWORD_STEM = 'Orvex';

/**
 * Returns the code word of the mockups from the GBrain lesson. It is in Latin letters, so that
 * inflection does not change it.
 */
export const codeword = (tag: Tag): string => `${CODEWORD_STEM}-${tag}`;

/**
 * Builds a project for a conversation about a promise: one Task, on which the system opened a
 * thread. With `equivalent`, Notion already has a Task for the same promise, in another project and
 * in other words, because an equivalent in the same Task or under the same name would be found by
 * anyone.
 */
function conversationWorld(tag: Tag, equivalent: boolean): World {
  return [
    { key: 'project', type: 'project', name: `Сайт компанії «${brand(tag)}»`, status: 'Active' },
    task({
      key: 'prices',
      name: `Оновити сторінку цін на сайті «${brand(tag)}»`,
      status: 'Next Action',
      project: 'project',
    }),
    ...(equivalent
      ? [
          {
            key: 'sales',
            type: 'project',
            name: `Продажі й клієнти «${brand(tag)}»`,
            status: 'Active',
          } satisfies WorldPage,
          task({
            key: 'equivalent',
            name: `Відправити цінову пропозицію клієнту «${clientOf(tag)}»`,
            status: 'Next Action',
            project: 'sales',
          }),
        ]
      : []),
  ];
}

const replyOnPrices = (pool: readonly Phrase[]): Trigger => replyOn('prices', pool, clientOf);

/**
 * Returns a lesson about a project: what slows down signing, with the code word of the mockups.
 * `who` states whose lawyers they are: this project's or another's.
 */
function lessonOf(tag: Tag, variant: number, who: string): readonly string[] {
  return variantOf(LESSONS, variant)(codeword(tag), who);
}

/** A neutral note about the project: it changes no decisions. */
const NEUTRAL_NOTE: readonly string[] = [
  'Проєкт веде Олена; щотижневий огляд — по п’ятницях.',
  'Макети погоджує замовник, зміни до них збираємо в одному документі.',
];

/**
 * Builds ten Tasks of a project without a trigger: a background on which nothing must change.
 * `busy` means there is something to do right away and something scheduled ahead. Otherwise
 * everything is done, and the only path the scenario adds remains the only one.
 */
function healthyTasks(tag: Tag, busy: boolean): readonly WorldPage[] {
  const named = (name: string): string => `${name} «${brand(tag)}»`;
  const done = (key: string, name: string): WorldPage =>
    task({ key, name: named(name), status: 'Done', project: 'project' });
  const finished = [
    ['t01', 'Зібрати вимоги до релізу'],
    ['t02', 'Погодити дизайн головної'],
    ['t03', 'Налаштувати збірку'],
    ['t04', 'Написати тексти для сторінок'],
    ['t05', 'Перевірити доступність'],
    ['t06', 'Оновити іконки'],
  ] as const;

  if (!busy) {
    return [
      ...finished.map(([key, name]) => done(key, name)),
      done('t07', 'Налаштувати резервні копії'),
      done('t08', 'Оновити документацію'),
      done('t09', 'Прибрати застарілі гілки'),
      done('t10', 'Перевірити ліцензії'),
    ];
  }

  return [
    ...finished.map(([key, name]) => done(key, name)),
    task({
      key: 't07',
      name: named('Підготувати нотатки до релізу'),
      status: 'Next Action',
      project: 'project',
    }),
    task({
      key: 't08',
      name: named('Зібрати відгуки тестувальників'),
      status: 'Next Action',
      project: 'project',
    }),
    task({
      key: 't09',
      name: named('Запланувати анонс'),
      status: 'Scheduled',
      project: 'project',
      dateInDays: 3,
    }),
    task({
      key: 't10',
      name: named('Перевірити аналітику після релізу'),
      status: 'Scheduled',
      project: 'project',
      dateInDays: 7,
    }),
  ];
}

/**
 * Builds a project of twelve Tasks: ten background ones and two from the scenario. It is the
 * background for Q1 and L1.
 */
function largeWorld(tag: Tag, busy: boolean, extra: readonly WorldPage[]): World {
  return [
    {
      key: 'project',
      type: 'project',
      name: `Підготовка до осіннього релізу «${brand(tag)}»`,
      status: 'Active',
    },
    ...healthyTasks(tag, busy),
    ...extra,
  ];
}

export const SINGLE_RUNS: Readonly<Partial<Record<ScenarioId, SingleRun>>> = {
  ...M7_RUNS,
  U1_commitment: {
    world: (tag) => conversationWorld(tag, false),
    trigger: replyOnPrices(PROMISE_TOMORROW),
  },
  U2_commitment_tracked: {
    world: (tag) => conversationWorld(tag, true),
    trigger: replyOnPrices(PROMISE_TRACKED),
    findable: { key: 'equivalent', query: clientOf },
  },
  U4_commitment_intent: {
    world: (tag) => conversationWorld(tag, false),
    trigger: replyOnPrices(INTENT_ONLY),
  },
  U5_commitment_third_party: {
    world: (tag) => conversationWorld(tag, false),
    trigger: replyOnPrices(THIRD_PARTY),
  },
  U3_commitment_undated: {
    world: (tag) => conversationWorld(tag, false),
    trigger: replyOnPrices(PROMISE_UNDATED),
  },
  E1_commitment_english: {
    world: (tag) => conversationWorld(tag, false),
    trigger: replyOnPrices(PROMISE_ENGLISH),
  },
  N1_free_path: {
    world: (tag) => [
      { key: 'project', type: 'project', name: `Звіт для банку «${brand(tag)}»`, status: 'Active' },
      task({
        key: 'target',
        name: `Підготувати квартальний звіт «${brand(tag)}»`,
        status: 'Next Action',
        project: 'project',
        deadlineInDays: 2,
      }),
      task({
        key: 'free',
        name: `Зібрати підтвердні документи «${brand(tag)}»`,
        status: 'Next Action',
        project: 'project',
      }),
    ],
    trigger: { kind: 'edit', page: 'target', slots: ['task.deadline'] },
  },
  P1_last_task_done: {
    world: (tag) => [
      {
        key: 'project',
        type: 'project',
        name: `Запуск розсилки «${brand(tag)}»`,
        status: 'Active',
      },
      task({
        key: 'first',
        name: `Налаштувати шаблон листа «${brand(tag)}»`,
        status: 'Done',
        project: 'project',
      }),
      task({
        key: 'last',
        name: `Надіслати перший випуск «${brand(tag)}»`,
        status: 'Done',
        project: 'project',
      }),
    ],
    trigger: { kind: 'edit', page: 'last', slots: ['task.status'] },
  },
  P3_waiting_project: {
    world: (tag) => [
      {
        key: 'project',
        type: 'project',
        name: `Редизайн кабінету клієнта «${brand(tag)}»`,
        status: 'Active',
      },
      task({
        key: 'waiting',
        name: `Отримати схвалення макетів від замовника «${brand(tag)}»`,
        status: 'Waiting For',
        project: 'project',
        dateInDays: -1,
        deadlineInDays: 10,
      }),
      task({
        key: 'scheduled',
        name: `Підготувати тестові дані для демо «${brand(tag)}»`,
        status: 'Scheduled',
        project: 'project',
        dateInDays: 3,
      }),
    ],
    trigger: { kind: 'edit', page: 'waiting', slots: ['task.status'] },
  },
  K1_blocked_next_action: {
    world: (tag) => [
      { key: 'project', type: 'project', name: `Переїзд офісу «${brand(tag)}»`, status: 'Active' },
      task({
        key: 'blocker',
        name: `Підписати договір оренди «${brand(tag)}»`,
        status: 'Next Action',
        project: 'project',
      }),
      task({
        key: 'dependent',
        name: `Замовити меблі для нового офісу «${brand(tag)}»`,
        status: 'Next Action',
        project: 'project',
        blockedBy: ['blocker'],
      }),
    ],
    trigger: { kind: 'edit', page: 'dependent', slots: ['task.dependencies'] },
  },
  F1_lesson_applies: {
    world: waitingWorld,
    trigger: { kind: 'edit', page: 'waiting', slots: ['task.date'] },
    memory: (tag, variant) => [
      {
        kind: 'anchor',
        key: 'anchor',
        of: 'project',
        type: 'project',
        title: `Запуск сайту «${brand(tag)}»`,
        paragraphs: lessonOf(tag, variant, 'юристи'),
      },
    ],
  },
  F2_lesson_elsewhere: {
    world: waitingWorld,
    trigger: { kind: 'edit', page: 'waiting', slots: ['task.date'] },
    memory: (tag, variant) => [
      {
        kind: 'anchor',
        key: 'anchor',
        of: 'project',
        type: 'project',
        title: `Запуск сайту «${brand(tag)}»`,
        paragraphs: NEUTRAL_NOTE,
      },
      similarProject(tag, lessonOf(tag, variant, `юристи замовника «${otherOf(tag)}»`)),
    ],
  },
  B1_behavior_miss: {
    world: (tag) => [
      {
        key: 'system',
        type: 'behavior_system',
        name: `Щоранку робити зарядку «${brand(tag)}»`,
        lifecycle: 'Installing',
      },
      task({
        key: 'instance',
        name: `Зарядка вранці «${brand(tag)}»`,
        status: 'Failed',
        behaviorSystem: 'system',
        deadlineInDays: -1,
      }),
    ],
    trigger: { kind: 'edit', page: 'instance', slots: ['task.status'] },
  },
  // The Area of Focus has just become `Advance`, and nothing in it moves: the linked work is done
  // or put off until “someday”. This is a ground for `area_of_focus_risk` at the review level, but
  // not an urgent one, so the event run stays silent.
  A1_area_of_focus_quiet: {
    world: (tag) => [
      {
        key: 'area_of_focus',
        type: 'area_of_focus',
        name: `Здоров'я «${brand(tag)}»`,
        mode: 'Advance',
      },
      task({
        key: 'finished',
        name: `Здати аналізи «${brand(tag)}»`,
        status: 'Done',
        areaOfFocus: 'area_of_focus',
      }),
      task({
        key: 'maybe',
        name: `Записатися на масаж «${brand(tag)}»`,
        status: 'Someday/Maybe',
        areaOfFocus: 'area_of_focus',
      }),
    ],
    trigger: { kind: 'edit', page: 'area_of_focus', slots: ['area_of_focus.mode'] },
  },
  X1_opportunity_quiet: {
    world: (tag) => [
      task({
        key: 'event',
        name: `Безкоштовна реєстрація на конференцію «Форум-${tag}» до кінця місяця`,
        status: 'Someday/Maybe',
        dateInDays: 5,
      }),
    ],
    trigger: { kind: 'edit', page: 'event', slots: ['task.date'] },
  },
  Q1_quiet_edit: {
    world: (tag) =>
      largeWorld(tag, true, [
        task({
          key: 'moved',
          name: `Оновити лендинг «${brand(tag)}»`,
          status: 'Next Action',
          project: 'project',
          deadlineInDays: 9,
        }),
        task({
          key: 'waiting',
          name: `Дочекатися відповіді рецензента «${brand(tag)}»`,
          status: 'Waiting For',
          project: 'project',
          dateInDays: 4,
          deadlineInDays: 20,
        }),
      ]),
    trigger: { kind: 'edit', page: 'moved', slots: ['task.deadline'] },
  },
  N2_deadline_passed: {
    world: (tag) => [
      {
        key: 'project',
        type: 'project',
        name: `Фінансовий звіт «${brand(tag)}»`,
        status: 'Active',
      },
      task({
        key: 'late',
        name: `Подати податкову декларацію «${brand(tag)}»`,
        status: 'Next Action',
        project: 'project',
        deadlineInDays: -1,
      }),
      task({
        key: 'other',
        name: `Зібрати довідки про доходи «${brand(tag)}»`,
        status: 'Next Action',
        project: 'project',
      }),
    ],
    trigger: { kind: 'edit', page: 'late', slots: ['task.deadline'] },
  },
  N3_scheduled_path: {
    world: (tag) => [
      {
        key: 'project',
        type: 'project',
        name: `Ювілей батьків «${brand(tag)}»`,
        status: 'Active',
      },
      task({
        key: 'planned',
        name: `Забронювати ресторан «${brand(tag)}»`,
        status: 'Scheduled',
        project: 'project',
        dateInDays: 3,
        deadlineInDays: 10,
      }),
    ],
    trigger: { kind: 'edit', page: 'planned', slots: ['task.date'] },
  },
  P2_planning_clarifying: {
    world: (tag) => [
      { key: 'project', type: 'project', name: `Новий напрям «${brand(tag)}»`, status: 'Planning' },
      task({
        key: 'clarify',
        name: `Описати вимоги й межі напряму «${brand(tag)}»`,
        status: 'Next Action',
        project: 'project',
      }),
    ],
    trigger: { kind: 'edit', page: 'project', slots: ['project.status'] },
  },
  L1_large_project: {
    world: (tag) =>
      largeWorld(tag, false, [
        task({
          key: 'waiting',
          name: `Отримати підписаний договір від юристів «${brand(tag)}»`,
          status: 'Waiting For',
          project: 'project',
          dateInDays: -1,
          deadlineInDays: 2,
        }),
        task({
          key: 'alternative',
          name: `Підготувати резервний канал підпису «${brand(tag)}»`,
          status: 'Next Action',
          project: 'project',
        }),
      ]),
    trigger: { kind: 'edit', page: 'waiting', slots: ['task.date'] },
  },
};

/** The event slots of chain W1. */
export const CHAIN_SLOTS: readonly string[] = ['task.date'];

/**
 * Scenarios that play out in several steps. Chain W1 of M6 consists of a world with a Task awaiting
 * an external answer, an event on the Task, a repeat of the same event with a new id and a recheck
 * after the `Deadline` is moved.
 */
export const PROCEDURES: Readonly<Partial<Record<ScenarioId, Procedure>>> = {
  W1_dependency_chain: { world: waitingWorld, slots: CHAIN_SLOTS, replies: false },
  ...M8_PROCEDURES,
  ...M9_PROCEDURES,
};

/**
 * Returns the world of a scenario, a single-run one or a procedure's. A scenario with no
 * description at all is a catalog fault.
 */
export function worldOf(id: ScenarioId, tag: Tag): World {
  const spec = SINGLE_RUNS[id] ?? PROCEDURES[id];

  if (spec === undefined) throw new Error(`the scenario ${id} is described nowhere`);

  return spec.world(tag);
}

/** How many days ahead the `Deadline` is after the move in R2: tomorrow. */
export const CHAIN_MOVED_DEADLINE_DAYS = 1;

/**
 * Returns the memory pages a scenario needs, with a known slug and title. The lesson text is chosen
 * using the trial number.
 */
export function memoryOf(id: ScenarioId, tag: Tag, variant = 1): readonly MemoryPage[] {
  return (SINGLE_RUNS[id] ?? PROCEDURES[id])?.memory?.(tag, variant) ?? [];
}

/** Returns the pages the scenario plants itself before the run, with a title and text. */
export function plantedMemoryOf(id: ScenarioId, tag: Tag, variant = 1): readonly PlantedMemory[] {
  return memoryOf(id, tag, variant).filter(isPlanted);
}

/**
 * Returns the slots the scenario changes on behalf of the person. Each must have a carrier in the
 * workspace binding.
 */
export function slotsOf(id: ScenarioId): readonly string[] {
  const single = SINGLE_RUNS[id];

  if (single !== undefined) return single.trigger.kind === 'edit' ? single.trigger.slots : [];

  return PROCEDURES[id]?.slots ?? [];
}

/**
 * Checks whether the scenario conducts a reply from the person in the channel. Without the channel
 * it is not conducted.
 */
export const repliesInChannel = (id: ScenarioId): boolean =>
  SINGLE_RUNS[id]?.trigger.kind === 'reply' || PROCEDURES[id]?.replies === true;

/** Checks whether the scenario puts pages into GBrain. Without GBrain it is not conducted. */
export const remembers = (id: ScenarioId): boolean => memoryOf(id, 'x').length > 0;
