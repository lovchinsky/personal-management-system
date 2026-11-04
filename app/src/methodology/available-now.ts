import type { TaskStatus } from '../notion/semantics/canonical-status';
import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { lifecycleOf, phaseOf } from './lifecycle';
import { linkedPageIds } from './linked-pages';
import { isUndetermined, undetermined, type Undetermined } from './undetermined';

/**
 * The Task's Project as the rule sees it: the Task is standalone or points to a Project that was
 * read. A Project the rule was not given is `undetermined('project_not_read')`.
 */
type ProjectLink =
  | { readonly kind: 'none' }
  | { readonly kind: 'record'; readonly project: DecodedRecord<'project'> };

/**
 * Finds the Task's Project by its relation. `known` holds the Projects that were read, by
 * `pageId`: the rule reads nothing, so what is not in `known` stays unread.
 */
export function projectLinkOf(
  task: DecodedRecord<'task'>,
  known: ReadonlyMap<string, DecodedRecord<'project'>>,
): ProjectLink | Undetermined {
  const ids = linkedPageIds(task.readings.project);

  if (isUndetermined(ids)) return ids;
  if (ids.length === 0) return { kind: 'none' };
  if (ids.length > 1) return undetermined('ambiguous_link');

  const project = known.get(ids[0]);

  return project ? { kind: 'record', project } : undetermined('project_not_read');
}

type Candidacy =
  | { readonly state: 'candidate' }
  | { readonly state: 'excluded'; readonly reason: 'not_next_action'; readonly status: TaskStatus }
  | {
      readonly state: 'excluded';
      readonly reason: 'out_of_scope' | 'project_paused' | 'project_terminal';
    }
  | Undetermined;

/**
 * Checks whether a Task can get into Available Now, judged by the **mechanical necessary
 * conditions only** (`docs/3-policy.md` § “Execution availability and Available Now”): status
 * `Next Action`, a Project in work (`Planning`/`Active`) or no Project. `projects` holds the
 * Projects that were read, by `pageId`. The rule takes the Task's Project from the Task's own
 * relation (`projectLinkOf`).
 *
 * `candidate` does not say the Task is in Available Now, because specificity, context, resources,
 * the effect of the Calendar and the selectivity of the set are the judgment of whoever composes
 * Available Now. The rule cuts off what cannot be in Available Now, and nothing more.
 */
export function availableNowCandidacy(
  task: DecodedRecord<'task'>,
  projects: ReadonlyMap<string, DecodedRecord<'project'>>,
): Candidacy {
  const lifecycle = lifecycleOf(task.readings.status);

  switch (lifecycle.state) {
    case 'undetermined':
      return lifecycle;

    case 'out_of_scope':
      return { state: 'excluded', reason: 'out_of_scope' };

    case 'open':
    case 'terminal':
      if (lifecycle.status !== 'Next Action') {
        return { state: 'excluded', reason: 'not_next_action', status: lifecycle.status };
      }
  }

  const link = projectLinkOf(task, projects);

  if (isUndetermined(link)) return link;
  if (link.kind === 'none') return { state: 'candidate' };

  const phase = phaseOf(link.project.readings.status);

  switch (phase.state) {
    case 'in_work':
      return { state: 'candidate' };

    case 'paused':
      return { state: 'excluded', reason: 'project_paused' };

    case 'terminal':
      return { state: 'excluded', reason: 'project_terminal' };

    case 'undetermined':
      return phase;
  }
}
