import { availableNowCandidacy, projectLinkOf } from '../../src/methodology/available-now';
import { dependencyConsistency, dependencyState } from '../../src/methodology/dependency';
import { lifecycleOf, phaseOf } from '../../src/methodology/lifecycle';
import { linkedPageIds } from '../../src/methodology/linked-pages';
import { pausedCommitments } from '../../src/methodology/paused-commitments';
import { dateKindOf, presenceOf } from '../../src/methodology/presence';
import { closureObligations } from '../../src/methodology/project-closure';
import { projectPath } from '../../src/methodology/project-path';
import { tasksOf } from '../../src/methodology/project-tasks';
import {
  checkDateReached,
  deadlineSignal,
  type PlaceDate,
} from '../../src/methodology/time-signals';
import { Read, type Reading } from '../../src/notion/semantics/reading';
import { Records } from './methodology-records';

/**
 * The reading states a rule must handle. `value` is not in the table: it is the ordinary path, and
 * the specs of the rules themselves cover it. The adapter does not produce `gap` and
 * `non_canonical` on a relation, a date or a body, so only an override of a single reading on a
 * real record yields them (`Records.task(spec, { field: reading })`).
 */
export type StateName = 'absent' | 'unread' | 'gap' | 'non_canonical' | 'empty';

export const READINGS: Readonly<Record<StateName, Reading>> = {
  absent: Read.absent('no carrier'),
  unread: Read.unread('a carrier outside this read'),
  gap: Read.gap('slot', 'odd'),
  non_canonical: Read.nonCanonical('Hidden'),
  empty: Read.empty(),
};

const und = (because: string): { state: 'undetermined'; because: string } => ({
  state: 'undetermined',
  because,
});

/** All five states yield a “non-answer” with a reason of its own. */
const everyUndetermined: Readonly<Record<StateName, unknown>> = {
  absent: und('absent'),
  unread: und('unread'),
  gap: und('gap'),
  non_canonical: und('non_canonical'),
  empty: und('empty'),
};

/**
 * Builds the expectation for a field where `empty` is a legitimate “nothing there”. The answer to
 * `empty` is `nothing`.
 */
const emptyMeans = (nothing: unknown): Readonly<Record<StateName, unknown>> => ({
  ...everyUndetermined,
  empty: nothing,
});

interface Row {
  /** The `methodology/*.ts` export the row checks: the coverage check matches names. */
  readonly rule: string;
  /** Which reading is overridden. */
  readonly field: string;
  /** The expectation as a literal, from the rule's semantics, for each state. */
  readonly expected: Readonly<Record<StateName, unknown>>;
  /** Extra readings with their own expectations (a truncated relation, prose and so on). */
  readonly extra?: Readonly<Record<string, { reading: Reading; expected: unknown }>>;
  readonly run: (records: Records, reading: Reading) => unknown;
}

const TRUNCATED: Reading = Read.value({ type: 'links', pageIds: ['a'], truncated: true });

/** The `unread` input explains why the rules over relations ask for a map, not an array. */
const links = (...pageIds: readonly string[]): Reading =>
  Read.value({ type: 'links', pageIds, truncated: false });

const unreadableAt = (taskId: string, field: string, because: string): unknown => ({
  taskId,
  field,
  because,
});

/** Evaluates a closed Project with one known Task `t`, whose status is overridden. */
const closedWith = (records: Records, reading: Reading): unknown =>
  closureObligations(
    records.project({ status: 'Done', tasks: ['t'] }),
    new Map([['t', records.task({ id: 't', status: 'Next Action' }, { status: reading })]]),
  );

const pausedWith = (
  records: Records,
  status: string,
  readings: Parameters<Records['task']>[1],
): unknown =>
  pausedCommitments(
    records.project({ status: 'Paused', tasks: ['t'] }),
    new Map([['t', records.task({ id: 't', status }, readings)]]),
  );

/** Builds a dependent `Waiting For` Task with a blocker `b` in the specified status. */
const waiting = (
  records: Records,
  readings: Parameters<Records['task']>[1],
  blocker: string = 'Done',
): Parameters<typeof dependencyConsistency> => [
  records.task({ id: 'd', status: 'Waiting For', dependencies: ['b'] }, readings),
  new Map([['b', records.task({ id: 'b', status: blocker })]]),
];

/** A `PlaceDate` that ignores the date: the rules over reading states do not reach it. */
const ANYWHERE: PlaceDate = () => 0;
const NOW = 1;
const LEAD = 1;

/** Evaluates an `Active` Project with one known Task `t`, whose status is overridden. */
const activeWith = (records: Records, reading: Reading): unknown =>
  projectPath(
    records.project({ status: 'Active', tasks: ['t'] }),
    new Map([['t', records.task({ id: 't', status: 'Next Action' }, { status: reading })]]),
  );

export const MATRIX: readonly Row[] = [
  // ---- statuses
  {
    rule: 'lifecycleOf',
    field: 'status',
    expected: { ...everyUndetermined, non_canonical: { state: 'out_of_scope', value: 'Hidden' } },
    run: (_, reading) => lifecycleOf(reading),
  },
  {
    rule: 'phaseOf',
    field: 'status',
    expected: everyUndetermined,
    run: (_, reading) => phaseOf(reading),
  },

  // ---- Available Now
  {
    rule: 'availableNowCandidacy',
    field: 'task.status',
    expected: {
      ...everyUndetermined,
      non_canonical: { state: 'excluded', reason: 'out_of_scope' },
    },
    run: (records, reading) =>
      availableNowCandidacy(
        records.task({ status: 'Next Action' }, { status: reading }),
        new Map(),
      ),
  },
  {
    rule: 'availableNowCandidacy',
    field: 'project.status',
    expected: everyUndetermined,
    run: (records, reading) => {
      const task = records.task({ status: 'Next Action', project: ['p'] });
      const project = records.project({ id: 'p', status: 'Active' }, { status: reading });

      return availableNowCandidacy(task, new Map([['p', project]]));
    },
  },
  {
    rule: 'projectLinkOf',
    field: 'task.project',
    expected: emptyMeans({ kind: 'none' }),
    extra: {
      truncated: { reading: TRUNCATED, expected: und('truncated') },
      'a Project not passed in': { reading: links('p'), expected: und('project_not_read') },
    },
    run: (records, reading) =>
      projectLinkOf(records.task({ status: 'Next Action' }, { project: reading }), new Map()),
  },

  // ---- dependency
  {
    rule: 'dependencyState',
    field: 'task.dependencies',
    expected: emptyMeans({ state: 'none' }),
    extra: { truncated: { reading: TRUNCATED, expected: und('truncated') } },
    run: (records, reading) =>
      dependencyState(
        records.task({ id: 'd', status: 'Waiting For' }, { dependencies: reading }),
        new Map(),
      ),
  },
  {
    rule: 'dependencyState',
    field: 'blocker.status',
    expected: { ...everyUndetermined },
    run: (records, reading) =>
      dependencyState(
        records.task({ id: 'd', status: 'Waiting For', dependencies: ['b'] }),
        new Map([['b', records.task({ id: 'b', status: 'Done' }, { status: reading })]]),
      ),
  },
  {
    rule: 'dependencyConsistency',
    field: 'task.waiting_for',
    expected: {
      ...everyUndetermined,
      empty: { state: 'contradiction', kind: 'waiting_for_all_blockers_resolved' },
    },
    extra: {
      'prose in the body': {
        reading: Read.value({ type: 'prose', blocks: [] }),
        expected: und('prose'),
      },
    },
    run: (records, reading) => dependencyConsistency(...waiting(records, { waiting_for: reading })),
  },
  {
    rule: 'dependencyConsistency',
    field: 'task.dependencies',
    expected: emptyMeans({ state: 'consistent' }),
    extra: { truncated: { reading: TRUNCATED, expected: und('truncated') } },
    run: (records, reading) =>
      dependencyConsistency(
        records.task({ id: 'd', status: 'Next Action' }, { dependencies: reading }),
        new Map(),
      ),
  },
  {
    rule: 'dependencyConsistency',
    field: 'task.status',
    expected: { ...everyUndetermined, non_canonical: { state: 'not_applicable' } },
    run: (records, reading) =>
      dependencyConsistency(
        records.task({ id: 'd', status: 'Waiting For', dependencies: ['b'] }, { status: reading }),
        new Map([['b', records.task({ id: 'b', status: 'Done' })]]),
      ),
  },

  // ---- project closure
  {
    rule: 'tasksOf',
    field: 'project.tasks',
    expected: emptyMeans({ tasks: [], unreadable: [] }),
    extra: { truncated: { reading: TRUNCATED, expected: und('truncated') } },
    run: (records, reading) =>
      tasksOf(records.project({ status: 'Done' }, { tasks: reading }), new Map()),
  },
  {
    rule: 'closureObligations',
    field: 'project.tasks',
    expected: emptyMeans({ state: 'settled' }),
    extra: { truncated: { reading: TRUNCATED, expected: und('truncated') } },
    run: (records, reading) =>
      closureObligations(records.project({ status: 'Done' }, { tasks: reading }), new Map()),
  },
  {
    rule: 'closureObligations',
    field: 'project.status',
    expected: everyUndetermined,
    run: (records, reading) =>
      closureObligations(records.project({ status: 'Done' }, { status: reading }), new Map()),
  },
  {
    rule: 'closureObligations',
    field: 'task.status',
    expected: {
      absent: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'absent')] },
      unread: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'unread')] },
      gap: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'gap')] },
      empty: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'empty')] },
      non_canonical: { state: 'settled' },
    },
    run: closedWith,
  },

  // ---- pause
  {
    rule: 'pausedCommitments',
    field: 'project.tasks',
    expected: emptyMeans({ state: 'clear' }),
    extra: { truncated: { reading: TRUNCATED, expected: und('truncated') } },
    run: (records, reading) =>
      pausedCommitments(records.project({ status: 'Paused' }, { tasks: reading }), new Map()),
  },
  {
    rule: 'pausedCommitments',
    field: 'project.status',
    expected: everyUndetermined,
    run: (records, reading) =>
      pausedCommitments(records.project({ status: 'Paused' }, { status: reading }), new Map()),
  },
  {
    rule: 'pausedCommitments',
    field: 'task.status',
    expected: {
      absent: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'absent')] },
      unread: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'unread')] },
      gap: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'gap')] },
      empty: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'empty')] },
      non_canonical: { state: 'clear' },
    },
    run: (records, reading) => pausedWith(records, 'Next Action', { status: reading }),
  },
  {
    rule: 'pausedCommitments',
    field: 'task.deadline',
    expected: {
      absent: { state: 'unverified', unreadable: [unreadableAt('t', 'deadline', 'absent')] },
      unread: { state: 'unverified', unreadable: [unreadableAt('t', 'deadline', 'unread')] },
      gap: { state: 'unverified', unreadable: [unreadableAt('t', 'deadline', 'gap')] },
      non_canonical: {
        state: 'unverified',
        unreadable: [unreadableAt('t', 'deadline', 'non_canonical')],
      },
      empty: { state: 'clear' },
    },
    run: (records, reading) => pausedWith(records, 'Next Action', { deadline: reading }),
  },
  {
    rule: 'pausedCommitments',
    field: 'task.date',
    expected: {
      absent: { state: 'unverified', unreadable: [unreadableAt('t', 'date', 'absent')] },
      unread: { state: 'unverified', unreadable: [unreadableAt('t', 'date', 'unread')] },
      gap: { state: 'unverified', unreadable: [unreadableAt('t', 'date', 'gap')] },
      non_canonical: {
        state: 'unverified',
        unreadable: [unreadableAt('t', 'date', 'non_canonical')],
      },
      empty: { state: 'clear' },
    },
    run: (records, reading) => pausedWith(records, 'Scheduled', { date: reading }),
  },
  /**
   * The date of a `Waiting For` Task is a time for attention, not a commitment, so an unreadable
   * date raises no questions.
   */
  {
    rule: 'pausedCommitments',
    field: 'task.date (Waiting For)',
    expected: {
      absent: { state: 'clear' },
      unread: { state: 'clear' },
      gap: { state: 'clear' },
      non_canonical: { state: 'clear' },
      empty: { state: 'clear' },
    },
    run: (records, reading) => pausedWith(records, 'Waiting For', { date: reading }),
  },

  // ---- passage of time
  {
    rule: 'checkDateReached',
    field: 'task.status',
    expected: { ...everyUndetermined, non_canonical: { state: 'not_applicable' } },
    run: (records, reading) =>
      checkDateReached(
        records.task({ status: 'Waiting For', date: '2026-10-01' }, { status: reading }),
        ANYWHERE,
        NOW,
      ),
  },
  {
    rule: 'checkDateReached',
    field: 'task.date',
    expected: emptyMeans({ state: 'not_due' }),
    run: (records, reading) =>
      checkDateReached(records.task({ status: 'Waiting For' }, { date: reading }), ANYWHERE, NOW),
  },
  {
    rule: 'deadlineSignal',
    field: 'task.status',
    expected: { ...everyUndetermined, non_canonical: { state: 'not_applicable' } },
    run: (records, reading) =>
      deadlineSignal(
        records.task({ status: 'Waiting For', deadline: '2026-10-01' }, { status: reading }),
        ANYWHERE,
        NOW,
        LEAD,
      ),
  },
  {
    rule: 'deadlineSignal',
    field: 'task.deadline',
    expected: emptyMeans({ state: 'none' }),
    run: (records, reading) =>
      deadlineSignal(
        records.task({ status: 'Waiting For' }, { deadline: reading }),
        ANYWHERE,
        NOW,
        LEAD,
      ),
  },

  // ---- project path
  {
    rule: 'projectPath',
    field: 'project.status',
    expected: everyUndetermined,
    run: (records, reading) =>
      projectPath(records.project({ status: 'Active' }, { status: reading }), new Map()),
  },
  {
    rule: 'projectPath',
    field: 'project.tasks',
    expected: emptyMeans({ state: 'stalled' }),
    extra: { truncated: { reading: TRUNCATED, expected: und('truncated') } },
    run: (records, reading) =>
      projectPath(records.project({ status: 'Active' }, { tasks: reading }), new Map()),
  },
  {
    rule: 'projectPath',
    field: 'task.status',
    expected: {
      absent: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'absent')] },
      unread: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'unread')] },
      gap: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'gap')] },
      empty: { state: 'unverified', unreadable: [unreadableAt('t', 'status', 'empty')] },
      non_canonical: { state: 'stalled' },
    },
    run: activeWith,
  },

  // ---- field access
  {
    rule: 'linkedPageIds',
    field: 'reading',
    expected: emptyMeans([]),
    extra: {
      truncated: { reading: TRUNCATED, expected: und('truncated') },
      'not a relation': {
        reading: Read.value({ type: 'text', text: 'a' }),
        expected: und('gap'),
      },
    },
    run: (_, reading) => linkedPageIds(reading),
  },
  {
    rule: 'presenceOf',
    field: 'reading',
    expected: emptyMeans({ state: 'none' }),
    extra: {
      'a value of the wrong shape': {
        reading: Read.value({ type: 'text', text: 'a' }),
        expected: und('gap'),
      },
    },
    run: (_, reading) => presenceOf(reading, 'date'),
  },
  {
    rule: 'dateKindOf',
    field: 'reading',
    expected: emptyMeans({ state: 'none' }),
    run: (_, reading) => dateKindOf(reading),
  },
];
