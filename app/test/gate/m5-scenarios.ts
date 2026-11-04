import type { ProjectStatus, TaskStatus } from '../../src/notion/semantics/canonical-status';

/**
 * The gate M5 scenarios (`docs/5-plan.md` § “M5 — Canonical domain behavior and vertical slice”):
 * the world that must exist before the run, and the event that wakes the run. The expectations are
 * written in `m5-claims.ts`, apart from the world, because the world and what must come out of it
 * are two claims, and the second is checked against the first.
 *
 * The input is live data in Ukrainian, as a person would write it; the **effects** are checked:
 * what the run created, changed and left untouched.
 */
export type ScenarioId =
  | 'S1_dependency_slice'
  | 'S2_alternative_path'
  | 'S3_paused_project'
  | 'S4_terminal_project'
  | 'S5_structural_contradiction'
  | 'S6_closure_decision'
  | 'S7_identity_no_score'
  | 'T2b_area_of_focus_healthy'
  | 'T2c_evidence_unreadable';

/**
 * Tier 1 blocks the verdict; Tier 2 is recorded and does not block (`GAP-35`: behavior with no
 * deterministic carrier).
 */
type Tier = 1 | 2;

export interface ScenarioInfo {
  readonly id: ScenarioId;
  readonly tier: Tier;
  /** The `SCEN-…` ids the scenario proves, for the verdict. */
  readonly proves: readonly string[];
}

export const SCENARIOS: readonly ScenarioInfo[] = [
  {
    id: 'S1_dependency_slice',
    tier: 1,
    proves: ['SCEN-21-1', 'SCEN-19-11'],
  },
  { id: 'S2_alternative_path', tier: 1, proves: ['SCEN-19-10'] },
  { id: 'S3_paused_project', tier: 1, proves: ['SCEN-19-15', 'SCEN-19-16'] },
  { id: 'S4_terminal_project', tier: 1, proves: ['SCEN-19-17'] },
  {
    id: 'S5_structural_contradiction',
    tier: 1,
    proves: ['3-policy § Contradiction'],
  },
  { id: 'S6_closure_decision', tier: 1, proves: ['SCEN-19-31'] },
  { id: 'S7_identity_no_score', tier: 1, proves: ['SCEN-19-23'] },
  { id: 'T2b_area_of_focus_healthy', tier: 2, proves: ['SCEN-19-19'] },
  { id: 'T2c_evidence_unreadable', tier: 2, proves: [] },
];

/**
 * A page of the world: what it is, what it is called, what state it is in and what it is linked
 * to.
 */
interface BasePage {
  /**
   * The name in the scenario: claims find the page by it, not by an id, which does not exist yet.
   */
  readonly key: string;
  readonly name: string;
  /** Paragraphs of the page body: what is in its text, not in its properties. */
  readonly body?: readonly string[];
}

interface ProjectPage extends BasePage {
  readonly type: 'project';
  readonly status: ProjectStatus;
  /** The keys of the Key Results the Project serves. */
  readonly keyResults?: readonly string[];
  /**
   * What the Project's anchor in GBrain already remembers: the paragraphs of its compiled truth.
   * The content belongs to the world: the run does not write a second time what the anchor
   * remembers, so a scenario that expects a write states by itself what is not yet in the anchor.
   */
  readonly anchor?: readonly string[];
}

interface TaskPage extends BasePage {
  readonly type: 'task';
  readonly status: TaskStatus;
  /** The key of the Project the Task is linked to. */
  readonly project?: string;
  /** The keys of the Tasks that block it (`Blocked by`). */
  readonly blockedBy?: readonly string[];
  /** `Date` is this many days from today. */
  readonly dateInDays?: number;
  /**
   * The time of day of `Date` (`HH:MM` in the App's zone); without it `Date` is a day with no
   * time.
   */
  readonly dateAt?: string;
  readonly deadlineInDays?: number;
  /** The key of the Area of Focus the Task is linked to. */
  readonly areaOfFocus?: string;
  /** The key of the Behavior System the Task is an instance of. */
  readonly behaviorSystem?: string;
}

interface IdentityPage extends BasePage {
  readonly type: 'identity';
}

interface AreaOfFocusPage extends BasePage {
  readonly type: 'area_of_focus';
  readonly mode: 'Advance' | 'Maintain' | 'Minimum';
  /** The keys of the Identities the Area of Focus serves. */
  readonly identities?: readonly string[];
}

interface ObjectivePage extends BasePage {
  readonly type: 'objective';
  /** The key of the Area of Focus the Objective serves. */
  readonly areaOfFocus?: string;
}

/** An Inbox item: `name` is what the person wrote down, `text` is their explanation of it. */
interface InboxItemPage extends BasePage {
  readonly type: 'inbox_item';
  readonly text?: string;
}

/**
 * A Behavior System: `name` is its behavior (the `behavior` field), `lifecycle` is the
 * installation stage.
 */
interface BehaviorSystemPage extends BasePage {
  readonly type: 'behavior_system';
  readonly lifecycle: 'Designed' | 'Installing' | 'Stabilizing' | 'Maintenance' | 'Retired';
}

interface KeyResultPage extends BasePage {
  readonly type: 'key_result';
  /** The key of the Objective it is evidence for. */
  readonly objective: string;
}

export type WorldPage =
  | ProjectPage
  | TaskPage
  | IdentityPage
  | AreaOfFocusPage
  | ObjectivePage
  | KeyResultPage
  | BehaviorSystemPage
  | InboxItemPage;

/**
 * The pages of the world in creation order: what is referred to comes before what refers to it.
 */
export type World = readonly WorldPage[];

/**
 * Returns the names of the world's pages by key. The expectations of the claims are taken from
 * here, from the scenario description, not from the world they check: a key the world does not
 * have is a harness fault.
 */
export function namesOf(world: World, keys: readonly string[]): string[] {
  return keys.map((key) => {
    const page = world.find((candidate) => candidate.key === key);

    if (page === undefined) throw new Error(`the world has no page ${key}`);

    return page.name;
  });
}

/** A one-time event on a page of the world: what woke it. */
interface Trigger {
  /** The key of the page on which something changed. */
  readonly page: string;
}

/** A scenario resolved by one run over a world: the world and the event. */
export interface SingleRun {
  readonly world: World;
  readonly trigger: Trigger;
}

/** S2: a `Waiting For` Task has an alternative path: another Task of the Project can move it. */
export const S2_ALTERNATIVE_PATH: SingleRun = {
  world: [
    { key: 'project', type: 'project', name: 'Запуск кабінету клієнта', status: 'Active' },
    {
      key: 'waiting',
      type: 'task',
      name: 'Отримати схвалення макетів від замовника',
      status: 'Waiting For',
      project: 'project',
      dateInDays: 3,
      deadlineInDays: 10,
    },
    {
      key: 'alternative',
      type: 'task',
      name: 'Підготувати тестові дані для демо',
      status: 'Next Action',
      project: 'project',
    },
  ],
  trigger: { page: 'waiting' },
};

/** S3: a paused Project: one Task with no time, one with a check date, one with a hard deadline. */
export const S3_PAUSED_PROJECT: SingleRun = {
  world: [
    { key: 'project', type: 'project', name: 'Ремонт балкона', status: 'Paused' },
    {
      key: 'plain',
      type: 'task',
      name: 'Порівняти ціни на вікна',
      status: 'Next Action',
      project: 'project',
    },
    {
      key: 'checking',
      type: 'task',
      name: 'Дочекатися відповіді майстра щодо кошторису',
      status: 'Waiting For',
      project: 'project',
      dateInDays: 4,
    },
    {
      key: 'committed',
      type: 'task',
      name: 'Внести аванс бригаді',
      status: 'Scheduled',
      project: 'project',
      dateInDays: 5,
      deadlineInDays: 6,
    },
  ],
  trigger: { page: 'project' },
};

/** S4: a closed Project with three unfinished Tasks and one done. */
export const S4_TERMINAL_PROJECT: SingleRun = {
  world: [
    { key: 'project', type: 'project', name: 'Оформлення візи', status: 'Done' },
    {
      key: 'next',
      type: 'task',
      name: 'Записатися на біометрію',
      status: 'Next Action',
      project: 'project',
    },
    {
      key: 'waiting',
      type: 'task',
      name: 'Дочекатися листа з посольства',
      status: 'Waiting For',
      project: 'project',
      dateInDays: 5,
    },
    {
      key: 'someday',
      type: 'task',
      name: 'Подумати про річну візу',
      status: 'Someday/Maybe',
      project: 'project',
    },
    {
      key: 'finished',
      type: 'task',
      name: 'Подати анкету',
      status: 'Done',
      project: 'project',
    },
  ],
  trigger: { page: 'project' },
};

/**
 * S5: a `Waiting For` Task whose blocker is already `Done`: the status says “waiting”, but there is
 * nothing to wait for.
 */
export const S5_STRUCTURAL_CONTRADICTION: SingleRun = {
  world: [
    { key: 'project', type: 'project', name: 'Переїзд офісу', status: 'Active' },
    {
      key: 'blocker',
      type: 'task',
      name: 'Підписати договір оренди',
      status: 'Done',
      project: 'project',
    },
    {
      key: 'dependent',
      type: 'task',
      name: 'Замовити меблі для нового офісу',
      status: 'Waiting For',
      project: 'project',
      blockedBy: ['blocker'],
      dateInDays: 2,
    },
  ],
  trigger: { page: 'dependent' },
};

/**
 * S7: a single failure of a Task linked to an Area of Focus that serves an Identity. The Identity
 * is neither scored nor changed.
 */
export const S7_IDENTITY_NO_SCORE: SingleRun = {
  world: [
    { key: 'identity', type: 'identity', name: 'Надійний фахівець' },
    {
      key: 'area_of_focus',
      type: 'area_of_focus',
      name: 'Робота',
      mode: 'Maintain',
      identities: ['identity'],
    },
    {
      key: 'failed',
      type: 'task',
      name: 'Надіслати квартальний звіт',
      status: 'Failed',
      areaOfFocus: 'area_of_focus',
      deadlineInDays: -1,
    },
  ],
  trigger: { page: 'failed' },
};

/** T2b: an Area of Focus in a healthy `Maintain` with no Objective: it needs no Objective. */
export const T2B_AREA_OF_FOCUS_HEALTHY: SingleRun = {
  world: [{ key: 'area_of_focus', type: 'area_of_focus', name: 'Дім', mode: 'Maintain' }],
  trigger: { page: 'area_of_focus' },
};

/**
 * T2c: an Objective with a Key Result; the person speaks about the evidence in their own words in
 * the Objective's thread.
 */
export const T2C_EVIDENCE_UNREADABLE: World = [
  { key: 'objective', type: 'objective', name: 'Зробити сервіс прибутковим' },
  {
    key: 'result',
    type: 'key_result',
    name: 'Місячний дохід досягає 5000 євро',
    objective: 'objective',
  },
];

/**
 * The world of flow S1: a Task waiting for an external reply in a Project with no other path. The
 * check date is due and the deadline is in two days: a date that has not yet come is not, by
 * itself, a ground for speaking up. For the Project the gate writes an anchor page to GBrain, so
 * the run has something to find by the exact id.
 */
export const S1_WORLD: World = [
  {
    key: 'project',
    type: 'project',
    name: 'Запуск особистого сайту',
    status: 'Active',
    // What the run that works through the dependency looks for.
    anchor: [
      'Зовнішні залежності: відповіді від зовнішніх сторін чекають до двох робочих днів, далі ескалація.',
    ],
  },
  {
    key: 'waiting',
    type: 'task',
    name: 'Отримати підписаний договір від Legal',
    status: 'Waiting For',
    project: 'project',
    dateInDays: -1,
    deadlineInDays: 2,
  },
];

/** The person's words in S1: the external party has replied. */
export const S1_PERSON_REPLY = 'Legal відповіли, договір підписано й надіслано.';

/** The person's words in S4, when they name what each unfinished Task becomes. */
export const S4_PERSON_REPLY =
  'Біометрію вже пройдено — це готово. Лист із посольства більше не потрібен — скасуй.';

/**
 * Builds the S6 world: a done Task of a Project that has something to remember. The person's
 * decision concerns the Project, so the closure writes it to the Project's anchor. The gate plants
 * this anchor beforehand: before writing, the run reads what is already stored on it and writes
 * only what is new. The anchor lets this check read something, but its content does not yet hold
 * the decision.
 */
export function s6World(run: string): World {
  return [
    {
      key: 'project',
      type: 'project',
      name: `Поставка обладнання «Берегиня-${run}»`,
      status: 'Active',
      // What the anchor remembers before the decision: it says nothing about escalation timing.
      anchor: [`Обладнання для нового офісу; рахунок «Берегиня-${run}» оплачують після приймання.`],
    },
    {
      key: 'task',
      type: 'task',
      name: `Узгодити терміни поставки з «Берегиня-${run}»`,
      status: 'Done',
      project: 'project',
    },
  ];
}

/**
 * The person's decision in S6. The gate replaces `{run}` with the number of the gate run, because
 * GBrain remembers facts between gate runs, and a run that sees that the fact is already stored
 * does not write it a second time.
 */
export const S6_DECISION =
  'Для критичних вендорів «Берегиня-{run}» ескалація починається після двох робочих днів без відповіді.';

/** The person's words in T2c: evidence that the system cannot read by itself. */
export const T2C_PERSON_STATEMENT = 'Дохід цього місяця не виріс, лишився на 2000 євро.';

/**
 * The world of the check ahead of the first quota: blockers in four states (open, resolved,
 * failed and canceled) and the Tasks waiting on them, including one with two blockers. The
 * dependency rule and the workspace's `Blocked` formula must say the same about each.
 */
export const PREFLIGHT_WORLD: World = [
  { key: 'project', type: 'project', name: 'Gate M5: перевірка', status: 'Active' },
  {
    key: 'open',
    type: 'task',
    name: 'Gate M5: відкритий блокер',
    status: 'Next Action',
    project: 'project',
  },
  {
    key: 'done',
    type: 'task',
    name: 'Gate M5: розв’язаний блокер',
    status: 'Done',
    project: 'project',
  },
  {
    key: 'failed',
    type: 'task',
    name: 'Gate M5: нездійснений блокер',
    status: 'Failed',
    project: 'project',
  },
  {
    key: 'canceled',
    type: 'task',
    name: 'Gate M5: знятий блокер',
    status: 'Canceled',
    project: 'project',
  },
  {
    key: 'byOpen',
    type: 'task',
    name: 'Gate M5: чекає на відкритий',
    status: 'Waiting For',
    project: 'project',
    blockedBy: ['open'],
    dateInDays: 2,
  },
  {
    key: 'byDone',
    type: 'task',
    name: 'Gate M5: чекає на розв’язаний',
    status: 'Waiting For',
    project: 'project',
    blockedBy: ['done'],
    dateInDays: 2,
  },
  {
    key: 'byFailed',
    type: 'task',
    name: 'Gate M5: чекає на нездійснений',
    status: 'Waiting For',
    project: 'project',
    blockedBy: ['failed'],
    dateInDays: 2,
  },
  {
    key: 'byCanceled',
    type: 'task',
    name: 'Gate M5: чекає на знятий',
    status: 'Waiting For',
    project: 'project',
    blockedBy: ['canceled'],
    dateInDays: 2,
  },
  {
    // Two blockers, one resolved and one open: the `some` formula would yield “free”, `every`
    // “blocked”.
    key: 'byTwo',
    type: 'task',
    name: 'Gate M5: чекає на розв’язаний і відкритий',
    status: 'Waiting For',
    project: 'project',
    blockedBy: ['done', 'open'],
    dateInDays: 2,
  },
];

/** The dependency state the rule must yield for each Task of the check. */
export const PREFLIGHT_DEPENDENCIES: readonly (readonly [string, 'blocked' | 'resolved'])[] = [
  ['byOpen', 'blocked'],
  ['byDone', 'resolved'],
  ['byFailed', 'blocked'],
  ['byCanceled', 'resolved'],
  ['byTwo', 'blocked'],
];

/** The blockers of the check's world: the Tasks the others wait on. */
export const PREFLIGHT_BLOCKERS: readonly string[] = ['open', 'done', 'failed', 'canceled'];
