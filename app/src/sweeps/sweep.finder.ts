import { Inject, Injectable, Logger } from '@nestjs/common';
import { addDays, hoursToMilliseconds } from 'date-fns';
import { appConfig, type AppConfig } from '../config/app.config';
import { SweepRule } from '../generated/prisma/enums';
import { projectLinkOf } from '../methodology/available-now';
import { dependencyConsistency } from '../methodology/dependency';
import { phaseOf } from '../methodology/lifecycle';
import { linkedPageIds } from '../methodology/linked-pages';
import { pausedCommitments } from '../methodology/paused-commitments';
import { closureObligations } from '../methodology/project-closure';
import { projectPath } from '../methodology/project-path';
import { checkDateReached, deadlineSignal, type PlaceDate } from '../methodology/time-signals';
import { isUndetermined } from '../methodology/undetermined';
import { canonicalNotionId } from '../notion/client/notion-id';
import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { needsAttention, notionFailureOf } from '../notion/semantics/notion-failure';
import type { Reading } from '../notion/semantics/reading';
import {
  NotionRecordQuery,
  type RecordFilter,
  type RecordOrder,
} from '../notion/semantics/record-query';
import { NotionRecordReader } from '../notion/semantics/record.reader';
import { messageOf, stackOf } from '../platform/error/message-of';
import { momentOfCalendarValue } from '../platform/time/calendar-moment';
import { localDateAt } from '../platform/time/local-day';
import { sweepConfig, type SweepConfig } from './sweep.config';

/** A situation a methodology rule sees on a page. */
export interface Candidate {
  /** The page to wake: the Task or Project the situation concerns. */
  readonly pageId: string;
  readonly rule: SweepRule;
  /** The basis: the same situation on a different basis is a new situation. */
  readonly basis: string;
  /**
   * When the situation arose: the instant of the date for time rules, the last edit of any
   * participant for the rest.
   */
  readonly since: Date;
  /** The situation's pages: a run about any of them that began after `since` has seen it. */
  readonly pages: readonly string[];
}

/** Task statuses in which a deadline is a commitment (`deadlineSignal`). */
const COMMITTED = ['Next Action', 'Scheduled', 'Waiting For'];

/** Statuses in which a dependency relation can contradict the status (`dependencyConsistency`). */
const DEPENDENT = ['Next Action', 'Waiting For'];

/** How many Tasks of a Project are read: a Project with more is one the sweep does not judge. */
const MAX_PROJECT_TASKS = 100;

/**
 * Records by page id: those the query returned, and the pages it did not return that had to be
 * read separately.
 */
type Known<T extends 'task' | 'project'> = Map<string, DecodedRecord<T>>;

/**
 * A Task's situation together with the Task: whether the Task stands alone is decided by its
 * Project.
 */
interface TaskSituation {
  readonly task: DecodedRecord<'task'>;
  readonly candidate: Candidate;
}

/** Phases of a Project whose Tasks' situation the Project itself carries. */
const HOLDS_ITS_TASKS: ReadonlySet<string> = new Set(['paused', 'terminal']);

/** The Projects of candidate Tasks read by this tick, and how many reads they took. */
interface ProjectsOfTick {
  readonly known: Known<'project'>;
  reads: number;
}

/**
 * Finds the candidates of the periodic safety sweep. It runs bounded REST queries and applies the
 * methodology rules to what they read (`docs/2-system.md` § “Periodic safety sweep”).
 *
 * There are no conclusions about the domain here: a rule says that the states show a situation,
 * and the run decides what to do about it. What a rule cannot judge (a field that was not read, a
 * Task that was not found) does not become a candidate.
 *
 * The recency threshold is in the query itself, and the query returns the freshest first: the
 * limit on the number of rows cuts off the older rows, not the fresh ones. Time rules query for
 * dates from the recency threshold onward. A structural situation arises from an edit, and an edit
 * is an event; the sweep is its fallback path in case the event has been lost, so the Projects
 * taken are those edited within the recency threshold. A dependent Task's situation also changes
 * with an edit to its blocker, so all dependent Tasks are taken, the most recently edited first,
 * and the situation's recency is measured from the last edit to any of the participants.
 *
 * A Task of a paused or closed Project is not woken separately: the Project carries its situation.
 */
@Injectable()
export class SweepFinder {
  private readonly logger = new Logger(SweepFinder.name);

  constructor(
    private readonly query: NotionRecordQuery,
    private readonly reader: NotionRecordReader,
    @Inject(sweepConfig.KEY) private readonly config: SweepConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * Returns the candidates as of `now`. `horizon` is the oldest edit the structural rules still
   * look at. A group is a unit of work: a group that was not read is skipped and this tick says
   * nothing about it, while the other groups continue. A failure the person must see (a binding
   * that is unsuitable or unknown) is logged as an error.
   */
  async find(now: Date, horizon: Date): Promise<Candidate[]> {
    const projects: ProjectsOfTick = { known: new Map(), reads: 0 };
    const groups: [string, () => Promise<Candidate[]>][] = [
      ['check dates', async () => this.standalone(await this.dueChecks(now, horizon), projects)],
      ['deadlines', async () => this.standalone(await this.deadlines(now, horizon), projects)],
      ['projects', () => this.projects(horizon)],
      ['dependencies', async () => this.standalone(await this.dependencies(), projects)],
    ];
    const found: Candidate[] = [];

    for (const [name, group] of groups) {
      try {
        found.push(...(await group()));
      } catch (error) {
        const failure = notionFailureOf(error);
        const skipped = `sweep: ${name} skipped this tick — ${failure}: ${messageOf(error)}`;

        if (needsAttention(failure)) this.logger.error(skipped, stackOf(error));
        else this.logger.warn(skipped);
      }
    }

    return found;
  }

  /** Finds `Waiting For` Tasks whose check date has come due. */
  private async dueChecks(now: Date, horizon: Date): Promise<TaskSituation[]> {
    const records = await this.records(
      'check dates',
      'task',
      [
        { field: 'status', anyOf: ['Waiting For'] },
        { field: 'date', onOrBefore: this.dateAfter(now, 1) },
        { field: 'date', onOrAfter: this.dateAfter(horizon, -1) },
      ],
      { field: 'date', direction: 'descending' },
    );

    return records.flatMap((task): TaskSituation[] => {
      const due = checkDateReached(task, this.place, now.getTime());

      if (due.state !== 'due') return [];

      return [
        {
          task,
          candidate: {
            pageId: canonicalNotionId(task.pageId),
            rule: 'check_date_reached',
            basis: `date:${dateText(task.readings.date)}`,
            since: new Date(due.at),
            pages: [canonicalNotionId(task.pageId)],
          },
        },
      ];
    });
  }

  /** Finds open Tasks whose deadline has passed or, for `Waiting For`, has drawn near. */
  private async deadlines(now: Date, horizon: Date): Promise<TaskSituation[]> {
    const lead = this.config.deadlineLeadDays;
    const leadMs = hoursToMilliseconds(24 * lead);
    const records = await this.records(
      'deadlines',
      'task',
      [
        { field: 'status', anyOf: COMMITTED },
        { field: 'deadline', onOrBefore: this.dateAfter(now, lead + 1) },
        { field: 'deadline', onOrAfter: this.dateAfter(horizon, -1) },
      ],
      { field: 'deadline', direction: 'descending' },
    );

    return records.flatMap((task): TaskSituation[] => {
      const signal = deadlineSignal(task, this.place, now.getTime(), leadMs);

      if (signal.state !== 'passed' && signal.state !== 'near') return [];

      return [
        {
          task,
          candidate: {
            pageId: canonicalNotionId(task.pageId),
            rule: 'deadline_signal',
            basis: `${signal.state}:${dateText(task.readings.deadline)}`,
            since: new Date(signal.state === 'passed' ? signal.at : signal.at - leadMs),
            pages: [canonicalNotionId(task.pageId)],
          },
        },
      ];
    });
  }

  /**
   * Finds Projects that were themselves edited, or whose Tasks were edited, within the recency
   * threshold: a Project in progress with no path, a paused one with a time-fixed commitment, a
   * closed one with unfinished Tasks. The most recently edited come first.
   */
  private async projects(horizon: Date): Promise<Candidate[]> {
    const edited = { editedOnOrAfter: horizon.toISOString() };
    const freshest: { readonly edited: 'descending' } = { edited: 'descending' };
    const projects = await this.records('edited projects', 'project', [edited], freshest);
    const tasks = await this.records('edited tasks', 'task', [edited], freshest);
    const touched = new Map<string, number>();
    const touch = (id: string, at: string): void => {
      touched.set(id, Math.max(touched.get(id) ?? 0, Date.parse(at)));
    };

    for (const project of projects) touch(project.pageId, project.lastEditedAt);
    for (const task of tasks) {
      const linked = linkedPageIds(task.readings.project);

      if (!isUndetermined(linked)) for (const id of linked) touch(id, task.lastEditedAt);
    }

    const known: Known<'project'> = new Map(projects.map((p) => [p.pageId, p]));
    const chosen = [...touched.entries()]
      .sort(([, one], [, other]) => other - one)
      .slice(0, this.config.projectsPerTick)
      .map(([id]) => id);
    const found: Candidate[] = [];

    for (const id of chosen) {
      const project = known.get(id) ?? (await this.readOrNothing('project', id));

      if (project) found.push(...(await this.projectSituations(project)));
    }

    return found;
  }

  private async projectSituations(project: DecodedRecord<'project'>): Promise<Candidate[]> {
    const { records, complete } = await this.query.records(
      'task',
      [{ field: 'project', linksTo: project.pageId }],
      MAX_PROJECT_TASKS,
    );

    // The rules read all the Tasks of a Project: a Task beyond the limit could be the one that
    // moves the work, so a partial list gives a false situation.
    if (!complete) {
      this.logger.warn(
        `sweep: project ${canonicalNotionId(project.pageId)} not judged — it has more than ` +
          `${MAX_PROJECT_TASKS} Tasks`,
      );

      return [];
    }

    const tasks: Known<'task'> = new Map(records.map((task) => [task.pageId, task]));
    const situation = structural([project, ...records]);
    const rules: SweepRule[] = [];

    if (projectPath(project, tasks).state === 'stalled') rules.push('project_path');
    if (pausedCommitments(project, tasks).state === 'to_decide') rules.push('paused_commitment');
    if (closureObligations(project, tasks).state === 'unsettled') rules.push('project_closure');

    return rules.map((rule) => ({ pageId: canonicalNotionId(project.pageId), rule, ...situation }));
  }

  /**
   * Finds Tasks whose status contradicts a dependency: a `Next Action` with an unresolved
   * blocker, a `Waiting For` that has nothing left to wait for. A blocker that changed changes
   * the situation of the dependent Task, so the query asks for all dependent Tasks, the most
   * recently edited first, and recency is measured from an edit to any of the participants.
   */
  private async dependencies(): Promise<TaskSituation[]> {
    const records = await this.records(
      'dependencies',
      'task',
      [
        { field: 'status', anyOf: DEPENDENT },
        { field: 'dependencies', linked: true },
      ],
      { edited: 'descending' },
    );
    const blockers: Known<'task'> = new Map();
    let reads = 0;
    const found: TaskSituation[] = [];

    for (const listed of records) {
      const ids = linkedPageIds(listed.readings.dependencies);

      if (isUndetermined(ids)) continue;

      for (const id of ids) {
        if (blockers.has(id) || reads >= this.config.blockersPerTick) continue;

        reads += 1;

        const blocker = await this.readOrNothing('task', id);

        if (blocker) blockers.set(id, blocker);
      }

      let task = listed;
      let verdict = dependencyConsistency(task, blockers);

      // A `Waiting For` says in its body whether there is still something to wait for, and the
      // query does not read the body: it is read separately only for a Task with nothing left.
      if (verdict.state === 'undetermined' && verdict.because === 'unread') {
        task = await this.reader.read('task', listed.pageId, { withBody: true });
        verdict = dependencyConsistency(task, blockers);
      }

      if (verdict.state !== 'contradiction') continue;

      const involved = ids.flatMap((id) => {
        const blocker = blockers.get(id);

        return blocker ? [blocker] : [];
      });

      found.push({
        task,
        candidate: {
          pageId: canonicalNotionId(task.pageId),
          rule: 'dependency_contradiction',
          ...structural([task, ...involved]),
        },
      });
    }

    return found;
  }

  /**
   * Keeps the situations of Tasks that stand alone. A Task of a paused or closed Project is not
   * woken separately: the Project carries the situation, and the Project's own rules wake it. A
   * Project that was not read does not hide the Task, so the candidate stays.
   */
  private async standalone(
    found: readonly TaskSituation[],
    projects: ProjectsOfTick,
  ): Promise<Candidate[]> {
    const kept: Candidate[] = [];

    for (const { task, candidate } of found) {
      const ids = linkedPageIds(task.readings.project);

      if (!isUndetermined(ids)) for (const id of ids) await this.know(id, projects);

      const link = projectLinkOf(task, projects.known);
      const held =
        !isUndetermined(link) &&
        link.kind === 'record' &&
        HOLDS_ITS_TASKS.has(phaseOf(link.project.readings.status).state);

      if (!held) kept.push(candidate);
    }

    return kept;
  }

  /** Reads a Task's Project, if the tick has not read it yet and has a read left for it. */
  private async know(projectId: string, projects: ProjectsOfTick): Promise<void> {
    if (projects.known.has(projectId) || projects.reads >= this.config.projectsPerTick) return;

    projects.reads += 1;

    const project = await this.readOrNothing('project', projectId);

    if (project) projects.known.set(projectId, project);
  }

  /**
   * Returns the records that satisfy the conditions, no more than the query limit. A selection the
   * limit truncated is visible in the log: what was cut off is older, and a review will bring it
   * up.
   */
  private async records<T extends 'task' | 'project'>(
    group: string,
    type: T,
    where: readonly RecordFilter<T>[],
    order: RecordOrder<T>,
  ): Promise<readonly DecodedRecord<T>[]> {
    const limit = this.config.queryLimit;
    const found = await this.query.records(type, where, limit, order);

    if (!found.complete) {
      this.logger.warn(
        `sweep: ${group} gave more than ${limit} records — the oldest wait for a review`,
      );
    }

    return found.records;
  }

  /**
   * Returns the record by id. A page that does not exist for the integration does not exist here
   * either.
   */
  private async readOrNothing<T extends 'task' | 'project'>(
    type: T,
    pageId: string,
  ): Promise<DecodedRecord<T> | null> {
    try {
      return await this.reader.read(type, pageId);
    } catch (error) {
      if (notionFailureOf(error) === 'absent') return null;

      throw error;
    }
  }

  /**
   * Returns the local date `days` days from `now`. It is a query bound that is a day wider than
   * the rule.
   */
  private dateAfter(now: Date, days: number): string {
    const { year, month, day } = localDateAt(this.app.timeZone, addDays(now, days));

    return `${year}-${pad(month)}-${pad(day)}`;
  }

  /**
   * Returns the instant of a date using the installation's time rule
   * (`docs/2-system.md` § “Schedule and recurrence”).
   */
  private readonly place: PlaceDate = (date, edge) =>
    momentOfCalendarValue(date, this.app.timeZone, edge)?.getTime() ?? null;
}

/**
 * Returns the basis and recency of a structural situation: the last edit of any of the
 * participants. A new edit is a new basis: if the situation remained after that edit, it is worth
 * seeing again.
 */
function structural(
  records: readonly DecodedRecord<'task' | 'project'>[],
): Pick<Candidate, 'basis' | 'since' | 'pages'> {
  const since = new Date(Math.max(...records.map((record) => Date.parse(record.lastEditedAt))));

  return {
    basis: `edited:${since.toISOString()}`,
    since,
    pages: records.map((record) => canonicalNotionId(record.pageId)),
  };
}

/** Returns a date value as the text of the basis. */
function dateText(reading: Reading): string {
  return reading.state === 'value' && reading.value.type === 'date'
    ? `${reading.value.start}/${reading.value.timeZone ?? ''}`
    : reading.state;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
