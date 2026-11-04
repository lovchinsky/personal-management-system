import { Records } from '../../test/fixtures/methodology-records';
import { projectPath } from './project-path';

describe('path of a Project in work', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  type Task = ReturnType<Records['task']>;

  const tasks = (...statuses: readonly string[]): Task[] =>
    statuses.map((status, at) => records.task({ id: `task-${at}`, status }));

  const known = (list: readonly Task[]): Map<string, Task> =>
    new Map(list.map((task): [string, Task] => [task.pageId, task]));

  const project = (status: string, list: readonly Task[]): ReturnType<Records['project']> =>
    records.project({ status, tasks: list.map((task) => task.pageId) });

  it.each(['Next Action', 'Scheduled', 'Waiting For'])(
    'Active with a %s Task is `moving`: waiting and scheduling count as movement too',
    (status) => {
      const list = tasks('Done', status);

      expect(projectPath(project('Active', list), known(list))).toEqual({ state: 'moving' });
    },
  );

  it('Active with only Someday/Maybe and closed Tasks left has no path', () => {
    const list = tasks('Done', 'Someday/Maybe', 'Hidden');

    expect(projectPath(project('Active', list), known(list))).toEqual({ state: 'stalled' });
  });

  it('Planning with a clarifying Task of any open status is `moving`', () => {
    const list = tasks('Someday/Maybe');

    expect(projectPath(project('Planning', list), known(list))).toEqual({ state: 'moving' });
  });

  it('Planning with no open Task has no path', () => {
    const list = tasks('Done', 'Canceled');

    expect(projectPath(project('Planning', list), known(list))).toEqual({ state: 'stalled' });
  });

  it('a Project in work with no Tasks has no path', () => {
    expect(projectPath(records.project({ status: 'Active' }), new Map())).toEqual({
      state: 'stalled',
    });
  });

  it.each(['Paused', 'Done', 'Canceled'])('%s is not in work', (status) => {
    const list = tasks('Done');

    expect(projectPath(project(status, list), known(list))).toEqual({ state: 'not_in_work' });
  });

  it('a Task that was not passed to the rule leaves “none” unproven', () => {
    const list = tasks('Done');
    const linked = records.project({ status: 'Active', tasks: ['task-0', 'unread'] });

    expect(projectPath(linked, known(list))).toEqual({
      state: 'unverified',
      unreadable: [{ taskId: 'unread', field: 'record', because: 'task_not_read' }],
    });
  });

  it('one moving Task proves movement even with unreadable neighbors', () => {
    const list = tasks('Next Action');
    const linked = records.project({ status: 'Active', tasks: ['task-0', 'unread'] });

    expect(projectPath(linked, known(list))).toEqual({ state: 'moving' });
  });
});
