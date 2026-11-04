import type { WorkflowMode } from '../../src/generated/prisma/enums';
import type { World, WorldPage } from './m5-scenarios';
import type { ScenarioId } from './m6-scenarios';
import type { StatusProposal, SystemNotice } from './m9-evidence';
import { brand, task, type Procedure, type Tag } from './scenario-kit';

/**
 * Scenarios of gate M9 (`docs/5-plan.md` § “M9 — Approvals by behavioral criteria”): the proposals
 * of runs and the person's decisions on them, live. Each is a procedure: a world and steps, which
 * `m9-conduct.ts` conducts; the expectations are in `m9-claims.ts`. `m9-preflight.ts` checks the
 * approval chain without a model.
 *
 * The person's words are natural, with a variant per trial; the threads and messages of the system
 * are in its own words, without the name of the gate, because the model reads the thread and a
 * technical marker in it would change what the model sees.
 */
export type M9ScenarioId =
  | 'AP1_proposal_approved'
  | 'AP2_outpaced_reproposed'
  | 'AP3_rejected_kept'
  | 'AP4_deadline_instruction'
  | 'AP5_unblocked_proposed';

/** Builds the name of a world page: what it is and the attempt tag. */
const named = (tag: Tag, text: string): string => `${text} «${brand(tag)}»`;

const project = (tag: Tag, name: string): WorldPage => ({
  key: 'project',
  type: 'project',
  name: named(tag, name),
  status: 'Active',
});

/**
 * The mode of the scenario's model run: before the world, the gate waits for the Notion query
 * allowance for that mode.
 */
export const M9_MODEL_MODE: Readonly<Partial<Record<ScenarioId, WorkflowMode>>> = {
  AP1_proposal_approved: 'event_evaluation',
  AP2_outpaced_reproposed: 'event_evaluation',
  AP3_rejected_kept: 'scheduled_recheck',
  AP4_deadline_instruction: 'event_evaluation',
  AP5_unblocked_proposed: 'scheduled_recheck',
} satisfies Record<M9ScenarioId, WorkflowMode>;

// ---------------------------------------------------------------------------
// AP1 — a proposal, a “yes” in the channel and a button
// ---------------------------------------------------------------------------

/**
 * The Task awaits a reply from the print shop in a Project that has other open work too: closing
 * the Project is not a legitimate step, so the right change is only the Task status.
 */
function approvedWorld(tag: Tag): World {
  return [
    project(tag, 'Підготовка конференції'),
    task({
      key: 'badges',
      name: named(tag, 'Отримати від друкарні макет бейджів'),
      status: 'Waiting For',
      project: 'project',
    }),
    task({
      key: 'hall',
      name: named(tag, 'Забронювати зал для конференції'),
      status: 'Next Action',
      project: 'project',
    }),
  ];
}

export const AP1_NOTICE: SystemNotice = {
  thread: 'Макет бейджів від друкарні ще не надійшов — задача чекає на їхню відповідь.',
  noticed: 'Задача чекає на макет бейджів від друкарні',
  whyItMatters: 'Без макета бейджі не встигнуть надрукувати до конференції',
  ask: 'Напишіть, коли друкарня відповість',
};

/** The person in the channel: the reply has come, the matter is done. */
export const AP1_DONE: readonly string[] = [
  'Друкарня надіслала макет бейджів, тут усе зроблено.',
  'Макет від друкарні вже в нас — цю задачу зроблено.',
  'Відповідь від друкарні прийшла, макет отримали. Готово.',
];

/** The person answers “yes” to a notification with a proposal: that is not a decision about it. */
export const AP1_YES: readonly string[] = ['так', 'Так, підтверджую.', 'так, усе вірно'];

// ---------------------------------------------------------------------------
// AP2 — the person outpaced the proposal, then changed their mind
// ---------------------------------------------------------------------------

/** The Task awaits the accountant's figures; the check date is today. */
function outpacedWorld(tag: Tag): World {
  return [
    project(tag, 'Квартальна звітність'),
    task({
      key: 'report',
      name: named(tag, 'Звести квартальний звіт'),
      status: 'Waiting For',
      project: 'project',
      dateInDays: 0,
    }),
  ];
}

export const AP2_NOTICE: SystemNotice = {
  thread: 'Квартальний звіт чекає на цифри від бухгалтера — їх ще немає.',
  noticed: 'Квартальний звіт чекає на цифри від бухгалтера',
  whyItMatters: 'Без цифр звіт не звести, а дата перевірки — сьогодні',
  ask: 'Напишіть, коли цифри прийдуть',
};

/** The person in the channel: what was awaited has arrived. */
export const AP2_START: readonly string[] = [
  'Цифри від бухгалтера прийшли, можна братися.',
  'Бухгалтер усе надіслав — можна братися за звіт.',
  'Цифри вже в мене, тож можна братися.',
];

/** The person schedules the Task for next week without answering the proposal. */
export const AP2_SCHEDULED_IN_DAYS = 7;

/** The person in a Notion thread: changed their mind and takes it on right away. */
export const AP2_NOW: readonly string[] = [
  'Давай усе-таки зараз.',
  'Ні, не відкладатиму — візьмуся зараз.',
  'Передумала: давай усе-таки зараз, без чекання тижня.',
];

// ---------------------------------------------------------------------------
// AP3 — rejected by the person; AP5 — its control
// ---------------------------------------------------------------------------

/**
 * The Task waits for a contract that is already signed: the blocker is `Done`. The world of AP3 and
 * of its control AP5 is the same. Only the thread differs: in AP3 it contains a rejected proposal,
 * in AP5 a note about the wait.
 */
function unblockedWorld(tag: Tag): World {
  return [
    project(tag, 'Переїзд офісу'),
    task({
      key: 'lease',
      name: named(tag, 'Підписати договір оренди нового офісу'),
      status: 'Done',
      project: 'project',
    }),
    task({
      key: 'movers',
      name: named(tag, 'Замовити перевізників на день переїзду'),
      status: 'Waiting For',
      project: 'project',
      blockedBy: ['lease'],
    }),
  ];
}

/**
 * The system's proposal the person will reject: the contract is signed, so the Task goes to
 * `Next Action`.
 */
export const AP3_PROPOSAL: StatusProposal = {
  page: 'movers',
  from: 'Waiting For',
  to: 'Next Action',
  notice: {
    thread: 'Договір оренди вже підписано, тож перевізників можна замовляти.',
    noticed: 'Договір оренди підписано — перевізників можна замовляти',
    whyItMatters: 'Задача чекала саме на цей договір',
    ask: 'Перевести задачу в наступні дії?',
    line: 'Перевести «Замовити перевізників» у наступні дії',
  },
};

/**
 * The thread of the AP5 control: the system once recorded what the Task waits for; there was no
 * proposal. If on this world the recheck proposes no change, the silence of AP3 proves nothing.
 */
export const AP5_NOTICE: SystemNotice = {
  thread: 'Задача чекає на підписання договору оренди — без нього перевізників не замовити.',
  noticed: 'Перевізників замовимо після підписання договору оренди',
  whyItMatters: 'Без договору дата переїзду не певна',
  ask: 'Нагадати, коли договір підпишуть?',
};

// ---------------------------------------------------------------------------
// AP4 — a direct instruction in the channel
// ---------------------------------------------------------------------------

/** A Task with a deadline in four days. */
function deadlineWorld(tag: Tag): World {
  return [
    project(tag, 'Оновлення сайту'),
    task({
      key: 'copy',
      name: named(tag, 'Підготувати тексти для нової головної сторінки'),
      status: 'Next Action',
      project: 'project',
      deadlineInDays: 4,
    }),
  ];
}

export const AP4_NOTICE: SystemNotice = {
  thread: 'До дедлайну текстів для нової головної лишається чотири дні.',
  noticed: 'Дедлайн текстів для нової головної — за чотири дні',
  whyItMatters: 'Від текстів залежить запуск нової головної',
  ask: 'Чи встигаєте до дедлайну?',
};

/** The number of days from today to the date the person names as the new deadline. */
export const AP4_MOVED_IN_DAYS = 12;

/** The person in the channel names the new deadline as an absolute date. */
export const AP4_MOVE: readonly ((date: string) => string)[] = [
  (date) => `Перенеси дедлайн на ${date}.`,
  (date) => `Не встигаю — перенеси дедлайн на ${date}.`,
  (date) => `Давай дедлайн на ${date}, раніше не вийде.`,
];

/** Months in the genitive case: that is how the person says a date. */
const MONTHS: readonly string[] = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

/**
 * Renders a `YYYY-MM-DD` date in the person's words: “14 листопада” (‘14 November’), with the year
 * only when it is not the current year, because otherwise the person does not say it.
 */
export function spokenDate(day: string, today: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const words = `${date ?? 0} ${MONTHS[(month ?? 1) - 1] ?? ''}`;

  return today.startsWith(`${year ?? 0}-`) ? words : `${words} ${year ?? 0} року`;
}

/** M9 scenarios: the world and what the steps change on behalf of the person. */
export const M9_PROCEDURES: Readonly<Record<M9ScenarioId, Procedure>> = {
  AP1_proposal_approved: { world: approvedWorld, slots: [], replies: true },
  AP2_outpaced_reproposed: {
    world: outpacedWorld,
    slots: ['task.status', 'task.date'],
    replies: true,
  },
  AP3_rejected_kept: { world: unblockedWorld, slots: [], replies: false },
  AP4_deadline_instruction: { world: deadlineWorld, slots: [], replies: true },
  AP5_unblocked_proposed: { world: unblockedWorld, slots: [], replies: false },
};
