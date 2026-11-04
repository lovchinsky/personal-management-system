import { randomUUID } from 'node:crypto';
import { proposalSchema } from '../../src/approvals/proposal.schema';
import { validateProposal } from '../../src/approvals/proposal.validity';
import type { WorldPage } from './m5-scenarios';
import { memoryOf, scenariosOf, worldOf, type ScenarioId } from './m6-scenarios';
import { FIXTURE_STEMS } from './m8-fixtures';
import {
  D1_PROPOSAL_TASK,
  D1_STEMS,
  d1ProposalOf,
  FINDER_EXPECTED,
  finderWorld,
  REVIEW_OF,
  S1_KEY_RESULTS,
  S1_STEMS,
  S1_THREADS,
  S2_STEMS,
  SW1_STEMS,
  W1_STEMS,
  X1_STEMS,
} from './m8-scenarios';

const TAG = '4821-m8-1';

const pageIn = (id: ScenarioId, key: string): WorldPage => {
  const page = worldOf(id, TAG).find((candidate) => candidate.key === key);

  if (page === undefined) throw new Error(`${id} has no page ${key}`);

  return page;
};

/** Open Tasks of a Project: what can move it. */
const openTasksOf = (id: ScenarioId, project: string): string[] =>
  worldOf(id, TAG)
    .filter(
      (page) =>
        page.type === 'task' &&
        page.project === project &&
        ['Next Action', 'Scheduled', 'Waiting For'].includes(page.status),
    )
    .map((page) => page.key);

/**
 * Counts the page names of the world that contain the stem, because an object must be recognized
 * unambiguously.
 */
const carriers = (id: ScenarioId, stem: string): number =>
  worldOf(id, TAG).filter((page) => page.name.includes(stem)).length;

describe('gate M8 scenarios', () => {
  it('the review of every review scenario is named, and the rest are not reviews', () => {
    expect(
      scenariosOf('m8')
        .filter((info) => REVIEW_OF[info.id] !== undefined)
        .map((info) => info.id),
    ).toEqual([
      'D1_daily_control',
      'W1_weekly_review',
      'S1_strategic_review',
      'S2_strategic_lesson',
      'DP1_deep_review',
    ]);
  });

  /**
   * The stem is what a claim uses to recognize an object in a text. A second name with the same
   * stem would make “named” ambiguous, and the stem of a seeded item in the world would make an
   * object falsely named.
   */
  it.each([
    [
      'D1_daily_control',
      [
        D1_STEMS.deadlineToday,
        D1_STEMS.timedTomorrow,
        D1_STEMS.scheduledToday,
        D1_STEMS.overdue,
        D1_STEMS.pausedFixed,
        ...D1_STEMS.eligible,
        ...D1_STEMS.pausedOpen,
        ...D1_STEMS.someday,
        ...D1_STEMS.done,
        D1_STEMS.fresh,
      ],
    ],
    [
      'W1_weekly_review',
      [
        W1_STEMS.waiting,
        W1_STEMS.nextAction,
        W1_STEMS.upcoming,
        W1_STEMS.overdueDeadline,
        W1_STEMS.resolved,
        W1_STEMS.quietArea,
      ],
    ],
    ['S1_strategic_review', Object.values(S1_STEMS)],
    ['SW1_safety_sweep', [SW1_STEMS.woken]],
  ] as const)('%s: every stem is in exactly one name of the world', (id, stems) => {
    expect(stems.filter((stem) => carriers(id, stem) !== 1)).toEqual([]);
  });

  it('the stems of the seeded items occur in no M8 world', () => {
    const names = scenariosOf('m8').flatMap((info) =>
      worldOf(info.id, TAG).map((page) => page.name),
    );

    expect(
      Object.values(FIXTURE_STEMS).filter((stem) => names.some((name) => name.includes(stem))),
    ).toEqual([]);
  });

  it('the S2 lesson stems are only in the memory, not in the names of the world', () => {
    expect(
      carriers('S2_strategic_lesson', S2_STEMS.first) +
        carriers('S2_strategic_lesson', S2_STEMS.second),
    ).toBe(0);
  });

  describe('D1', () => {
    it('the proposal sits on a candidate of Available Now', () => {
      expect(pageIn('D1_daily_control', D1_PROPOSAL_TASK)).toMatchObject({
        status: 'Next Action',
        project: 'launch',
      });
    });

    /**
     * The App plants the proposal, not the model: one the App would not accept breaks D1 before the
     * run.
     */
    it('the App accepts the proposal: the precondition reads the Task status in the world, and the write changes it', () => {
      const page = randomUUID();
      const proposal = proposalSchema.parse(d1ProposalOf(page, 'p_status', randomUUID()));
      const status = pageIn('D1_daily_control', D1_PROPOSAL_TASK);

      expect(validateProposal(proposal.effects, proposal.preconditions)).toMatchObject({
        valid: true,
      });
      expect(proposal.preconditions).toEqual([
        expect.objectContaining({
          kind: 'property_reads_as',
          value: { kind: 'option', option: status.type === 'task' ? status.status : null },
        }),
      ]);
    });

    it('Done and Someday/Maybe Tasks have no dates, so only a query without a status filter returns them', () => {
      const backlog = [...D1_STEMS.done, ...D1_STEMS.someday].map((stem) =>
        pageIn('D1_daily_control', stem.toLowerCase()),
      );

      expect(
        backlog.filter(
          (page) =>
            page.type !== 'task' ||
            page.dateInDays !== undefined ||
            page.deadlineInDays !== undefined,
        ),
      ).toEqual([]);
    });

    it('a deadline is today, a call is tomorrow with a time, and the paused Project has a commitment tomorrow', () => {
      expect(pageIn('D1_daily_control', 'deadlineToday')).toMatchObject({ deadlineInDays: 0 });
      expect(pageIn('D1_daily_control', 'timedTomorrow')).toMatchObject({
        status: 'Scheduled',
        dateInDays: 1,
        dateAt: '10:00',
      });
      expect(pageIn('D1_daily_control', 'warehouse')).toMatchObject({ status: 'Paused' });
      expect(pageIn('D1_daily_control', 'pausedFixed')).toMatchObject({
        project: 'warehouse',
        deadlineInDays: 1,
      });
    });
  });

  describe('W1', () => {
    /** Another open Task that moves the Project refutes `dependency` (`knowledge/detectors.md`). */
    it('a Waiting For with a past date is the only open Task of its Project', () => {
      expect(openTasksOf('W1_weekly_review', 'flat')).toEqual(['waiting']);
    });

    it('the world has an Active Project with nothing in motion, a Planning one with no Tasks and a Paused one with a time-fixed commitment', () => {
      expect(openTasksOf('W1_weekly_review', 'stalled')).toEqual([]);
      expect(pageIn('W1_weekly_review', 'planning')).toMatchObject({ status: 'Planning' });
      expect(openTasksOf('W1_weekly_review', 'planning')).toEqual([]);
      expect(pageIn('W1_weekly_review', 'pausedFixed')).toMatchObject({ deadlineInDays: 4 });
    });

    it('the blocker of a Task with a resolved dependency is `Done`, and the Task stays `Waiting For` with no date', () => {
      expect(pageIn('W1_weekly_review', 'permit')).toMatchObject({ status: 'Done' });
      expect(pageIn('W1_weekly_review', 'resolved')).toMatchObject({
        status: 'Waiting For',
        blockedBy: ['permit'],
      });
      expect(pageIn('W1_weekly_review', 'resolved')).not.toHaveProperty('dateInDays');
    });
  });

  describe('S1', () => {
    it('the threads are on both Objectives', () => {
      expect(S1_THREADS.map((thread) => pageIn('S1_strategic_review', thread.page).type)).toEqual([
        'objective',
        'objective',
      ]);
    });

    it('the Done Project serves the first Key Result, the Active one the second, and the Tasks of both Objectives fall on the same days', () => {
      expect(pageIn('S1_strategic_review', 'marketing')).toMatchObject({
        status: 'Done',
        keyResults: ['enrolment'],
      });
      expect(pageIn('S1_strategic_review', 'recording')).toMatchObject({
        status: 'Active',
        keyResults: ['rating'],
      });

      const days = (owner: string): number[] =>
        worldOf('S1_strategic_review', TAG).flatMap((page) =>
          page.type === 'task' && page.project === owner && page.dateInDays !== undefined
            ? [page.dateInDays]
            : [],
        );

      expect(days('recording')).toEqual(days('training'));
    });

    /** A reference to a Key Result must point at that one only: in the world, threads, memory. */
    it('a reference to a Key Result is in its name and nowhere else', () => {
      const world = worldOf('S1_strategic_review', TAG);
      const elsewhere = [
        ...S1_THREADS.flatMap((thread) => [thread.question, thread.answer]),
        JSON.stringify(memoryOf('S1_strategic_review', TAG)),
      ];

      expect(
        Object.entries(S1_KEY_RESULTS).flatMap(([key, { reference }]) =>
          [
            ...world.filter((page) => reference.test(page.name)).map((page) => page.key),
            ...elsewhere.filter((text) => reference.test(text)),
          ]
            .filter((carrier) => carrier !== key)
            .map((carrier) => `${key}: ${carrier}`),
        ),
      ).toEqual([]);
      expect(
        Object.entries(S1_KEY_RESULTS).filter(([key, { target, reference }]) => {
          const name = pageIn('S1_strategic_review', key).name;

          return !name.includes(target) || !reference.test(name);
        }),
      ).toEqual([]);
    });

    it('a target is recognized the way the model writes it, and not inside a larger number', () => {
      const { rating, distance } = S1_KEY_RESULTS;
      const refers = (text: string): boolean =>
        rating.reference.test(text) || distance.reference.test(text);

      const written = [
        '4.5',
        'на 4,5?',
        '30км',
        '30\u00a0км',
        'Що показує опитування?',
        'Які оцінки ставлять учні?',
        'Ваш кілометраж?',
        'Скільки ви зараз пробігаєте?',
      ];

      expect(written.filter((text) => !refers(text))).toEqual([]);
      expect(['14,5', '4,55', '130 км'].filter(refers)).toEqual([]);
    });
  });

  describe('SW1', () => {
    it('the woken Task is the only open one of its Project, its Date has come due and its deadline is tomorrow', () => {
      expect(openTasksOf('SW1_safety_sweep', 'site')).toEqual(['woken']);
      expect(pageIn('SW1_safety_sweep', 'woken')).toMatchObject({
        status: 'Waiting For',
        dateInDays: -1,
        deadlineInDays: 1,
      });
    });
  });

  it('X1: a Task and a control Area of Focus, and the client of the promise is not named in the world', () => {
    expect(pageIn('X1_body_commitment', 'estimate')).toMatchObject({
      type: 'task',
      status: 'Next Action',
    });
    expect(pageIn('X1_body_commitment', 'home')).toMatchObject({ type: 'area_of_focus' });
    expect(carriers('X1_body_commitment', X1_STEMS.client)).toBe(0);
  });

  it('the finder world has every page the check expects and a positive for each rule', () => {
    const keys = finderWorld(TAG).map((page) => page.key);

    expect(FINDER_EXPECTED.filter((item) => !keys.includes(item.page))).toEqual([]);
    expect(new Set(FINDER_EXPECTED.map((item) => item.rule)).size).toBe(FINDER_EXPECTED.length);
  });
});
