import { Page, PageBlock } from '../../src/notion/client/page';
import { DecodedRecord, FieldOf } from '../../src/notion/semantics/decoded-record';
import { Reading } from '../../src/notion/semantics/reading';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { TASK_STATUS_SPELLED, VALID_BINDING_FILE } from './notion-mapping.fixture';
import {
  adapterWith,
  dateProperty,
  optionProperty,
  pageFor,
  relationProperty,
} from './notion-page.fixture';

/**
 * The status option ids in the fixture binding: the same ids the binding has, not a copy of them.
 * `Hidden` is a non-canonical value of the field (`known_non_canonical`).
 */
const TASK_OPTION: Readonly<Record<string, string>> = {
  ...VALID_BINDING_FILE.options['task.status']?.canonical,
  ...VALID_BINDING_FILE.options['task.status']?.known_non_canonical,
};

const PROJECT_OPTION: Readonly<Record<string, string>> = {
  ...VALID_BINDING_FILE.options['project.status']?.canonical,
};

/** What a Task has: everything not named is empty. */
interface TaskSpec {
  readonly id?: string;
  /**
   * The canonical status name, `Hidden`, or any other, in which case the option is unknown to the
   * semantic model.
   */
  readonly status: string;
  /** The Project the Task is linked to, as page ids. */
  readonly project?: readonly string[];
  readonly dependencies?: readonly string[];
  /** The binding returned only the start of the list of relations. */
  readonly dependenciesTruncated?: boolean;
  readonly date?: string;
  readonly deadline?: string;
  /** The page body: blocks if it was read. Without it `waiting_for` is `unread`. */
  readonly body?: readonly PageBlock[];
}

interface ProjectSpec {
  readonly id?: string;
  readonly status: string;
  /** The Project's Tasks as page ids, the other side of the two-way relation `task.project`. */
  readonly tasks?: readonly string[];
  /** The binding returned only the start of the list of relations. */
  readonly tasksTruncated?: boolean;
}

/**
 * Readings the test substitutes for the ones the adapter read. The adapter does not return
 * `gap`/`non_canonical` on a relation, a date or a body, and it returns `unread` only when no body
 * is passed. The states a rule must withstand therefore come only from overriding a single reading
 * on a real record.
 */
type Readings<T extends 'task' | 'project'> = Partial<Record<FieldOf<T>, Reading>>;

/**
 * Canonical records for the methodology rules: the real adapter reads the fixture pages, so the
 * rule sees what it will see in operation, not a hand-written imitation of `DecodedRecord`.
 */
export class Records {
  private constructor(private readonly adapter: SemanticAdapter) {}

  static async create(): Promise<Records> {
    return new Records(await adapterWith());
  }

  task(spec: TaskSpec, readings: Readings<'task'> = {}): DecodedRecord<'task'> {
    const record = this.adapter.decode('task', taskPageOf(spec), spec.body);

    return { ...record, readings: { ...record.readings, ...readings } };
  }

  project(spec: ProjectSpec, readings: Readings<'project'> = {}): DecodedRecord<'project'> {
    const record = this.adapter.decode('project', projectPageOf(spec));

    return { ...record, readings: { ...record.readings, ...readings } };
  }
}

/** Builds a Task page with the status, dates and relations named by the spec. */
export function taskPageOf(spec: TaskSpec): Page {
  const page = pageFor('task', {
    [TASK_STATUS_SPELLED]: optionProperty(
      TASK_STATUS_SPELLED,
      TASK_OPTION[spec.status] ?? 'opt_unknown',
      spec.status,
    ),
    p_task_date: dateProperty('p_task_date', spec.date ?? null),
    p_task_deadline: dateProperty('p_task_deadline', spec.deadline ?? null),
    r_task_project: relationProperty('r_task_project', [...(spec.project ?? [])]),
    'r_task%7Bdependencies': relationProperty(
      'r_task%7Bdependencies',
      [...(spec.dependencies ?? [])],
      spec.dependenciesTruncated ?? false,
    ),
  });

  return { ...page, id: spec.id ?? page.id };
}

/** Builds a Project page with the status named by the spec. */
export function projectPageOf(spec: ProjectSpec): Page {
  const page = pageFor('project', {
    p_project_status: optionProperty(
      'p_project_status',
      PROJECT_OPTION[spec.status] ?? 'opt_unknown',
      spec.status,
    ),
    r_project_tasks: relationProperty(
      'r_project_tasks',
      [...(spec.tasks ?? [])],
      spec.tasksTruncated ?? false,
    ),
  });

  return { ...page, id: spec.id ?? page.id };
}
