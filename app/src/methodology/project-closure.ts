import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { lifecycleOf, phaseOf, type OpenTaskStatus } from './lifecycle';
import { tasksOf } from './project-tasks';
import { isUndetermined, type Undetermined, type Unreadable } from './undetermined';

/** An unfinished Task of a closed Project: the person must settle it. */
interface Obligation {
  readonly taskId: string;
  readonly status: OpenTaskStatus;
}

type Closure =
  /** The Project is in work or paused: there are no closure obligations. */
  | { readonly state: 'not_terminal'; readonly phase: 'in_work' | 'paused' }
  /** A closed Project with no unfinished Tasks, where this is known for every Task. */
  | { readonly state: 'settled' }
  /**
   * A closed Project with unfinished Tasks. `unreadable` holds Tasks that could not be judged: the
   * list of obligations may be incomplete.
   */
  | {
      readonly state: 'unsettled';
      readonly obligations: readonly Obligation[];
      readonly unreadable: readonly Unreadable[];
    }
  /** No obligations found, but some Tasks could not be judged: “none” is not proven. */
  | { readonly state: 'unverified'; readonly unreadable: readonly Unreadable[] }
  | Undetermined;

/**
 * Determines what is left to settle in a closed Project (`Done`/`Canceled`): “Active Tasks must
 * not stay linked to a closed Project out of sight” (`docs/1-methodology.md` § “Project Status”).
 *
 * Tasks are taken from the Project's `Tasks` relation (`tasksOf`), so “settled” says: the Project
 * has no unfinished Task, and every one of its Tasks was read. Closed Tasks and those outside the
 * model (`Hidden`) create no obligations.
 */
export function closureObligations(
  project: DecodedRecord<'project'>,
  known: ReadonlyMap<string, DecodedRecord<'task'>>,
): Closure {
  const phase = phaseOf(project.readings.status);

  if (phase.state === 'undetermined') return phase;
  if (phase.state !== 'terminal') return { state: 'not_terminal', phase: phase.state };

  const found = tasksOf(project, known);

  if (isUndetermined(found)) return found;

  const obligations: Obligation[] = [];
  const unreadable: Unreadable[] = [...found.unreadable];

  for (const task of found.tasks) {
    const lifecycle = lifecycleOf(task.readings.status);

    if (lifecycle.state === 'open') {
      obligations.push({ taskId: task.pageId, status: lifecycle.status });
    } else if (lifecycle.state === 'undetermined') {
      unreadable.push({ taskId: task.pageId, field: 'status', because: lifecycle.because });
    }
  }

  if (obligations.length > 0) return { state: 'unsettled', obligations, unreadable };
  if (unreadable.length > 0) return { state: 'unverified', unreadable };

  return { state: 'settled' };
}
