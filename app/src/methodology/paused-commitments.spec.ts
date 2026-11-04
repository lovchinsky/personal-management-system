import { Records } from '../../test/fixtures/methodology-records';
import { Read } from '../notion/semantics/reading';
import { pausedCommitments } from './paused-commitments';

const DAY = '2026-10-20';
const TIMED = '2026-10-20T14:00:00.000+03:00';

/** `SCEN-19-15`, `-16`: the pause does not hide Calendar commitments and deadlines. */
describe('a paused Project: what the pause does not hide', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  type Task = ReturnType<Records['task']>;

  const known = (list: readonly Task[]): Map<string, Task> =>
    new Map(list.map((task): [string, Task] => [task.pageId, task]));

  const paused = (list: readonly Task[]): ReturnType<Records['project']> =>
    records.project({ status: 'Paused', tasks: list.map((task) => task.pageId) });

  const decide = (...list: readonly Task[]): ReturnType<typeof pausedCommitments> =>
    pausedCommitments(paused(list), known(list));

  describe('candidate for a question to the person', () => {
    it('a deadline on any open Task', () => {
      expect(
        decide(
          records.task({ id: 'next', status: 'Next Action', deadline: DAY }),
          records.task({ id: 'wait', status: 'Waiting For', deadline: DAY }),
          records.task({ id: 'later', status: 'Someday/Maybe', deadline: DAY }),
          records.task({ id: 'sched', status: 'Scheduled', deadline: DAY }),
        ),
      ).toEqual({
        state: 'to_decide',
        commitments: [
          { taskId: 'next', carries: ['deadline'] },
          { taskId: 'wait', carries: ['deadline'] },
          { taskId: 'later', carries: ['deadline'] },
          { taskId: 'sched', carries: ['deadline'] },
        ],
        unreadable: [],
      });
    });

    it('a date with a time of day on a Scheduled Task is an event, and so is one on a Next Action (a state the person may have left)', () => {
      expect(
        decide(
          records.task({ id: 'sched', status: 'Scheduled', date: TIMED }),
          records.task({ id: 'next', status: 'Next Action', date: TIMED, deadline: DAY }),
        ),
      ).toEqual({
        state: 'to_decide',
        commitments: [
          { taskId: 'sched', carries: ['date'] },
          { taskId: 'next', carries: ['date', 'deadline'] },
        ],
        unreadable: [],
      });
    });
  });

  /** A check date and a return date are times for attention the pause legitimately suppresses. */
  describe('not a candidate', () => {
    it('a date without a time on a Scheduled Task: deferred to a day, not set for a time', () => {
      expect(decide(records.task({ id: 'day', status: 'Scheduled', date: DAY }))).toEqual({
        state: 'clear',
      });
    });

    it.each(['Waiting For', 'Someday/Maybe'])(
      '%s with a date, even one with a time, is a time for attention, not a commitment',
      (status) => {
        expect(
          decide(
            records.task({ id: 'a', status, date: TIMED }),
            records.task({ id: 'b', status, date: DAY }),
          ),
        ).toEqual({ state: 'clear' });
      },
    );

    it('a Task with no time of its own and closed or out-of-model Tasks are not named', () => {
      expect(
        decide(
          records.task({ id: 'plain', status: 'Next Action' }),
          records.task({ id: 'finished', status: 'Done', deadline: DAY }),
          records.task({ id: 'hidden', status: 'Hidden', deadline: DAY }),
        ),
      ).toEqual({ state: 'clear' });
    });
  });

  describe('what cannot be read does not disappear', () => {
    it('a Task whose status cannot be read is `unverified`, not `clear`', () => {
      expect(decide(records.task({ id: 'odd', status: 'Blocked', deadline: DAY }))).toEqual({
        state: 'unverified',
        unreadable: [{ taskId: 'odd', field: 'status', because: 'gap' }],
      });
    });

    it('an unread deadline and an unread Scheduled date are named; a Waiting For date is not read', () => {
      expect(
        decide(
          records.task({ id: 'a', status: 'Next Action' }, { deadline: Read.unread('x') }),
          records.task({ id: 'b', status: 'Scheduled' }, { date: Read.unread('x') }),
          records.task({ id: 'c', status: 'Waiting For' }, { date: Read.unread('x') }),
        ),
      ).toEqual({
        state: 'unverified',
        unreadable: [
          { taskId: 'a', field: 'deadline', because: 'unread' },
          { taskId: 'b', field: 'date', because: 'unread' },
        ],
      });
    });

    it('a known candidate proves `to_decide` even when another Task was not read', () => {
      expect(
        decide(
          records.task({ id: 'due', status: 'Next Action', deadline: DAY }),
          records.task({ id: 'odd', status: 'Blocked' }),
        ),
      ).toEqual({
        state: 'to_decide',
        commitments: [{ taskId: 'due', carries: ['deadline'] }],
        unreadable: [{ taskId: 'odd', field: 'status', because: 'gap' }],
      });
    });

    it("a Task from the Project's relation that was not passed to the rule is not lost silently", () => {
      const project = records.project({ status: 'Paused', tasks: ['gone'] });

      expect(pausedCommitments(project, new Map())).toEqual({
        state: 'unverified',
        unreadable: [{ taskId: 'gone', field: 'record', because: 'task_not_read' }],
      });
    });

    it('a truncated or unread Project relation is not an answer', () => {
      expect(
        pausedCommitments(
          records.project({ status: 'Paused', tasks: ['a'], tasksTruncated: true }),
          new Map(),
        ),
      ).toEqual({ state: 'undetermined', because: 'truncated' });
      expect(
        pausedCommitments(
          records.project({ status: 'Paused' }, { tasks: Read.unread('x') }),
          new Map(),
        ),
      ).toEqual({ state: 'undetermined', because: 'unread' });
    });
  });

  it('a paused Project with no Tasks is `clear`: the relation was read, and it is empty', () => {
    expect(pausedCommitments(records.project({ status: 'Paused' }), new Map())).toEqual({
      state: 'clear',
    });
  });

  it.each(['Planning', 'Active', 'Done', 'Canceled'])(
    'a Project in status %s is not paused',
    (status) => {
      expect(pausedCommitments(records.project({ status }), new Map())).toEqual({
        state: 'not_paused',
      });
    },
  );
});
