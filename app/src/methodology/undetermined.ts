import type { Reading } from '../notion/semantics/reading';

/**
 * Why a rule cannot answer. Most reasons are the reading states of a field
 * (`docs/2-system.md` § “Logical interface of the adapter”), so the vocabulary is the adapter's;
 * the rest come from a relation the rule was not given in read form.
 *
 * A rule with nothing to answer from does not guess: “unread” is not “empty” (`INV-002`), and an
 * answer built on it would assert what nobody checked.
 */
type Because =
  | Exclude<Reading['state'], 'value'>
  /** The Task points to a Project, and the Project's record was not passed to the rule. */
  | 'project_not_read'
  /** The dependency points to a Task, and that Task's record was not passed to the rule. */
  | 'blocker_not_read'
  /** The Project points to a Task, and that Task's record was not passed to the rule. */
  | 'task_not_read'
  /** The answer depends on the content of prose, and the rule does not read prose. */
  | 'prose'
  /** The relation points to several pages where the property allows one. */
  | 'ambiguous_link'
  /** The list of links is truncated: the rest is unknown. */
  | 'truncated';

/** The “assert nothing” answer: a result of its own, not a spurious `false`. */
export interface Undetermined {
  readonly state: 'undetermined';
  readonly because: Because;
}

export function undetermined(because: Because): Undetermined {
  return { state: 'undetermined', because };
}

export function isUndetermined(value: unknown): value is Undetermined {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    value.state === 'undetermined'
  );
}

/**
 * A Task the rule could not judge: which field and why. The list of such Tasks sits next to a
 * definite answer, not in place of it: one unreadable Task does not erase what is known about the
 * rest, but it does not allow saying “there is nothing more” either.
 */
export interface Unreadable {
  readonly taskId: string;
  /** `record` means the Task's record was not passed to the rule at all. */
  readonly field: 'status' | 'date' | 'deadline' | 'record';
  readonly because: Because;
}
