import { idOf } from '../fixtures/m6-evidence.fixture';
import { commentOn, FIXTURE_IDS, loaded, ran } from '../fixtures/m8-evidence.fixture';
import type { Claim } from './gate-claims';
import {
  bodyClaim,
  dailyClaim,
  deepClaim,
  reconciliationClaim,
  strategicClaim,
  sweepClaim,
  weeklyClaim,
  type ReconciliationSteps,
} from './m8-claims';
import type { Evidence8, ReconcileTick } from './m8-evidence';

/** Selects the claim's observations that do not hold; the test reports from them what broke. */
const failing = (claim: Claim): string[] =>
  claim.observations
    .filter((observation) => !observation.ok)
    .map((observation) => observation.item);

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------

const PROPOSAL = 'proposal-0';

const DAILY_NOTICED = [
  'Сьогодні дедлайн: надіслати макет буклета клієнту Halvard.',
  'Завтра о 10:00 — дзвінок з бухгалтеркою Brandt.',
  'На сьогодні заплановано: оновити прайс для Cedrik.',
  'Минула дата: забронювати зал Dorset — ще потрібно?',
  'Проєкт на паузі має дедлайн завтра: подовжити оренду складу Ellwood.',
  'Можна почати: розсилка Fennick, рахунок Garrow, візитки Holm.',
  '2 записи Inbox чекають розбору понад 3 доби.',
].join('\n');

function daily(overrides: { noticed?: string; reads?: Evidence8['reads'] } = {}): Evidence8 {
  return ran('D1_daily_control', {
    notice: {
      noticed: overrides.noticed ?? DAILY_NOTICED,
      whyItMatters: 'Сьогодні два жорсткі строки.',
      ask: 'Пропозицію вирішіть кнопками — вони діють до наступного щоденного огляду.',
      link: 'https://www.notion.so/page',
      proposals: [{ pendingActionId: PROPOSAL, line: 'Оплата хостингу: статус — Done' }],
    },
    reads: overrides.reads ?? [loaded(['deadlineToday', 'fennick', 'garrow'])],
  });
}

describe('dailyClaim', () => {
  it('a packet that shows the day and pulls in no backlog holds', () => {
    expect(failing(dailyClaim(daily(), PROPOSAL))).toEqual([]);
  });

  it('a named Someday/Maybe Task violates the effect', () => {
    const claim = dailyClaim(
      daily({ noticed: `${DAILY_NOTICED}\nКолись: блог Pellam.` }),
      PROPOSAL,
    );

    expect(failing(claim)).toEqual(['the packet names no Someday/Maybe task']);
  });

  it('a loaded Done Task means the review read the backlog', () => {
    const claim = dailyClaim(daily({ reads: [loaded(['deadlineToday', 'umber'])] }), PROPOSAL);

    expect(failing(claim)).toEqual(['no Done or Someday/Maybe task of the world is loaded']);
  });

  /** No conclusion “nothing was loaded” can be drawn from an answer that is not parsed. */
  it.each([
    ['from the Tasks database', ['ds-task']],
    ['from an unknown database', null],
  ])('an unparsed answer %s leaves what was loaded unobserved', (_, dataSources) => {
    const claim = dailyClaim(
      daily({ reads: [{ ...loaded([]), pages: null, dataSources }] }),
      PROPOSAL,
    );

    expect(claim.unobserved).toEqual(['what the run loaded: a reply of Notion did not parse']);
    expect(claim.observations.map((item) => item.item)).not.toContain(
      'no Done or Someday/Maybe task of the world is loaded',
    );
  });

  /** A query to the Inbox returns no Tasks, so its unparsed answer says nothing about the Tasks. */
  it('an unparsed answer from another database leaves what was loaded observed', () => {
    const claim = dailyClaim(
      daily({ reads: [{ ...loaded([]), pages: null, dataSources: ['ds-inbox_item'] }] }),
      PROPOSAL,
    );

    expect(claim.unobserved).toEqual([]);
    expect(claim.observations.map((item) => item.item)).toContain(
      'no Done or Someday/Maybe task of the world is loaded',
    );
  });

  it('naming the seeded items one by one fails because the Daily Control states only a number', () => {
    const claim = dailyClaim(
      daily({ noticed: `${DAILY_NOTICED}\nСеред них курс Vellum.` }),
      PROPOSAL,
    );

    expect(failing(claim)).toEqual(['the packet gives the stale Inbox items only as a number']);
  });

  it.each([
    ['as the word “два”', 'Два записи у Вхідних чекають розбору.', []],
    [
      'as the wrong number',
      '3 записи Inbox чекають розбору.',
      ['the packet counts two stale Inbox items in one line'],
    ],
  ])('the number of stale items given %s', (_, line, failed) => {
    const noticed = DAILY_NOTICED.replace('2 записи Inbox чекають розбору понад 3 доби.', line);

    expect(failing(dailyClaim(daily({ noticed }), PROPOSAL))).toEqual(failed);
  });

  it('an Available Now that lists every candidate is not a selection', () => {
    const all = 'Fennick, Garrow, Holm, Ivers, Jarrah, Kessel, Lindqvist, Mordaunt, Norrell';
    const claim = dailyClaim(
      daily({
        noticed: DAILY_NOTICED.replace('розсилка Fennick, рахунок Garrow, візитки Holm', all),
      }),
      PROPOSAL,
    );

    expect(failing(claim)).toEqual(['the Available Now offers some of the candidates, not all']);
  });

  /**
   * A proposal line names its page, and the page is among the candidates, but that does not make
   * an Available Now.
   */
  it('a candidate named only by a proposal line means there is no Available Now', () => {
    const noticed = DAILY_NOTICED.replace(
      'Можна почати: розсилка Fennick, рахунок Garrow, візитки Holm.\n',
      '',
    );
    const evidence = ran('D1_daily_control', {
      notice: {
        noticed,
        whyItMatters: 'Сьогодні два жорсткі строки.',
        ask: 'Пропозицію вирішіть кнопками.',
        link: 'https://www.notion.so/page',
        proposals: [{ pendingActionId: PROPOSAL, line: 'Оплатити хостинг Kessel: статус — Done' }],
      },
      reads: [loaded(['deadlineToday'])],
    });

    expect(failing(dailyClaim(evidence, PROPOSAL))).toEqual([
      'the Available Now offers some of the candidates, not all',
    ]);
  });

  it('a packet without the proposal that waits violates the effect', () => {
    expect(failing(dailyClaim(daily(), 'other-proposal'))).toEqual([
      'the packet carries the proposal that waits',
    ]);
  });
});

// ---------------------------------------------------------------------------
// W1
// ---------------------------------------------------------------------------

const T1 = 'thread-1';
const T2 = 'thread-2';

type Detections = readonly (readonly [string, readonly string[]])[];

/** Returns the labels of the W1 review that covers the week, each on the page of its finding. */
function weeklyDetections(): Detections {
  return [
    ['unclarified_input', [FIXTURE_IDS.plain]],
    ['dependency', [idOf('waiting')]],
    ['project_integrity', [idOf('stalled')]],
    ['project_integrity', [idOf('planning')]],
    ['project_integrity', [idOf('paused')]],
    ['behavior_system_friction', [idOf('behavior')]],
    ['area_of_focus_risk', [idOf('area'), idOf('strings'), idOf('lessons')]],
    ['contradiction', [idOf('resolved')]],
  ];
}

function weekly(overrides: Partial<Parameters<typeof ran>[1]> = {}): Evidence8 {
  return ran('W1_weekly_review', {
    notice: {
      noticed:
        'Кошторис від бригади Tamsin досі не надійшов.\nЗвіт клієнту Brannock прострочено.\nЗустріч з дизайнером Marlow — за три дні.\nКвитки Corvid чекають вашої відповіді.\nНа тиждень: тексти для сторінки Ochre.',
      whyItMatters: 'Кілька проєктів стоять.',
      ask: 'Відповідь у нитці — про каталог.',
      link: 'https://www.notion.so/page',
    },
    discussionId: T1,
    comments: [
      commentOn(idOf('resolved'), 'Дозвіл уже є — каталог можна друкувати?', T1),
      commentOn(FIXTURE_IDS.plain, 'Що робимо з курсом фотографії?', T2),
    ],
    newThreads: [T1, T2],
    proposals: [
      {
        id: 'proposal-1',
        status: 'proposed',
        effects: [
          {
            pageId: idOf('resolved'),
            propertyId: 'status',
            option: 'Next Action',
            value: 'Next Action',
          },
        ],
      },
    ],
    detections: weeklyDetections(),
    ...overrides,
  });
}

describe('weeklyClaim', () => {
  it('a review that covers the week holds', () => {
    expect(failing(weeklyClaim(weekly()))).toEqual([]);
  });

  it('a comment on a page without a finding violates the effect', () => {
    const claim = weeklyClaim(
      weekly({ comments: [commentOn(idOf('nextAction'), 'Як справи з текстами?', T1)] }),
    );

    expect(failing(claim)).toContain('comments lie only on pages with a finding');
  });

  it('a new question on an item that waits for an answer violates the effect', () => {
    const claim = weeklyClaim(
      weekly({ comments: [commentOn(FIXTURE_IDS.asked, 'То що з квитками?', T1)] }),
    );

    expect(failing(claim)).toContain(
      'the Inbox item that waits for its answer gets no new comment',
    );
  });

  /**
   * The ground of an Area of Focus label is its Tasks, because a label that cites only the Area of
   * Focus could rest on `Standard`.
   */
  it('an Area of Focus label without its Tasks violates the recognition', () => {
    const detections: Detections = weeklyDetections().map(([type, pages]) => [
      type,
      type === 'area_of_focus_risk' ? [idOf('area')] : pages,
    ]);

    expect(failing(weeklyClaim(weekly({ detections })))).toEqual([
      'the Area of Focus under Advance with nothing in motion is raised on its Tasks',
    ]);
  });

  it('a label on the quiet Area of Focus under `Maintain` violates the recognition', () => {
    const detections: Detections = [
      ...weeklyDetections(),
      ['area_of_focus_risk', [idOf('quietArea')]],
    ];

    expect(failing(weeklyClaim(weekly({ detections })))).toEqual([
      'the quiet Area of Focus under Maintain is not raised',
    ]);
  });

  it('a third new thread violates the effect', () => {
    expect(failing(weeklyClaim(weekly({ newThreads: [T1, T2, 'thread-3'] })))).toEqual([
      'the review opens at most two new threads',
    ]);
  });

  it.each([
    ['sets Failed', { pageId: idOf('stalled'), option: 'Failed' }],
    [
      'is on a Waiting For whose dependency is not resolved',
      { pageId: idOf('waiting'), option: 'Next Action' },
    ],
  ])('a proposal that %s violates the effect', (_, change) => {
    const claim = weeklyClaim(
      weekly({
        proposals: [
          {
            id: 'proposal-2',
            status: 'proposed',
            effects: [{ ...change, propertyId: 'status', value: change.option }],
          },
        ],
      }),
    );

    expect(failing(claim)).toContain(
      'every proposal lies on a page with a finding, sets no Failed and leaves the Waiting For whose dependency is open',
    );
  });

  it('a packet that attaches no thread of its run violates the effect', () => {
    expect(failing(weeklyClaim(weekly({ discussionId: null })))).toEqual([
      'a packet whose run wrote comments attaches one of their threads',
    ]);
  });

  it('a missed label means the recognition does not hold', () => {
    const claim = weeklyClaim(
      weekly({
        detections: [
          ['unclarified_input', [FIXTURE_IDS.plain]],
          ['dependency', [idOf('waiting')]],
        ],
      }),
    );

    expect(failing(claim)).toContain('the behavior with friction is raised');
  });
});

// ---------------------------------------------------------------------------
// S1, DP1
// ---------------------------------------------------------------------------

const COURSE_QUESTION = commentOn(idOf('course'), 'Що показує опитування Corbel?', T1);
const RACE_QUESTION = commentOn(idOf('race'), 'Скільки ви пробігаєте зараз: ближче до 30 км?', T2);

function strategic(overrides: Partial<Parameters<typeof ran>[1]> = {}): Evidence8 {
  return ran('S1_strategic_review', {
    notice: {
      noticed:
        "Курс Halcyon: на перший потік записалися 25 людей.\nНапівмарафон Brigantine і курс ділять три вечори.\nЗдоров'я Verbena у режимі Minimum.",
      whyItMatters: 'Вечорів на обидві цілі не вистачає.',
      ask: 'Відповідайте в обговореннях цілей: що показують їхні Key Results.',
      link: 'https://www.notion.so/page',
    },
    comments: [COURSE_QUESTION, RACE_QUESTION],
    detections: [
      ['objective_evidence_change', [idOf('course')]],
      ['resource_conflict', [idOf('shoot'), idOf('intervals')]],
    ],
    ...overrides,
  });
}

describe('strategicClaim', () => {
  it('a review of Objectives that asks and invents no evidence holds', () => {
    expect(failing(strategicClaim(strategic()))).toEqual([]);
  });

  /**
   * A finished Project does not prove a Key Result, because the evidence is only the person's
   * words.
   */
  it("an evidence change that rests on something other than the person's words violates the effect", () => {
    const claim = strategicClaim(
      strategic({
        detections: [
          ['objective_evidence_change', [idOf('marketing')]],
          ['resource_conflict', [idOf('shoot'), idOf('intervals')]],
        ],
      }),
    );

    expect(failing(claim)).toEqual([
      'the evidence of a Key Result is raised only for the first one, on the words of the person',
      'the change the person stated in the first Key Result is raised',
    ]);
  });

  it('an evidence change on a Key Result the person said nothing about violates the effect', () => {
    const claim = strategicClaim(
      strategic({
        detections: [
          ['objective_evidence_change', [idOf('course')]],
          ['objective_evidence_change', [idOf('course'), idOf('rating')]],
          ['resource_conflict', [idOf('shoot'), idOf('intervals')]],
        ],
      }),
    );

    expect(failing(claim)).toEqual([
      'the evidence of a Key Result is raised only for the first one, on the words of the person',
    ]);
  });

  it('a comment not on an Objective violates the effect', () => {
    const claim = strategicClaim(
      strategic({
        comments: [
          ...[COURSE_QUESTION, RACE_QUESTION],
          commentOn(idOf('marketing'), 'Як іде маркетинг?', T1),
        ],
      }),
    );

    expect(failing(claim)).toEqual(['comments lie only on Objectives']);
  });

  /**
   * The model names a Key Result by its target more often than by its name: “ближче до 30 км?”
   * (‘closer to 30 km?’) asks about the distance run.
   */
  it('a Key Result asked about by its target counts as asked about', () => {
    const claim = strategicClaim(
      strategic({
        comments: [
          commentOn(idOf('course'), 'Що показують відгуки: чи тримається планка 4.5?', T1),
          RACE_QUESTION,
        ],
      }),
    );

    expect(failing(claim)).toEqual([]);
  });

  /** A question refers, by what it measures, to the Key Result named in the paragraph above. */
  it('a Key Result named in a statement and asked about by what it measures counts as asked about', () => {
    const claim = strategicClaim(
      strategic({
        comments: [
          commentOn(
            idOf('course'),
            'Що показує опитування Corbel, я не бачу.\n\nЧи ціль досі актуальна і що показує опитування?',
            T1,
          ),
          RACE_QUESTION,
        ],
      }),
    );

    expect(failing(claim)).toEqual([]);
  });

  /**
   * A statement about the Objective next to a question about something else is not a question
   * about the Key Result.
   */
  it('a Key Result named in a comment only by a statement is not asked about', () => {
    const claim = strategicClaim(
      strategic({
        comments: [
          COURSE_QUESTION,
          commentOn(
            idOf('race'),
            'Ціль із ключовим результатом 30 км на тиждень виходить за межі сфери.\n\nЩо робимо з ціллю?',
            T2,
          ),
        ],
      }),
    );

    expect(failing(claim)).toEqual(['the distance Key Result is asked about']);
  });

  /**
   * A question refers by a pronoun to the Key Result named in the sentence above it in the same
   * item.
   */
  it('a Key Result named in an item and asked about by a pronoun counts as asked about', () => {
    const claim = strategicClaim(
      strategic({
        comments: [
          commentOn(
            idOf('course'),
            '— Ключовий результат «Опитування Corbel»: його показника я не бачу. Що він показує зараз?',
            T1,
          ),
          RACE_QUESTION,
        ],
      }),
    );

    expect(failing(claim)).toEqual([]);
  });

  /** `noticed` says what the run saw; a question that awaits the person's words is in a thread. */
  it('a Key Result named only among what was seen is not asked about', () => {
    const claim = strategicClaim(
      strategic({
        notice: {
          noticed: 'Опитування Corbel: учні оцінюють курс щонайменше на 4,5.',
          whyItMatters: 'Вечорів на обидві цілі не вистачає.',
          ask: 'Відповідайте в обговореннях цілей.',
          link: 'https://www.notion.so/page',
        },
        comments: [commentOn(idOf('course'), 'Курс Halcyon: як ідуть справи?', T1), RACE_QUESTION],
      }),
    );

    expect(failing(claim)).toContain('the rating Key Result is asked about');
  });
});

describe('deepClaim', () => {
  it('a Deep Review that read the Identity and raised no labels holds', () => {
    const evidence = ran('DP1_deep_review', {
      notice: {
        noticed: 'Чи досі «Батько» описує те, як ви хочете жити?',
        whyItMatters: 'Це питання для розмови.',
        ask: 'Поговорімо в чаті.',
        link: 'https://www.notion.so/page',
      },
      reads: [loaded(['identity'], 'notion-fetch')],
    });

    expect(failing(deepClaim(evidence))).toEqual([]);
  });

  it('a Deep Review that raised a label violates the effect', () => {
    const evidence = ran('DP1_deep_review', {
      notice: {
        noticed: 'Питання',
        whyItMatters: 'Чому',
        ask: 'Поговорімо.',
        link: 'https://www.notion.so/page',
      },
      detections: [['dependency', [idOf('pickup')]]],
      reads: [loaded(['identity'], 'notion-fetch')],
    });

    expect(failing(deepClaim(evidence))).toEqual(['a review without comments raises no label']);
  });
});

// ---------------------------------------------------------------------------
// SW1
// ---------------------------------------------------------------------------

function woken(): Evidence8 {
  return ran('SW1_safety_sweep', {
    notice: {
      noticed: 'Договір від юристів Quarry не надійшов.',
      whyItMatters: 'Дедлайн завтра.',
      ask: 'Нагадати?',
      link: 'https://www.notion.so/page',
    },
    comments: [commentOn(idOf('woken'), 'Чи є відповідь від юристів?', T1)],
    detections: [
      ['dependency', [idOf('woken')]],
      ['deadline_risk', [idOf('woken')]],
    ],
  });
}

describe('sweepClaim', () => {
  const steps = {
    woken: idOf('woken'),
    first: [{ checkId: 'check-1', pageId: idOf('woken') }],
    run: woken(),
    second: [],
  };

  it('when a tick wakes the Task, the run judges it and the second tick stays silent, the claim holds', () => {
    expect(failing(sweepClaim(steps))).toEqual([]);
  });

  it('a first tick that wakes the control as well violates the perimeter', () => {
    const claim = sweepClaim({
      ...steps,
      first: [...steps.first, { checkId: 'check-2', pageId: idOf('paused') }],
    });

    expect(failing(claim)).toEqual([
      'the first tick wakes exactly the task whose check date came and whose deadline nears',
    ]);
  });

  it('a second tick that wakes again violates the perimeter', () => {
    expect(failing(sweepClaim({ ...steps, second: steps.first }))).toEqual([
      'the second tick wakes nobody',
    ]);
  });

  it('a Task that is not woken means no run, and the perimeter says why', () => {
    const claim = sweepClaim({ ...steps, first: [], run: null });

    expect(failing(claim)).toEqual([
      'the first tick wakes exactly the task whose check date came and whose deadline nears',
    ]);
  });
});

// ---------------------------------------------------------------------------
// X1
// ---------------------------------------------------------------------------

describe('bodyClaim', () => {
  const run = ran('X1_body_commitment', {
    comments: [
      commentOn(idOf('estimate'), 'Ви пообіцяли Halyard фото й план — додати задачу?', T1),
    ],
    detections: [['untracked_commitment', [idOf('estimate')]]],
    reads: [loaded(['estimate'], 'notion-fetch')],
  });
  const steps = {
    content: { eventId: 'e1', windowed: true, reason: null },
    properties: { eventId: 'e2', windowed: true, reason: null },
    control: {
      eventId: 'e3',
      windowed: false,
      reason: 'page.content_updated outside the Task and Project data sources',
    },
    window: {
      mode: 'event_evaluation' as const,
      eventTypes: ['page.content_updated', 'page.properties_updated'],
      type: 'page.properties_updated',
      pageId: idOf('estimate'),
    },
    run,
  };

  it('when a body edit opens a window and the run reads the body and asks about the promise, the claim holds', () => {
    expect(failing(bodyClaim(steps))).toEqual([]);
  });

  it('a window that lost the body edit violates the perimeter', () => {
    const claim = bodyClaim({
      ...steps,
      window: { ...steps.window, eventTypes: ['page.properties_updated'] },
    });

    expect(failing(claim)).toEqual([
      'the window carries both kinds of change, the latest as its type',
    ]);
  });

  it('a run that did not open the Task violates the effect', () => {
    const claim = bodyClaim({ ...steps, run: { ...run, reads: [loaded(['office'])] } });

    expect(failing(claim)).toEqual(['the run opens the Task whose body changed']);
  });
});

// ---------------------------------------------------------------------------
// C1
// ---------------------------------------------------------------------------

describe('reconciliationClaim', () => {
  const threads = {
    resolved: { discussionId: 'thread-resolved', commentId: 'c1' },
    open: { discussionId: 'thread-open', commentId: 'c2' },
    deleted: { discussionId: 'thread-deleted', commentId: 'c3' },
  };
  const seen = { seenOpenAt: '2026-10-21T08:00:00.000Z', closureRequestedAt: null, goneAt: null };
  const first: ReconcileTick = {
    closures: [],
    memory: { 'thread-resolved': seen, 'thread-open': seen, 'thread-deleted': seen },
  };
  const second: ReconcileTick = {
    closures: [{ checkId: 'check-1', discussionId: 'thread-resolved' }],
    memory: {
      'thread-resolved': { ...seen, closureRequestedAt: '2026-10-21T08:05:00.000Z' },
      'thread-open': { ...seen, seenOpenAt: '2026-10-21T08:05:00.000Z' },
      'thread-deleted': { ...seen, goneAt: '2026-10-21T08:05:00.000Z' },
    },
  };
  const steps: ReconciliationSteps = {
    threads,
    first,
    resolved: true,
    second,
    third: { closures: [], memory: second.memory },
  };

  it('when a resolved thread gets exactly one closure and an open and a deleted thread get none, the claim holds', () => {
    const claim = reconciliationClaim(steps);

    expect(failing(claim)).toEqual([]);
    expect(claim.unobserved).toEqual([]);
  });

  it('without an operator the resolution step is not conducted and the rest is checked', () => {
    const claim = reconciliationClaim({
      ...steps,
      resolved: null,
      second: { closures: [], memory: { ...second.memory, 'thread-resolved': seen } },
    });

    expect(failing(claim)).toEqual([]);
    expect(claim.unobserved).toHaveLength(1);
  });

  it('a closure for the deleted thread violates the perimeter', () => {
    const claim = reconciliationClaim({
      ...steps,
      second: {
        closures: [...second.closures, { checkId: 'check-2', discussionId: 'thread-deleted' }],
        memory: {
          ...second.memory,
          'thread-deleted': { ...seen, closureRequestedAt: '2026-10-21T08:05:00.000Z' },
        },
      },
    });

    expect(failing(claim)).toEqual([
      'after the person resolved one thread, exactly it is asked to close',
      'the thread whose comment is gone is remembered gone, with no closure',
    ]);
  });

  it('a closure for a foreign thread violates the perimeter', () => {
    const claim = reconciliationClaim({
      ...steps,
      third: { closures: [{ checkId: 'check-3', discussionId: 'thread-elsewhere' }], memory: {} },
    });

    expect(failing(claim)).toEqual([
      'the next tick asks nothing new',
      'no closure is asked for a thread outside the scenario',
    ]);
  });
});
