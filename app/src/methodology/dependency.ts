import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { lifecycleOf } from './lifecycle';
import { linkedPageIds } from './linked-pages';
import { presenceOf } from './presence';
import { isUndetermined, undetermined, type Undetermined, type Unreadable } from './undetermined';

type DependencyState =
  /**
   * The relation has no dependencies: it expresses no external party (a person, a system, an
   * event).
   */
  | { readonly state: 'none' }
  /**
   * There is a blocker that is **definitely** unresolved: open or unfulfilled (`Failed`).
   * `unknown` holds blockers that could not be judged; they do not erase what is known.
   */
  | {
      readonly state: 'blocked';
      readonly open: readonly string[];
      readonly failed: readonly string[];
      readonly resolved: readonly string[];
      readonly unknown: readonly Unreadable[];
    }
  /** All blockers are resolved, and each one has been read. */
  | { readonly state: 'resolved'; readonly resolved: readonly string[] }
  | Undetermined;

/**
 * Returns the state of a Task's dependency, derived **from the relation and the blockers'
 * statuses**, not from the workspace formula. The formula is a hint that can be changed, and the
 * rule must give an answer without it.
 *
 * A blocker is resolved when it is `Done` or `Canceled` (the work is done or no longer needed). A
 * `Failed` blocker is not resolved: what was promised did not happen, and the dependent work
 * remains work that awaits the person's decision. A blocker outside the model (`Hidden`) or an
 * unreadable one yields no state.
 *
 * The answer is assembled from all the blockers: a single definitely unresolved blocker proves
 * “blocked” regardless of the rest, while “resolved” requires every blocker to be resolved.
 *
 * `blockers` are the Tasks read from the “Blocked by” relation, keyed by `pageId`.
 */
export function dependencyState(
  task: DecodedRecord<'task'>,
  blockers: ReadonlyMap<string, DecodedRecord<'task'>>,
): DependencyState {
  const ids = linkedPageIds(task.readings.dependencies);

  if (isUndetermined(ids)) return ids;
  if (ids.length === 0) return { state: 'none' };

  const open: string[] = [];
  const failed: string[] = [];
  const resolved: string[] = [];
  const unknown: Unreadable[] = [];

  for (const id of ids) {
    const blocker = blockers.get(id);

    if (!blocker) {
      unknown.push({ taskId: id, field: 'record', because: 'blocker_not_read' });
      continue;
    }

    const lifecycle = lifecycleOf(blocker.readings.status);

    switch (lifecycle.state) {
      case 'undetermined':
        unknown.push({ taskId: id, field: 'status', because: lifecycle.because });
        break;

      case 'out_of_scope':
        unknown.push({ taskId: id, field: 'status', because: 'non_canonical' });
        break;

      case 'open':
        open.push(id);
        break;

      case 'terminal':
        (lifecycle.status === 'Failed' ? failed : resolved).push(id);
        break;
    }
  }

  if (open.length > 0 || failed.length > 0) {
    return { state: 'blocked', open, failed, resolved, unknown };
  }

  const [first] = unknown;

  return first ? undetermined(first.because) : { state: 'resolved', resolved };
}

type DependencyContradiction =
  /**
   * A `Waiting For` whose dependency is entirely resolved and which has nothing else left to wait
   * for: the status says we are waiting.
   */
  | 'waiting_for_all_blockers_resolved'
  /** A `Next Action` with an unresolved blocker: the status says work can start, but it cannot. */
  | 'next_action_with_unresolved_blocker';

type DependencyConsistency =
  /** The status rule was applied, and there is no conflict. */
  | { readonly state: 'consistent' }
  /** No rule for this status applies to the Task: there is nothing to compare with. */
  | { readonly state: 'not_applicable' }
  | { readonly state: 'contradiction'; readonly kind: DependencyContradiction }
  | Undetermined;

/**
 * Checks whether a Task's status agrees with its dependency (`docs/3-policy.md` § “Contradiction”).
 *
 * A `Waiting For` with a resolved dependency is a contradiction only when there is nothing left to
 * wait for: the external party that the relation does not express is stated in the page body
 * (`task.waiting_for`). A body that was read and is empty is a contradiction; if there is prose,
 * the rule does not read it and asserts nothing (`prose`); an unread body asserts nothing either.
 * A `Waiting For` with no dependency relation has nothing to compare with: it is an ordinary
 * delegation.
 */
export function dependencyConsistency(
  task: DecodedRecord<'task'>,
  blockers: ReadonlyMap<string, DecodedRecord<'task'>>,
): DependencyConsistency {
  const lifecycle = lifecycleOf(task.readings.status);

  if (lifecycle.state === 'undetermined') return lifecycle;
  if (lifecycle.state !== 'open') return { state: 'not_applicable' };

  switch (lifecycle.status) {
    case 'Next Action':
      return nextActionConsistency(task, blockers);

    case 'Waiting For':
      return waitingForConsistency(task, blockers);

    case 'Scheduled':
    case 'Someday/Maybe':
      return { state: 'not_applicable' };
  }
}

function nextActionConsistency(
  task: DecodedRecord<'task'>,
  blockers: ReadonlyMap<string, DecodedRecord<'task'>>,
): DependencyConsistency {
  const dependency = dependencyState(task, blockers);

  if (dependency.state === 'undetermined') return dependency;

  return dependency.state === 'blocked'
    ? { state: 'contradiction', kind: 'next_action_with_unresolved_blocker' }
    : { state: 'consistent' };
}

function waitingForConsistency(
  task: DecodedRecord<'task'>,
  blockers: ReadonlyMap<string, DecodedRecord<'task'>>,
): DependencyConsistency {
  const dependency = dependencyState(task, blockers);

  switch (dependency.state) {
    case 'undetermined':
      return dependency;

    case 'none':
      return { state: 'not_applicable' };

    case 'blocked':
      return { state: 'consistent' };

    case 'resolved': {
      const body = presenceOf(task.readings.waiting_for, 'prose');

      if (body.state === 'undetermined') return body;

      return body.state === 'present'
        ? undetermined('prose')
        : { state: 'contradiction', kind: 'waiting_for_all_blockers_resolved' };
    }
  }
}
