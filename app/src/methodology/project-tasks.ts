import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { linkedPageIds } from './linked-pages';
import { isUndetermined, type Undetermined, type Unreadable } from './undetermined';

/**
 * The Tasks of a Project as the rule sees them: the records read through the Project's relation,
 * and the ids for which the rule was given no record.
 */
interface ProjectTasks {
  readonly tasks: readonly DecodedRecord<'task'>[];
  /** The Task is in the Project's `Tasks`, but the rule was given no record: nothing is known. */
  readonly unreadable: readonly Unreadable[];
}

/**
 * Returns the Tasks of a Project as its own `Tasks` relation lists them: “nothing is left” follows
 * from a complete list, and only the relation says what the complete list is. `dependencyState`
 * likewise follows the dependency relation and asks the map of blockers.
 *
 * If the relation is unusable (unread, absent, truncated, of the wrong shape), the rule does not
 * know which Tasks are in the Project, and there is no answer. If it is usable but some Task's
 * record was not passed, the rest is not lost: the known Tasks stay known, the unknown ones are
 * named in `unreadable`, and a rule over the Project's Tasks says “nothing there” only when there
 * are no unknown ones.
 *
 * `known` holds the Tasks that were read, keyed by `pageId`: the rule reads nothing.
 */
export function tasksOf(
  project: DecodedRecord<'project'>,
  known: ReadonlyMap<string, DecodedRecord<'task'>>,
): ProjectTasks | Undetermined {
  const ids = linkedPageIds(project.readings.tasks);

  if (isUndetermined(ids)) return ids;

  const tasks: DecodedRecord<'task'>[] = [];
  const unreadable: Unreadable[] = [];

  for (const id of ids) {
    const task = known.get(id);

    if (task) {
      tasks.push(task);
    } else {
      unreadable.push({ taskId: id, field: 'record', because: 'task_not_read' });
    }
  }

  return { tasks, unreadable };
}
