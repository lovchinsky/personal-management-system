import type { ProposalRequest } from '../../src/approvals/proposal.schema';
import type { SweepRule, WorkflowMode } from '../../src/generated/prisma/enums';
import type { ReviewMode } from '../../src/runs/trigger-envelope';
import type { World, WorldPage } from './m5-scenarios';
import type { ScenarioId } from './m6-scenarios';
import { brand, task, type AnchorMemory, type Procedure, type Tag } from './scenario-kit';

/**
 * Scenarios of gate M8 (`docs/5-plan.md` § “M8 — Time-based cognition and reviews”): scheduled
 * reviews, the sweep, the reconciliation of resolved threads and ingress by page content. Each is
 * a procedure: a world and steps, which `m8-conduct.ts` conducts; the expectations are in
 * `m8-claims.ts`.
 *
 * A review reads the databases in full, so the world of a review is everything in the gate
 * workspace for the duration of the attempt, together with the seeded stale Inbox items
 * (`m8-fixtures.ts`). An object a claim is about has a Latin stem in its name. The claim
 * recognizes the object in a text by that stem, because inflection does not change it.
 */
export type M8ScenarioId =
  | 'C1_resolution_reconciled'
  | 'D1_daily_control'
  | 'W1_weekly_review'
  | 'S1_strategic_review'
  | 'SW1_safety_sweep'
  | 'X1_body_commitment'
  | 'S2_strategic_lesson'
  | 'DP1_deep_review';

/** Builds the name of a world page: what it is, the stem of the object and the attempt tag. */
const named = (tag: Tag, text: string): string => `${text} «${brand(tag)}»`;

const project = (
  key: string,
  name: string,
  status: Extract<WorldPage, { type: 'project' }>['status'],
  keyResults?: readonly string[],
): WorldPage => ({ key, type: 'project', name, status, ...(keyResults ? { keyResults } : {}) });

/**
 * The mode of the scenario's model run: before the world, the gate waits for the Notion query
 * allowance for that mode.
 */
export const MODEL_MODE_OF: Readonly<Partial<Record<ScenarioId, WorkflowMode>>> = {
  D1_daily_control: 'daily_control',
  W1_weekly_review: 'weekly_control_review',
  S1_strategic_review: 'strategic_review',
  S2_strategic_lesson: 'strategic_review',
  DP1_deep_review: 'deep_review',
  SW1_safety_sweep: 'scheduled_recheck',
  X1_body_commitment: 'event_evaluation',
};

/** The review a scenario conducts. */
export const REVIEW_OF: Readonly<Partial<Record<ScenarioId, ReviewMode>>> = {
  D1_daily_control: 'daily_control',
  W1_weekly_review: 'weekly_control_review',
  S1_strategic_review: 'strategic_review',
  S2_strategic_lesson: 'strategic_review',
  DP1_deep_review: 'deep_review',
};

// ---------------------------------------------------------------------------
// D1 — Daily Control
// ---------------------------------------------------------------------------

/** D1 stems by the role of the object in the review. */
export const D1_STEMS = {
  deadlineToday: 'Halvard',
  timedTomorrow: 'Brandt',
  scheduledToday: 'Cedrik',
  overdue: 'Dorset',
  pausedFixed: 'Ellwood',
  /** Available Now candidates: `Next Action` of an `Active` Project, without dates. */
  eligible: [
    'Fennick',
    'Garrow',
    'Holm',
    'Ivers',
    'Jarrah',
    'Kessel',
    'Lindqvist',
    'Mordaunt',
    'Norrell',
  ],
  /** `Next Action` of a paused Project, without dates: outside Available Now. */
  pausedOpen: ['Aldous', 'Bexley', 'Corwin', 'Dunmore'],
  someday: ['Ostrava', 'Pellam', 'Quimby', 'Rusk', 'Sallow', 'Tregar'],
  done: ['Umber', 'Varga', 'Wexley', 'Yarrow', 'Zenda'],
  fresh: 'Quillon',
} as const;

/** The `Next Action` Task on which a proposal is already open before the review. */
export const D1_PROPOSAL_TASK = 'kessel';

/** The text with which the evaluation run explained its proposal in the Task's thread. */
export const D1_PROPOSAL_QUESTION = 'Схоже, хостинг уже оплачено. Позначити задачу виконаною?';

/**
 * Builds the proposal of an evaluation run on the Task `D1_PROPOSAL_TASK`: mark it done. Like every
 * proposal, it names the value the write will change, so the App accepts it and executes it once.
 */
export function d1ProposalOf(
  pageId: string,
  statusProperty: string,
  discussionId: string,
): ProposalRequest {
  return {
    discussionId,
    effects: [
      {
        kind: 'property_write',
        pageId,
        propertyId: statusProperty,
        value: { kind: 'option', option: 'Done' },
      },
    ],
    preconditions: [
      {
        kind: 'property_reads_as',
        pageId,
        propertyId: statusProperty,
        value: { kind: 'option', option: 'Next Action' },
      },
    ],
  };
}

const D1_ELIGIBLE_TEXT: readonly string[] = [
  'Написати текст для розсилки Fennick',
  'Перевірити рахунок від Garrow',
  'Замовити візитки в друкарні Holm',
  'Узгодити договір з підрядником Ivers',
  'Підготувати квартальний звіт для Jarrah',
  'Оплатити хостинг Kessel',
  'Відповісти на лист партнера Lindqvist',
  'Зібрати відгуки клієнтів Mordaunt',
  'Оновити портфоліо для Norrell',
];

function dailyWorld(tag: Tag): World {
  const stems = D1_STEMS;
  const inLaunch = (
    key: string,
    text: string,
    status: Extract<WorldPage, { type: 'task' }>['status'],
  ): WorldPage => task({ key, name: named(tag, text), status, project: 'launch' });

  return [
    project('launch', named(tag, 'Запуск нової лінійки сайту'), 'Active'),
    task({
      key: 'deadlineToday',
      name: named(tag, `Надіслати макет буклета клієнту ${stems.deadlineToday}`),
      status: 'Next Action',
      project: 'launch',
      deadlineInDays: 0,
    }),
    task({
      key: 'timedTomorrow',
      name: named(tag, `Дзвінок з бухгалтеркою ${stems.timedTomorrow}`),
      status: 'Scheduled',
      project: 'launch',
      dateInDays: 1,
      dateAt: '10:00',
    }),
    task({
      key: 'scheduledToday',
      name: named(tag, `Оновити прайс для ${stems.scheduledToday}`),
      status: 'Scheduled',
      project: 'launch',
      dateInDays: 0,
    }),
    task({
      key: 'overdue',
      name: named(tag, `Забронювати зал ${stems.overdue} для презентації`),
      status: 'Scheduled',
      project: 'launch',
      dateInDays: -2,
    }),
    ...D1_ELIGIBLE_TEXT.map((text, index) =>
      inLaunch(stems.eligible[index]?.toLowerCase() ?? `eligible${index}`, text, 'Next Action'),
    ),
    inLaunch('umber', `Зібрати вимоги до лінійки ${stems.done[0]}`, 'Done'),
    inLaunch('varga', `Погодити кольори з ${stems.done[1]}`, 'Done'),
    inLaunch('wexley', `Налаштувати домен ${stems.done[2]}`, 'Done'),
    inLaunch('yarrow', `Написати тексти головної ${stems.done[3]}`, 'Done'),
    inLaunch('zenda', `Перевірити мобільну версію ${stems.done[4]}`, 'Done'),
    inLaunch('ostrava', `Перекласти сайт для ринку ${stems.someday[0]}`, 'Someday/Maybe'),
    inLaunch('pellam', `Запустити блог ${stems.someday[1]}`, 'Someday/Maybe'),
    inLaunch('quimby', `Зняти відео про команду ${stems.someday[2]}`, 'Someday/Maybe'),
    inLaunch('rusk', `Додати чат на сайт ${stems.someday[3]}`, 'Someday/Maybe'),
    project('warehouse', named(tag, 'Переїзд складу'), 'Paused'),
    task({
      key: 'pausedFixed',
      name: named(tag, `Подовжити оренду складу ${stems.pausedFixed}`),
      status: 'Next Action',
      project: 'warehouse',
      deadlineInDays: 1,
    }),
    ...[
      `Знайти перевізника ${stems.pausedOpen[0]}`,
      `Скласти опис стелажів ${stems.pausedOpen[1]}`,
      `Домовитися про ключі з ${stems.pausedOpen[2]}`,
      `Замовити коробки в ${stems.pausedOpen[3]}`,
    ].map((text, index) =>
      task({
        key: `pausedOpen${index}`,
        name: named(tag, text),
        status: 'Next Action',
        project: 'warehouse',
      }),
    ),
    task({
      key: 'sallow',
      name: named(tag, `Записатися на курс кераміки ${stems.someday[4]}`),
      status: 'Someday/Maybe',
    }),
    task({
      key: 'tregar',
      name: named(tag, `Поїхати в похід до ${stems.someday[5]}`),
      status: 'Someday/Maybe',
    }),
    {
      key: 'founder',
      type: 'identity',
      name: named(tag, 'Підприємець'),
      body: [
        'Будую невелику справу, яка годує родину й не з’їдає вечори.',
        'Принципи: спершу клієнт, потім продукт; не беру більше трьох великих справ водночас.',
      ],
    },
    {
      key: 'fresh',
      type: 'inbox_item',
      name: named(tag, `Ідея для розсилки ${stems.fresh}`),
      text: 'Розповісти про нову лінійку тим, хто купував торік',
    },
  ];
}

// ---------------------------------------------------------------------------
// W1 — Weekly Control Review
// ---------------------------------------------------------------------------

export const W1_STEMS = {
  waiting: 'Tamsin',
  nextAction: 'Ochre',
  upcoming: 'Marlow',
  overdueDeadline: 'Brannock',
  stalled: 'Oriel',
  planning: 'Penrose',
  paused: 'Larkin',
  resolved: 'Pellis',
  behavior: 'Saffron',
  area: 'Thistle',
  quietArea: 'Hollin',
} as const;

function weeklyWorld(tag: Tag): World {
  const stems = W1_STEMS;

  return [
    project('flat', named(tag, 'Ремонт квартири'), 'Active'),
    task({
      key: 'waiting',
      name: named(tag, `Отримати кошторис від бригади ${stems.waiting}`),
      status: 'Waiting For',
      project: 'flat',
      dateInDays: -2,
      deadlineInDays: 12,
    }),
    task({
      key: 'tiles',
      name: named(tag, 'Вибрати плитку для ванної'),
      status: 'Done',
      project: 'flat',
    }),
    project('studio', named(tag, 'Оновлення сайту студії'), 'Active'),
    task({
      key: 'nextAction',
      name: named(tag, `Підготувати тексти для сторінки ${stems.nextAction}`),
      status: 'Next Action',
      project: 'studio',
    }),
    task({
      key: 'upcoming',
      name: named(tag, `Зустріч з дизайнером ${stems.upcoming}`),
      status: 'Scheduled',
      project: 'studio',
      dateInDays: 3,
    }),
    task({
      key: 'overdueDeadline',
      name: named(tag, `Надіслати звіт клієнту ${stems.overdueDeadline}`),
      status: 'Next Action',
      project: 'studio',
      deadlineInDays: -3,
    }),
    project('stalled', named(tag, `Переклад книжки ${stems.stalled}`), 'Active'),
    task({
      key: 'chapterOne',
      name: named(tag, 'Перекласти перший розділ'),
      status: 'Done',
      project: 'stalled',
    }),
    task({
      key: 'chapterTwo',
      name: named(tag, 'Перекласти другий розділ'),
      status: 'Done',
      project: 'stalled',
    }),
    project('planning', named(tag, `Курс гончарства ${stems.planning}`), 'Planning'),
    project('paused', named(tag, `Облаштування саду ${stems.paused}`), 'Paused'),
    task({
      key: 'pausedFixed',
      name: named(tag, `Оплатити саджанці для саду ${stems.paused}`),
      status: 'Next Action',
      project: 'paused',
      deadlineInDays: 4,
    }),
    project('gallery', named(tag, 'Виставка в галереї'), 'Active'),
    task({
      key: 'permit',
      name: named(tag, 'Отримати дозвіл галереї на виставку'),
      status: 'Done',
      project: 'gallery',
    }),
    task({
      key: 'resolved',
      name: named(tag, `Надрукувати каталог ${stems.resolved}`),
      status: 'Waiting For',
      project: 'gallery',
      blockedBy: ['permit'],
    }),
    {
      key: 'behavior',
      type: 'behavior_system',
      name: named(tag, `Ранкова йога ${stems.behavior}`),
      lifecycle: 'Installing',
      body: [
        'Мінімум: десять хвилин на килимку одразу після кави.',
        'Що бачу третій тиждень: коли встаю після 7:30, пропускаю. Килимок лежить у шафі за коробками, і щоразу його треба діставати.',
      ],
    },
    {
      key: 'area',
      type: 'area_of_focus',
      name: named(tag, `Музика ${stems.area}`),
      mode: 'Advance',
    },
    task({
      key: 'strings',
      name: named(tag, `Купити струни для гітари ${stems.area}`),
      status: 'Done',
      areaOfFocus: 'area',
    }),
    task({
      key: 'lessons',
      name: named(tag, `Записатися на уроки гітари ${stems.area}`),
      status: 'Someday/Maybe',
      areaOfFocus: 'area',
    }),
    // An Area of Focus under `Maintain` with nothing linked to it: upkeep is quiet, and the review
    // does not raise it.
    {
      key: 'quietArea',
      type: 'area_of_focus',
      name: named(tag, `Дім ${stems.quietArea}`),
      mode: 'Maintain',
    },
  ];
}

/** Returns what the memory already knows about the W1 Area of Focus: its `Standard`. */
function weeklyMemory(tag: Tag): readonly AnchorMemory[] {
  return [
    {
      kind: 'anchor',
      key: 'areaAnchor',
      of: 'area',
      type: 'area_of_focus',
      title: named(tag, `Музика ${W1_STEMS.area}`),
      paragraphs: ['Гітара — для себе, без виступів.'],
      facts: ['Standard: щотижня принаймні дві години гри на гітарі.'],
    },
  ];
}

// ---------------------------------------------------------------------------
// S1 — Strategic Review
// ---------------------------------------------------------------------------

export const S1_STEMS = {
  course: 'Halcyon',
  enrolment: 'Lumen',
  rating: 'Corbel',
  recording: 'Aurelia',
  marketing: 'Beacon',
  race: 'Brigantine',
  distance: 'Strider',
  training: 'Cobalt',
  area: 'Verbena',
} as const;

/**
 * Key Results of S1: the target as it stands in the name. Besides the stem of the name, the text
 * of a run can refer to a Key Result by the target, which the model writes in its own way (“4.5”,
 * “30км”), or by what the Key Result measures: “що показує опитування?” (‘what does the survey
 * show?’) asks about the Key Result named in the paragraph above.
 */
export const S1_KEY_RESULTS = {
  enrolment: { target: '40 учнів', reference: /(?<![\p{N},.])40\s*учн/iu },
  rating: { target: '4,5', reference: /(?<![\p{N},.])4[,.]5(?!\p{N})|опитуванн|оцінк/iu },
  distance: { target: '30 км', reference: /(?<![\p{N},.])30\s*км|кілометр|пробіга/iu },
} as const;

/** Threads on the S1 Objectives: the system's question and the person's reply in the channel. */
export const S1_THREADS: readonly {
  readonly page: string;
  readonly question: string;
  readonly answer: string;
}[] = [
  {
    page: 'course',
    question: 'Як просувається онлайн-курс?',
    answer: 'Маркетингова кампанія вже скінчилася, а на перший потік записалося лише 25 людей.',
  },
  {
    page: 'race',
    question: 'Скільки часу зараз маєте на підготовку до забігу?',
    answer: 'Зараз маю лише три вільні вечори на тиждень — і на курс, і на біг разом.',
  },
];

function strategicWorld(tag: Tag): World {
  const stems = S1_STEMS;
  const results = S1_KEY_RESULTS;
  const scheduled = (key: string, text: string, owner: string, days: number): WorldPage =>
    task({ key, name: named(tag, text), status: 'Scheduled', project: owner, dateInDays: days });

  return [
    {
      key: 'area',
      type: 'area_of_focus',
      name: named(tag, `Здоров'я ${stems.area}`),
      mode: 'Minimum',
    },
    { key: 'course', type: 'objective', name: named(tag, `Запустити онлайн-курс ${stems.course}`) },
    {
      key: 'enrolment',
      type: 'key_result',
      name: named(tag, `Перший потік ${stems.enrolment}: ${results.enrolment.target}`),
      objective: 'course',
    },
    {
      key: 'rating',
      type: 'key_result',
      name: named(
        tag,
        `Опитування ${stems.rating}: учні оцінюють курс щонайменше на ${results.rating.target}`,
      ),
      objective: 'course',
    },
    project('marketing', named(tag, `Маркетингова кампанія ${stems.marketing}`), 'Done', [
      'enrolment',
    ]),
    project('recording', named(tag, `Записати відео уроків ${stems.recording}`), 'Active', [
      'rating',
    ]),
    scheduled('shoot', 'Зняти третій урок', 'recording', 3),
    scheduled('edit', 'Змонтувати третій урок', 'recording', 4),
    scheduled('publish', 'Опублікувати третій урок', 'recording', 5),
    {
      key: 'race',
      type: 'objective',
      name: named(tag, `Пробігти напівмарафон ${stems.race}`),
      areaOfFocus: 'area',
    },
    {
      key: 'distance',
      type: 'key_result',
      name: named(tag, `Тижневий кілометраж у ${stems.distance}: ${results.distance.target}`),
      objective: 'race',
    },
    project('training', named(tag, `План тренувань ${stems.training}`), 'Active', ['distance']),
    scheduled('intervals', 'Інтервальне тренування', 'training', 3),
    scheduled('tempo', 'Темпова пробіжка', 'training', 4),
    scheduled('long', 'Довга пробіжка', 'training', 5),
  ];
}

/** Returns the acceptable state of the S1 Area of Focus, which the memory already knows. */
function strategicMemory(tag: Tag): readonly AnchorMemory[] {
  return [
    {
      kind: 'anchor',
      key: 'areaAnchor',
      of: 'area',
      type: 'area_of_focus',
      title: named(tag, `Здоров'я ${S1_STEMS.area}`),
      paragraphs: ['Тримати форму без змагань.'],
      facts: ['Standard: двох тренувань на тиждень досить, щоб тримати форму.'],
    },
  ];
}

// ---------------------------------------------------------------------------
// S2 — a lesson in the Strategic Review
// ---------------------------------------------------------------------------

export const S2_STEMS = { goal: 'Sombra', first: 'Tarnow', second: 'Kalisz' } as const;

function lessonWorld(tag: Tag): World {
  return [
    { key: 'goal', type: 'objective', name: named(tag, `Вивчити іспанську ${S2_STEMS.goal}`) },
    {
      key: 'level',
      type: 'key_result',
      name: named(tag, `Рівень B1 з іспанської ${S2_STEMS.goal}`),
      objective: 'goal',
    },
    project('courses', named(tag, `Курси іспанської ${S2_STEMS.goal}`), 'Active', ['level']),
    task({
      key: 'homework',
      name: named(tag, 'Зробити домашнє завдання з іспанської'),
      status: 'Next Action',
      project: 'courses',
    }),
  ];
}

function lessonMemory(tag: Tag): readonly AnchorMemory[] {
  return [
    {
      kind: 'anchor',
      key: 'coursesAnchor',
      of: 'courses',
      type: 'project',
      title: named(tag, `Курси іспанської ${S2_STEMS.goal}`),
      paragraphs: ['Заняття двічі на тиждень увечері.'],
      timeline: [
        {
          date: '2026-08-03',
          summary: `Пропустив два заняття через відрядження в ${S2_STEMS.first}`,
          source: 'Telegram',
        },
        {
          date: '2026-09-14',
          summary: `Знову пропустив заняття через робочу поїздку в ${S2_STEMS.second}`,
          source: 'коментар у Notion',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// DP1 — Deep Review
// ---------------------------------------------------------------------------

const DP1_STEMS = { failed: 'Garnet' } as const;

function deepWorld(tag: Tag): World {
  return [
    {
      key: 'identity',
      type: 'identity',
      name: named(tag, 'Батько'),
      body: [
        'Бути поруч із сином у важливі для нього моменти.',
        'Принципи: обіцянку синові виконую; вечори буднів — для родини.',
      ],
    },
    {
      key: 'family',
      type: 'area_of_focus',
      name: named(tag, "Сім'я"),
      mode: 'Maintain',
      identities: ['identity'],
    },
    task({
      key: 'pickup',
      name: named(tag, `Забрати сина з тренування вчасно ${DP1_STEMS.failed}`),
      status: 'Failed',
      areaOfFocus: 'family',
      deadlineInDays: -1,
    }),
  ];
}

// ---------------------------------------------------------------------------
// SW1 — the sweep wakes a check
// ---------------------------------------------------------------------------

export const SW1_STEMS = { woken: 'Quarry' } as const;

function sweepWorld(tag: Tag): World {
  return [
    project('site', named(tag, 'Запуск сайту'), 'Active'),
    task({
      key: 'woken',
      name: named(tag, `Отримати підписаний договір від юристів ${SW1_STEMS.woken}`),
      status: 'Waiting For',
      project: 'site',
      dateInDays: -1,
      deadlineInDays: 1,
    }),
    project('shop', named(tag, 'Інтернет-магазин'), 'Active'),
    task({
      key: 'later',
      name: named(tag, 'Дочекатися відповіді постачальника'),
      status: 'Waiting For',
      project: 'shop',
      dateInDays: 3,
    }),
    task({
      key: 'photos',
      name: named(tag, 'Сфотографувати товари'),
      status: 'Next Action',
      project: 'shop',
    }),
    project('archive', named(tag, 'Архів документів'), 'Paused'),
    task({
      key: 'paused',
      name: named(tag, 'Отримати скани від нотаріуса'),
      status: 'Waiting For',
      project: 'archive',
      dateInDays: -1,
    }),
    project('blog', named(tag, 'Блог'), 'Active'),
    task({
      key: 'today',
      name: named(tag, 'Опублікувати пост'),
      status: 'Scheduled',
      project: 'blog',
      dateInDays: 0,
    }),
  ];
}

// ---------------------------------------------------------------------------
// X1 — a body edit wakes an evaluation
// ---------------------------------------------------------------------------

export const X1_STEMS = { client: 'Halyard' } as const;

/**
 * A note in the Task body, written by the person: a promise to a client with a date, and no Task
 * for it.
 */
export const X1_NOTE = `Дзвонив Віктор із ${X1_STEMS.client}: я пообіцяв до п'ятниці надіслати йому фото приміщення й план поверху.`;

/** The number of days from today to the `Deadline` of the X1 Task after the person has moved it. */
export const X1_MOVED_DEADLINE_DAYS = 5;

function bodyWorld(tag: Tag): World {
  return [
    project('office', named(tag, 'Ремонт офісу'), 'Active'),
    task({
      key: 'estimate',
      name: named(tag, 'Підготувати кошторис ремонту офісу'),
      status: 'Next Action',
      project: 'office',
      deadlineInDays: 7,
    }),
    {
      key: 'home',
      type: 'area_of_focus',
      name: named(tag, 'Дім'),
      mode: 'Maintain',
      body: ['Що тут важливо: тепло взимку, порядок у документах на квартиру.'],
    },
  ];
}

// ---------------------------------------------------------------------------
// C1 — reconciliation of resolved threads
// ---------------------------------------------------------------------------

/**
 * System threads of C1, one per Task: the person resolves one, one stays open, the gate deletes
 * one. Comments the API writes to a page, Notion puts into one thread of the page (measured), so
 * three threads are three pages.
 */
export const C1_THREADS = {
  resolved: { page: 'confirm', text: 'Чи підтвердили дату доставки меблів?' },
  open: { page: 'chairs', text: 'Чи потрібна допомога із замовленням стільців?' },
  deleted: { page: 'invoice', text: 'Чи надіслали рахунок за меблі?' },
} as const;

function reconciliationWorld(tag: Tag): World {
  return [
    project('furniture', named(tag, 'Нові меблі для офісу'), 'Active'),
    task({
      key: 'confirm',
      name: named(tag, 'Дочекатися доставки меблів'),
      status: 'Waiting For',
      project: 'furniture',
      dateInDays: 2,
    }),
    task({
      key: 'chairs',
      name: named(tag, 'Замовити стільці'),
      status: 'Next Action',
      project: 'furniture',
    }),
    task({
      key: 'invoice',
      name: named(tag, 'Оплатити рахунок за меблі'),
      status: 'Next Action',
      project: 'furniture',
    }),
  ];
}

// ---------------------------------------------------------------------------
// Model-free check of the sweep finder: a positive for each rule, and controls
// ---------------------------------------------------------------------------

/** What the finder must find in the check world: the page (key) and the rule. */
export const FINDER_EXPECTED: readonly { readonly page: string; readonly rule: SweepRule }[] = [
  { page: 'due', rule: 'check_date_reached' },
  { page: 'late', rule: 'deadline_signal' },
  { page: 'stalled', rule: 'project_path' },
  { page: 'paused', rule: 'paused_commitment' },
  { page: 'closed', rule: 'project_closure' },
  { page: 'blocked', rule: 'dependency_contradiction' },
];

export function finderWorld(tag: Tag): World {
  return [
    project('dueProject', named(tag, 'Договір оренди'), 'Active'),
    task({
      key: 'due',
      name: named(tag, 'Отримати відповідь орендодавця'),
      status: 'Waiting For',
      project: 'dueProject',
      dateInDays: -1,
    }),
    project('lateProject', named(tag, 'Податки'), 'Active'),
    task({
      key: 'late',
      name: named(tag, 'Подати декларацію'),
      status: 'Next Action',
      project: 'lateProject',
      deadlineInDays: -1,
    }),
    task({
      key: 'lateOther',
      name: named(tag, 'Зібрати довідки'),
      status: 'Next Action',
      project: 'lateProject',
    }),
    project('stalled', named(tag, 'Фотоальбом'), 'Active'),
    task({
      key: 'stalledDone',
      name: named(tag, 'Відібрати фото'),
      status: 'Done',
      project: 'stalled',
    }),
    project('paused', named(tag, 'Ремонт балкона'), 'Paused'),
    task({
      key: 'pausedFixed',
      name: named(tag, 'Оплатити матеріали'),
      status: 'Next Action',
      project: 'paused',
      deadlineInDays: 2,
    }),
    task({
      key: 'pausedWaiting',
      name: named(tag, 'Дочекатися майстра'),
      status: 'Waiting For',
      project: 'paused',
      dateInDays: -1,
    }),
    project('closed', named(tag, 'Переїзд'), 'Done'),
    task({
      key: 'closedOpen',
      name: named(tag, 'Повернути ключі від старої квартири'),
      status: 'Next Action',
      project: 'closed',
    }),
    project('blockedProject', named(tag, 'Виставка'), 'Active'),
    task({
      key: 'blocker',
      name: named(tag, 'Отримати дозвіл'),
      status: 'Done',
      project: 'blockedProject',
    }),
    task({
      key: 'blocked',
      name: named(tag, 'Надрукувати каталог'),
      status: 'Waiting For',
      project: 'blockedProject',
      blockedBy: ['blocker'],
    }),
    project('healthy', named(tag, 'Блог'), 'Active'),
    task({
      key: 'later',
      name: named(tag, 'Дочекатися відповіді редактора'),
      status: 'Waiting For',
      project: 'healthy',
      dateInDays: 3,
    }),
    task({
      key: 'today',
      name: named(tag, 'Опублікувати пост'),
      status: 'Scheduled',
      project: 'healthy',
      dateInDays: 0,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Catalog of procedures
// ---------------------------------------------------------------------------

export const M8_PROCEDURES: Readonly<Record<M8ScenarioId, Procedure>> = {
  C1_resolution_reconciled: { world: reconciliationWorld, slots: [], replies: false },
  D1_daily_control: { world: dailyWorld, slots: [], replies: false },
  W1_weekly_review: { world: weeklyWorld, slots: [], memory: weeklyMemory, replies: false },
  S1_strategic_review: {
    world: strategicWorld,
    slots: [],
    memory: strategicMemory,
    replies: true,
  },
  SW1_safety_sweep: { world: sweepWorld, slots: [], replies: false },
  X1_body_commitment: { world: bodyWorld, slots: ['task.deadline'], replies: false },
  S2_strategic_lesson: { world: lessonWorld, slots: [], memory: lessonMemory, replies: false },
  DP1_deep_review: { world: deepWorld, slots: [], replies: false },
};
