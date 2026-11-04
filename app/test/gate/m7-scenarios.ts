import type { AnchorType } from '../../src/knowledge/anchor-types';
import { DECISION_MARKER } from '../../src/knowledge/memory-writes';
import { namesOf, type World } from './m5-scenarios';
import { LESSONS, variantOf } from './m6-phrasing';
import {
  DECISION_RESTATED,
  DECISION_STATED,
  FACT_STATED,
  LESSON_STATED,
  ROUTINE_ANSWER,
  STANDARD_STATED,
} from './m7-phrasing';
import {
  brand,
  otherOf,
  replyOn,
  similarProject,
  task,
  waitingWorld,
  type AnchorMemory,
  type SingleRun,
  type Tag,
} from './scenario-kit';

/**
 * Gate M7 scenarios (`docs/5-plan.md` § “M7 — GBrain knowledge lifecycle”): what a run does with
 * long-term memory. A scenario consists of the world, the event and the GBrain pages that must
 * exist before the run; the expectations are in `m7-claims.ts`. The scaffolding is the same as in
 * M6, with the same attempts, trials, evidence and verdict. M7 adds only the pages in memory.
 */
export type M7ScenarioId =
  | 'H1_routine_done'
  | 'H2_routine_answer'
  | 'H3_two_anchors'
  | 'H4_decision_stated'
  | 'H5_decision_stored'
  | 'H6_fact_stated'
  | 'H7_no_anchor'
  | 'H8_below_threshold'
  | 'H9_structure_first'
  | 'H10_standard_stated'
  | 'H11_lesson_stated';

/**
 * The stem of the name the person speaks about: what was written is found by it even if the model
 * did not copy the tag over.
 */
export const SUBJECT_STEM = 'Kestrel';

/** Returns a name with the attempt tag that the person mentions in a decision or fact. */
const subjectOf = (tag: Tag): string => `${SUBJECT_STEM}-${tag}`;

/** The stem of the code word of the mockups in the lesson whose page is linked to the anchor. */
export const LESSON_STEM = 'Zephyr';

/**
 * The stem of the code word of a lesson of another project on the same topic: it does not concern
 * this project.
 */
export const TRAP_STEM = 'Quorum';

const lessonWord = (tag: Tag): string => `${LESSON_STEM}-${tag}`;
const trapWord = (tag: Tag): string => `${TRAP_STEM}-${tag}`;

/**
 * Returns the slug of a page that someone placed “by hand”, not by convention. The slug shows that
 * the page is a duplicate of the anchor.
 */
const copySlug = (tag: Tag): string => `projects/copy-${tag}`;

/** Returns the slug of a lesson that leads from the anchor by a link. */
const lessonSlug = (tag: Tag): string => `lessons/signing-${tag}`;

/** A neutral note about the project: it changes no decisions. */
const NEUTRAL_NOTE: readonly string[] = [
  'Проєкт веде Олена; щотижневий огляд — по п’ятницях.',
  'Зміни до планів збираємо в одному документі.',
];

/**
 * Builds a mailing project: one done Task (the person changed its status), one open and one
 * scheduled, so the project moves, and the status change is routine.
 */
function mailingWorld(tag: Tag): World {
  return [
    { key: 'project', type: 'project', name: `Запуск розсилки «${brand(tag)}»`, status: 'Active' },
    task({
      key: 'finished',
      name: `Надіслати тестовий лист «${brand(tag)}»`,
      status: 'Done',
      project: 'project',
    }),
    task({
      key: 'next',
      name: `Зібрати відповіді на тестовий лист «${brand(tag)}»`,
      status: 'Next Action',
      project: 'project',
    }),
    task({
      key: 'later',
      name: `Підготувати основний випуск «${brand(tag)}»`,
      status: 'Scheduled',
      project: 'project',
      dateInDays: 3,
    }),
  ];
}

/** Builds a project where a Task waits for an external answer: the person replies in its thread. */
function reviewWorld(tag: Tag): World {
  return [
    { key: 'project', type: 'project', name: `Випуск статті «${brand(tag)}»`, status: 'Active' },
    task({
      key: 'check',
      name: `Дочекатися відповіді рецензента «${brand(tag)}»`,
      status: 'Waiting For',
      project: 'project',
      dateInDays: 2,
      deadlineInDays: 20,
    }),
  ];
}

/** Builds a project with a decision the person has to make: a Task to choose a payment provider. */
function cabinetWorld(tag: Tag): World {
  return [
    {
      key: 'project',
      type: 'project',
      name: `Редизайн кабінету клієнта «${brand(tag)}»`,
      status: 'Active',
    },
    task({
      key: 'provider',
      name: `Обрати платіжного провайдера для кабінету «${brand(tag)}»`,
      status: 'Next Action',
      project: 'project',
    }),
  ];
}

/**
 * Builds a project where the person states a fact about the client: the client is named in the
 * Task, so the person's words concern that client.
 */
function mockupsWorld(tag: Tag): World {
  return [
    {
      key: 'project',
      type: 'project',
      name: `Оновлення брендбуку «${brand(tag)}»`,
      status: 'Active',
    },
    task({
      key: 'mockups',
      name: `Погодити макети з замовником «${subjectOf(tag)}»`,
      status: 'Next Action',
      project: 'project',
    }),
  ];
}

/**
 * Builds a Behavior System in lifecycle `Installing` with one instance: a Task in status `Failed`
 * whose deadline was yesterday. The workspace holds no other miss.
 */
function habitWorld(tag: Tag): World {
  return [
    {
      key: 'system',
      type: 'behavior_system',
      name: `Щоранку читати двадцять хвилин «${brand(tag)}»`,
      lifecycle: 'Installing',
    },
    task({
      key: 'instance',
      name: `Читання вранці «${brand(tag)}»`,
      status: 'Failed',
      behaviorSystem: 'system',
      deadlineInDays: -1,
    }),
  ];
}

/** Builds an Area of Focus in `Advance` mode with one open Task. */
function healthWorld(tag: Tag): World {
  return [
    {
      key: 'area_of_focus',
      type: 'area_of_focus',
      name: `Здоров’я «${brand(tag)}»`,
      mode: 'Advance',
    },
    task({
      key: 'jog',
      name: `Записатися на пробіжку «${brand(tag)}»`,
      status: 'Next Action',
      areaOfFocus: 'area_of_focus',
    }),
  ];
}

/**
 * Returns the name of a world page by key: an anchor is named the same as the object it belongs to.
 */
function nameOf(world: World, key: string): string {
  const [name = ''] = namesOf(world, [key]);

  return name;
}

/**
 * Builds the anchor of a world page: its title is the page's name, and its body is the neutral note
 * unless the scenario gave another.
 */
function anchorOf(
  world: World,
  of: string,
  type: AnchorType,
  extra: Partial<AnchorMemory> = {},
): AnchorMemory {
  return {
    kind: 'anchor',
    key: 'anchor',
    of,
    type,
    title: nameOf(world, of),
    paragraphs: NEUTRAL_NOTE,
    ...extra,
  };
}

/** Builds the anchor of the world's project. */
const projectAnchor = (world: World, extra: Partial<AnchorMemory> = {}): AnchorMemory =>
  anchorOf(world, 'project', 'project', extra);

/** An old event in the history of the project: what the anchor knew before the run. */
const EARLIER_EVENT = {
  date: '2026-05-12',
  summary: 'Старт редизайну кабінету; перший огляд макетів пройшов.',
  source: 'Notion: сторінка проєкту',
};

export const M7_RUNS: Readonly<Record<M7ScenarioId, SingleRun>> = {
  // A routine status change of a Task of a project that is moving: memory stays as it was.
  H1_routine_done: {
    world: mailingWorld,
    trigger: { kind: 'edit', page: 'finished', slots: ['task.status'] },
    memory: (tag) => [
      projectAnchor(mailingWorld(tag), {
        timeline: [
          {
            date: '2026-03-02',
            summary: 'Проєкт стартував; перший тестовий лист заплановано.',
            source: 'Notion: сторінка проєкту',
          },
        ],
      }),
    ],
  },
  // The person's reply only clarifies the date: there is nothing new for memory in it.
  H2_routine_answer: {
    world: reviewWorld,
    trigger: replyOn('check', ROUTINE_ANSWER, subjectOf),
    memory: (tag) => [projectAnchor(reviewWorld(tag))],
  },
  // For the project, GBrain has two anchors with the same id (someone placed the second “by
  // hand”), and also a note that mentions the project's id. The lesson is only on the first: the
  // run chooses neither.
  H3_two_anchors: {
    world: waitingWorld,
    trigger: { kind: 'edit', page: 'waiting', slots: ['task.date'] },
    memory: (tag, variant) => [
      projectAnchor(waitingWorld(tag), {
        paragraphs: variantOf(LESSONS, variant)(lessonWord(tag), 'юристи'),
      }),
      projectAnchor(waitingWorld(tag), { key: 'copy', slug: copySlug(tag) }),
      {
        kind: 'page',
        key: 'mention',
        slug: `notes/meeting-${tag}`,
        type: 'note',
        title: `Нотатка зі зустрічі ${tag}`,
        paragraphs: ['На зустрічі говорили про запуск сайту й терміни.'],
        mentions: 'project',
      },
    ],
  },
  // The person made a decision; the project has an anchor, and the anchor does not know about the
  // decision yet.
  H4_decision_stated: {
    world: cabinetWorld,
    trigger: replyOn('provider', DECISION_STATED, subjectOf),
    memory: (tag) => [projectAnchor(cabinetWorld(tag), { timeline: [EARLIER_EVENT] })],
  },
  // The person repeats the same decision when it is already written: it is not written a second
  // time.
  H5_decision_stored: {
    world: cabinetWorld,
    trigger: replyOn('provider', DECISION_RESTATED, subjectOf),
    memory: (tag) => [
      projectAnchor(cabinetWorld(tag), {
        timeline: [
          EARLIER_EVENT,
          {
            date: '2026-06-03',
            summary: `${DECISION_MARKER} платежі в кабінеті ідуть через «${subjectOf(tag)}».`,
            source: 'Notion: задача «Обрати платіжного провайдера», нитка рішення',
          },
        ],
      }),
    ],
  },
  // The person states a fact about the client; the project has an anchor.
  H6_fact_stated: {
    world: mockupsWorld,
    trigger: replyOn('mockups', FACT_STATED, subjectOf),
    memory: (tag) => [
      projectAnchor(mockupsWorld(tag), {
        facts: [`Бюджет проєкту «${brand(tag)}» погоджено на весь рік.`],
      }),
    ],
  },
  // The person made a decision about a project that memory has nothing on yet. There is only the
  // anchor of another project, and the gate watches the address of this project's anchor, because
  // the App creates it together with the write.
  H7_no_anchor: {
    world: cabinetWorld,
    trigger: replyOn('provider', DECISION_STATED, subjectOf),
    memory: (tag) => [
      { kind: 'expected', key: 'anchor', of: 'project', type: 'project' },
      {
        kind: 'anchor',
        key: 'other',
        of: null,
        type: 'project',
        title: `Редизайн кабінету клієнта «${otherOf(tag)}»`,
        paragraphs: NEUTRAL_NOTE,
      },
    ],
  },
  // A missed repetition, while the history of the Behavior System has only one similar event:
  // there is nothing to generalize from.
  H8_below_threshold: {
    world: habitWorld,
    trigger: { kind: 'edit', page: 'instance', slots: ['task.status'] },
    memory: (tag) => [
      anchorOf(habitWorld(tag), 'system', 'behavior_system', {
        paragraphs: ['Система про ранкове читання перед роботою.'],
        timeline: [
          {
            date: '2026-04-14',
            summary: 'Читання вранці пропущено.',
            source: 'Notion: задача читання за 14 квітня',
          },
        ],
      }),
    ],
  },
  // The lesson is not on the anchor but on a page that links to it; next to it is a lesson from a
  // similar project that does not concern this one. The needed lesson is reachable by structure,
  // through the anchor and its neighbor, not by free search.
  H9_structure_first: {
    world: waitingWorld,
    trigger: { kind: 'edit', page: 'waiting', slots: ['task.date'] },
    memory: (tag, variant) => [
      projectAnchor(waitingWorld(tag)),
      {
        kind: 'page',
        key: 'lesson',
        slug: lessonSlug(tag),
        type: 'note',
        title: `Урок про підписання договорів ${tag}`,
        paragraphs: variantOf(LESSONS, variant)(lessonWord(tag), 'юристи'),
        linksTo: { key: 'anchor', type: 'derived_from' },
      },
      similarProject(
        tag,
        variantOf(LESSONS, variant)(trapWord(tag), `юристи замовника «${otherOf(tag)}»`),
      ),
    ],
  },
  // The person formulates the lesson themselves in the thread of a Task of a project with an
  // anchor: their words are a fact on the anchor.
  H11_lesson_stated: {
    world: waitingWorld,
    trigger: replyOn('waiting', LESSON_STATED, subjectOf),
    memory: (tag) => [projectAnchor(waitingWorld(tag))],
  },
  // The person says what is acceptable for an Area of Focus; the Area of Focus has an anchor.
  H10_standard_stated: {
    world: healthWorld,
    trigger: replyOn('jog', STANDARD_STATED, subjectOf),
    memory: (tag) => [
      anchorOf(healthWorld(tag), 'area_of_focus', 'area_of_focus', {
        paragraphs: ['Сфера про фізичну форму й сон.'],
      }),
    ],
  },
};
