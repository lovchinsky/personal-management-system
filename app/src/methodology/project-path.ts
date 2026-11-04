import type { ProjectStatus } from '../notion/semantics/canonical-status';
import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { lifecycleOf, phaseOf, type OpenTaskStatus } from './lifecycle';
import { tasksOf } from './project-tasks';
import { isUndetermined, type Undetermined, type Unreadable } from './undetermined';

type ProjectPath =
  /** The Project is not in work: it is paused or closed, and other questions apply to it. */
  | { readonly state: 'not_in_work' }
  /** There is an open Task that moves the work. */
  | { readonly state: 'moving' }
  /** There is no open Task that moves the work, and every Task of the Project was read. */
  | { readonly state: 'stalled' }
  /**
   * No Task that moves the work was found, but some Tasks could not be judged: “none” is not
   * proven.
   */
  | { readonly state: 'unverified'; readonly unreadable: readonly Unreadable[] }
  | Undetermined;

/**
 * The Tasks that move a Project in work (`docs/3-policy.md` § “Proactive scope”): `Planning` moves
 * with any open Task, a clarifying one included; `Active` moves with a `Next Action`, `Scheduled`
 * or `Waiting For` Task, because waiting and scheduling count as movement too. An Area of Focus
 * under `Advance` is measured by the same movement (`area_of_focus_risk`). The `Record` covers both
 * in-work statuses, so a new status without a decision is a compile error.
 */
export const PROJECT_MOVES: Readonly<
  Record<Extract<ProjectStatus, 'Planning' | 'Active'>, readonly OpenTaskStatus[]>
> = {
  Planning: ['Next Action', 'Scheduled', 'Waiting For', 'Someday/Maybe'],
  Active: ['Next Action', 'Scheduled', 'Waiting For'],
};

const isInWork = (status: ProjectStatus): status is keyof typeof PROJECT_MOVES =>
  Object.hasOwn(PROJECT_MOVES, status);

/**
 * Checks whether a Project in work has a path. `Planning` with no open Task and `Active` with no
 * Task that moves the work are forms of `project_integrity` that can be read off the states without
 * interpretation. Tasks are taken from the Project's `Tasks` relation (`tasksOf`); `known` holds
 * the Tasks that were read, keyed by `pageId`.
 */
export function projectPath(
  project: DecodedRecord<'project'>,
  known: ReadonlyMap<string, DecodedRecord<'task'>>,
): ProjectPath {
  const phase = phaseOf(project.readings.status);

  if (phase.state === 'undetermined') return phase;
  if (phase.state !== 'in_work' || !isInWork(phase.status)) return { state: 'not_in_work' };

  const found = tasksOf(project, known);

  if (isUndetermined(found)) return found;

  const moving = PROJECT_MOVES[phase.status];
  const unreadable: Unreadable[] = [...found.unreadable];

  for (const task of found.tasks) {
    const lifecycle = lifecycleOf(task.readings.status);

    if (lifecycle.state === 'open' && moving.includes(lifecycle.status)) return { state: 'moving' };
    if (lifecycle.state === 'undetermined') {
      unreadable.push({ taskId: task.pageId, field: 'status', because: lifecycle.because });
    }
  }

  return unreadable.length > 0 ? { state: 'unverified', unreadable } : { state: 'stalled' };
}
