import { Records } from '../../test/fixtures/methodology-records';
import { closureObligations } from './project-closure';

/** `SCEN-19-17`: a closed Project leaves no active Tasks out of sight. */
describe('Project closure: what is left to settle', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  type Task = ReturnType<Records['task']>;

  /** Tasks that were read and are named in the Project's relation: `task-0`, `task-1` … */
  const tasks = (...statuses: readonly string[]): Task[] =>
    statuses.map((status, at) => records.task({ id: `task-${at}`, status }));

  const known = (list: readonly Task[]): Map<string, Task> =>
    new Map(list.map((task): [string, Task] => [task.pageId, task]));

  const closed = (status: string, list: readonly Task[]): ReturnType<Records['project']> =>
    records.project({ status, tasks: list.map((task) => task.pageId) });

  it.each(['Done', 'Canceled'])(
    'a closed (%s) Project names every open Task with its status',
    (status) => {
      const list = tasks('Next Action', 'Waiting For', 'Scheduled', 'Someday/Maybe');

      expect(closureObligations(closed(status, list), known(list))).toEqual({
        state: 'unsettled',
        obligations: [
          { taskId: 'task-0', status: 'Next Action' },
          { taskId: 'task-1', status: 'Waiting For' },
          { taskId: 'task-2', status: 'Scheduled' },
          { taskId: 'task-3', status: 'Someday/Maybe' },
        ],
        unreadable: [],
      });
    },
  );

  it('closed Tasks and Hidden ones create no obligations: nothing in the Project that the model manages', () => {
    const list = tasks('Done', 'Canceled', 'Failed', 'Hidden');

    expect(closureObligations(closed('Done', list), known(list))).toEqual({ state: 'settled' });
  });

  it('a Project with no Tasks is `settled`: the relation was read, and it is empty', () => {
    expect(closureObligations(records.project({ status: 'Done' }), new Map())).toEqual({
      state: 'settled',
    });
  });

  /** Tasks are taken from the Project's relation. */
  it("a Task that is not in the Project's relation does not become an obligation", () => {
    const linked = tasks('Done');
    const stranger = records.task({ id: 'stranger', status: 'Next Action' });

    expect(closureObligations(closed('Done', linked), known([...linked, stranger]))).toEqual({
      state: 'settled',
    });
  });

  it('a Task with an unreadable status is not “settled”: there are no obligations, but the result is not `settled` either', () => {
    const list = tasks('Done', 'Blocked');

    expect(closureObligations(closed('Done', list), known(list))).toEqual({
      state: 'unverified',
      unreadable: [{ taskId: 'task-1', field: 'status', because: 'gap' }],
    });
  });

  it('a known open Task proves `unsettled` even when another one was not read', () => {
    const list = tasks('Next Action', 'Blocked');

    expect(closureObligations(closed('Done', list), known(list))).toEqual({
      state: 'unsettled',
      obligations: [{ taskId: 'task-0', status: 'Next Action' }],
      unreadable: [{ taskId: 'task-1', field: 'status', because: 'gap' }],
    });
  });

  /** “Nothing is left” does not follow from “we were given no records”. */
  it("a Task from the Project's relation that was not passed to the rule is not lost silently", () => {
    const list = tasks('Done');
    const project = records.project({ status: 'Done', tasks: ['task-0', 'task-9'] });

    expect(closureObligations(project, known(list))).toEqual({
      state: 'unverified',
      unreadable: [{ taskId: 'task-9', field: 'record', because: 'task_not_read' }],
    });
  });

  it('a known open Task proves `unsettled`, and a Task that was not passed is named beside it', () => {
    const list = tasks('Next Action');
    const project = records.project({ status: 'Done', tasks: ['task-0', 'task-9'] });

    expect(closureObligations(project, known(list))).toEqual({
      state: 'unsettled',
      obligations: [{ taskId: 'task-0', status: 'Next Action' }],
      unreadable: [{ taskId: 'task-9', field: 'record', because: 'task_not_read' }],
    });
  });

  it('a truncated Project relation is not taken as complete', () => {
    expect(
      closureObligations(
        records.project({ status: 'Done', tasks: ['task-0'], tasksTruncated: true }),
        new Map(),
      ),
    ).toEqual({ state: 'undetermined', because: 'truncated' });
  });

  it.each([
    ['Planning', 'in_work'],
    ['Active', 'in_work'],
    ['Paused', 'paused'],
  ] as const)('a Project in status %s has no closure obligations', (status, phase) => {
    expect(closureObligations(records.project({ status }), new Map())).toEqual({
      state: 'not_terminal',
      phase,
    });
  });

  it('a Project status outside the model asserts nothing', () => {
    expect(closureObligations(records.project({ status: 'Sprint' }), new Map())).toEqual({
      state: 'undetermined',
      because: 'gap',
    });
  });
});
