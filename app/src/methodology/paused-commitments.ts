import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { lifecycleOf, phaseOf, type OpenTaskStatus } from './lifecycle';
import { dateKindOf, presenceOf } from './presence';
import { tasksOf } from './project-tasks';
import { isUndetermined, type Undetermined, type Unreadable } from './undetermined';

/**
 * An open Task of a paused Project about which the pause raises a question for the person: it has
 * a time that the pause does not hide.
 */
interface Commitment {
  readonly taskId: string;
  readonly carries: readonly ('date' | 'deadline')[];
}

type PausedCommitments =
  | { readonly state: 'not_paused' }
  /** The pause leaves no questions: no Task has a time, and every Task was read. */
  | { readonly state: 'clear' }
  /**
   * The person has something to decide. `unreadable` holds Tasks that could not be judged: the
   * list may be incomplete.
   */
  | {
      readonly state: 'to_decide';
      readonly commitments: readonly Commitment[];
      readonly unreadable: readonly Unreadable[];
    }
  /** No candidates found, but some Tasks could not be judged: “none” is not proven. */
  | { readonly state: 'unverified'; readonly unreadable: readonly Unreadable[] }
  | Undetermined;

/**
 * Whether the `Date` of a Task in this status can be a time that the pause does not hide. What
 * `Date` means is set by the status (`docs/2-system.md` § “`Date` and `Deadline`”): in
 * `Scheduled`, when the work becomes current; in `Waiting For`, when to check the dependency; in
 * `Someday/Maybe`, when to return to the decision. A check date and a return date are times for
 * attention that the pause legitimately suppresses. A `Next Action` with a date is a state the
 * system does not interpret (a planned date makes a Task `Scheduled`), but one the person may
 * have left: if the date has a time of day, it is almost certainly an event set for that time. The
 * `Record` covers all open statuses, so a new status without a decision is a compile error.
 */
const DATE_MAY_BE_A_MOMENT: Readonly<Record<OpenTaskStatus, boolean>> = {
  'Next Action': true,
  Scheduled: true,
  'Waiting For': false,
  'Someday/Maybe': false,
};

interface Judged {
  readonly commitment: Commitment | null;
  readonly unreadable: readonly Unreadable[];
}

/**
 * Reports what the pause says about one Task: the time it has and the fields that cannot be read.
 */
function judge(task: DecodedRecord<'task'>): Judged {
  const taskId = task.pageId;
  const lifecycle = lifecycleOf(task.readings.status);

  if (lifecycle.state === 'undetermined') {
    return {
      commitment: null,
      unreadable: [{ taskId, field: 'status', because: lifecycle.because }],
    };
  }

  if (lifecycle.state !== 'open') return { commitment: null, unreadable: [] };

  const carries: ('date' | 'deadline')[] = [];
  const unreadable: Unreadable[] = [];

  if (DATE_MAY_BE_A_MOMENT[lifecycle.status]) {
    const date = dateKindOf(task.readings.date);

    if (date.state === 'timed') carries.push('date');
    if (date.state === 'undetermined') {
      unreadable.push({ taskId, field: 'date', because: date.because });
    }
  }

  const deadline = presenceOf(task.readings.deadline, 'date');

  if (deadline.state === 'present') carries.push('deadline');
  if (deadline.state === 'undetermined') {
    unreadable.push({ taskId, field: 'deadline', because: deadline.because });
  }

  return { commitment: carries.length > 0 ? { taskId, carries } : null, unreadable };
}

/**
 * Determines which open Tasks of a paused Project have a time that the pause does not hide: a
 * `Deadline`, or a `Date` with a time of day on a Task whose date can be a time the pause does not
 * hide.
 *
 * The pause suppresses Tasks in flexible views, but not Calendar commitments and deadlines: they
 * must be explicitly kept, moved, canceled or re-linked (`docs/1-methodology.md` § “Project
 * Status”). A Task appears in the Calendar when “a specific time really matters” for it; one
 * deferred “to a certain day” appears only in the `Scheduled` view (`docs/1-methodology.md` §
 * “Hard landscape”). The rule names the Tasks the question arises for; whether each of them is a
 * hard commitment is for the person to decide. A date without a time that is in fact hard is
 * invisible to the rule.
 *
 * Tasks are taken from the Project's `Tasks` relation (`tasksOf`): “clear” says there are no
 * candidates and every Task was read.
 */
export function pausedCommitments(
  project: DecodedRecord<'project'>,
  known: ReadonlyMap<string, DecodedRecord<'task'>>,
): PausedCommitments {
  const phase = phaseOf(project.readings.status);

  if (phase.state === 'undetermined') return phase;
  if (phase.state !== 'paused') return { state: 'not_paused' };

  const found = tasksOf(project, known);

  if (isUndetermined(found)) return found;

  const commitments: Commitment[] = [];
  const unreadable: Unreadable[] = [...found.unreadable];

  for (const task of found.tasks) {
    const judged = judge(task);

    if (judged.commitment) commitments.push(judged.commitment);
    unreadable.push(...judged.unreadable);
  }

  if (commitments.length > 0) return { state: 'to_decide', commitments, unreadable };
  if (unreadable.length > 0) return { state: 'unverified', unreadable };

  return { state: 'clear' };
}
