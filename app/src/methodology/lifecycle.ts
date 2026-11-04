import type { ProjectStatus, TaskStatus } from '../notion/semantics/canonical-status';
import type { Reading } from '../notion/semantics/reading';
import { Undetermined, undetermined } from './undetermined';

/**
 * The lifecycle of a Task status: open work or terminal
 * (`docs/1-methodology.md` § “Task Status”: `Done`, `Canceled` and `Failed` are terminal).
 *
 * The `Record` is exhaustive, so a status that appears in the binding does not compile until the
 * rule says whether it is open. `Hidden` is not part of it, because it is a value outside the
 * model (`known_non_canonical`) and has an answer of its own.
 */
export const TASK_LIFECYCLE = {
  'Next Action': 'open',
  Scheduled: 'open',
  'Waiting For': 'open',
  'Someday/Maybe': 'open',
  Done: 'terminal',
  Canceled: 'terminal',
  Failed: 'terminal',
} as const satisfies Readonly<Record<TaskStatus, 'open' | 'terminal'>>;

/** The open Task statuses: those in which the Task is still work. */
export type OpenTaskStatus = {
  [S in TaskStatus]: (typeof TASK_LIFECYCLE)[S] extends 'open' ? S : never;
}[TaskStatus];

/** Terminal statuses: the work is over, whether it was done or not. */
type TerminalTaskStatus = Exclude<TaskStatus, OpenTaskStatus>;

/**
 * The phase of a Project status: in work (`Planning`, `Active`), paused or closed
 * (`docs/1-methodology.md` § “Project Status”).
 */
export const PROJECT_PHASE = {
  Planning: 'in_work',
  Active: 'in_work',
  Paused: 'paused',
  Done: 'terminal',
  Canceled: 'terminal',
} as const satisfies Readonly<Record<ProjectStatus, 'in_work' | 'paused' | 'terminal'>>;

type TaskLifecycle =
  | { readonly state: 'open'; readonly status: OpenTaskStatus }
  | { readonly state: 'terminal'; readonly status: TerminalTaskStatus }
  /**
   * A value outside the canonical model (`Hidden`): neither open nor closed, it does not exist for
   * the domain.
   */
  | { readonly state: 'out_of_scope'; readonly value: string }
  | Undetermined;

type ProjectPhase =
  | { readonly state: 'in_work' | 'paused' | 'terminal'; readonly status: ProjectStatus }
  | Undetermined;

const isTaskStatus = (option: string): option is TaskStatus =>
  Object.hasOwn(TASK_LIFECYCLE, option);

const isOpenStatus = (status: TaskStatus): status is OpenTaskStatus =>
  TASK_LIFECYCLE[status] === 'open';

const isProjectStatus = (option: string): option is ProjectStatus =>
  Object.hasOwn(PROJECT_PHASE, option);

/**
 * Derives the lifecycle of a Task from its status as read. An unreadable or unknown status asserts
 * nothing.
 */
export function lifecycleOf(status: Reading): TaskLifecycle {
  switch (status.state) {
    case 'value': {
      const { value } = status;

      if (value.type !== 'option' || !isTaskStatus(value.option)) return undetermined('gap');

      return isOpenStatus(value.option)
        ? { state: 'open', status: value.option }
        : { state: 'terminal', status: value.option };
    }

    case 'non_canonical':
      return { state: 'out_of_scope', value: status.value };

    case 'absent':
    case 'empty':
    case 'unread':
    case 'gap':
      return undetermined(status.state);
  }
}

/** Derives the phase of a Project from its status as read. */
export function phaseOf(status: Reading): ProjectPhase {
  switch (status.state) {
    case 'value':
      return status.value.type === 'option' && isProjectStatus(status.value.option)
        ? { state: PROJECT_PHASE[status.value.option], status: status.value.option }
        : undetermined('gap');

    case 'absent':
    case 'empty':
    case 'unread':
    case 'gap':
    case 'non_canonical':
      return undetermined(status.state);
  }
}
