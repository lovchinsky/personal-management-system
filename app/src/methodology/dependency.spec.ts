import { Records } from '../../test/fixtures/methodology-records';
import { block } from '../../test/fixtures/notion-page.fixture';
import { dependencyConsistency, dependencyState } from './dependency';

/**
 * A dependency is derived from the “Blocked by” relation and the statuses of the blockers. A
 * blocker is resolved only when it is `Done` or `Canceled`; `Failed` does not resolve it. The
 * answer is assembled from all the blockers: one definitely unresolved blocker proves “blocked”
 * regardless of the rest, while “resolved” needs all of them.
 */
describe('dependency of a Task', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  const blockers = (...statuses: readonly string[]): Map<string, ReturnType<Records['task']>> =>
    new Map(
      statuses.map((status, at): [string, ReturnType<Records['task']>] => [
        `blocker-${at}`,
        records.task({ id: `blocker-${at}`, status }),
      ]),
    );

  const ids = (count: number): string[] =>
    Array.from({ length: count }, (_, at) => `blocker-${at}`);

  const dependent = (status: string, count: number): ReturnType<Records['task']> =>
    records.task({ id: 'dependent', status, dependencies: ids(count) });

  describe('state', () => {
    it('with no relation there are no dependencies', () => {
      expect(dependencyState(dependent('Waiting For', 0), new Map())).toEqual({ state: 'none' });
    });

    it('with neither of two blockers closed it is blocked, and the open ones are named', () => {
      expect(
        dependencyState(dependent('Waiting For', 2), blockers('Next Action', 'Waiting For')),
      ).toEqual({
        state: 'blocked',
        open: ['blocker-0', 'blocker-1'],
        failed: [],
        resolved: [],
        unknown: [],
      });
    });

    /** One closed blocker of two leaves the dependency blocked, because “resolved” needs all. */
    it('with one of two blockers closed it is still blocked', () => {
      expect(dependencyState(dependent('Waiting For', 2), blockers('Done', 'Next Action'))).toEqual(
        {
          state: 'blocked',
          open: ['blocker-1'],
          failed: [],
          resolved: ['blocker-0'],
          unknown: [],
        },
      );
    });

    it.each([
      ['Done', 'Canceled'],
      ['Done', 'Done'],
    ])('with all blockers closed (%s, %s) it is resolved', (...statuses) => {
      expect(dependencyState(dependent('Waiting For', 2), blockers(...statuses))).toEqual({
        state: 'resolved',
        resolved: ['blocker-0', 'blocker-1'],
      });
    });

    it('a `Failed` blocker does not resolve the dependency and is not “open”', () => {
      expect(dependencyState(dependent('Waiting For', 1), blockers('Failed'))).toEqual({
        state: 'blocked',
        open: [],
        failed: ['blocker-0'],
        resolved: [],
        unknown: [],
      });
    });

    it('a blocker the rule was not given is not an answer', () => {
      expect(dependencyState(dependent('Waiting For', 1), new Map())).toEqual({
        state: 'undetermined',
        because: 'blocker_not_read',
      });
    });

    it('a blocker outside the model and a blocker with no status assert nothing', () => {
      expect(dependencyState(dependent('Waiting For', 1), blockers('Hidden'))).toEqual({
        state: 'undetermined',
        because: 'non_canonical',
      });
      expect(dependencyState(dependent('Waiting For', 1), blockers('Blocked'))).toEqual({
        state: 'undetermined',
        because: 'gap',
      });
    });

    /** One open blocker proves “blocked” by itself; another that is unread does not undo that. */
    it('an open blocker proves “blocked” even when another is unread', () => {
      expect(
        dependencyState(dependent('Waiting For', 3), blockers('Hidden', 'Next Action', 'Done')),
      ).toEqual({
        state: 'blocked',
        open: ['blocker-1'],
        failed: [],
        resolved: ['blocker-2'],
        unknown: [{ taskId: 'blocker-0', field: 'status', because: 'non_canonical' }],
      });

      const partial = blockers('Next Action');

      expect(dependencyState(dependent('Waiting For', 2), partial)).toMatchObject({
        state: 'blocked',
        open: ['blocker-0'],
        unknown: [{ taskId: 'blocker-1', field: 'record', because: 'blocker_not_read' }],
      });
    });

    it('“resolved” requires all: one unread blocker among closed ones is not an answer', () => {
      expect(dependencyState(dependent('Waiting For', 2), blockers('Done', 'Blocked'))).toEqual({
        state: 'undetermined',
        because: 'gap',
      });
    });

    it('a truncated list of relations is not taken as complete', () => {
      const truncated = records.task({
        id: 'dependent',
        status: 'Waiting For',
        dependencies: ['blocker-0'],
        dependenciesTruncated: true,
      });

      expect(dependencyState(truncated, blockers('Done'))).toEqual({
        state: 'undetermined',
        because: 'truncated',
      });
    });
  });

  describe('consistency of status with dependency', () => {
    const withBody = (
      status: string,
      count: number,
      body: (typeof block)[],
    ): ReturnType<Records['task']> =>
      records.task({ id: 'dependent', status, dependencies: ids(count), body });

    /** The body was read and is empty: there is nothing left to wait for. */
    it('Waiting For whose blocker is already closed and whose body is empty is a contradiction', () => {
      expect(dependencyConsistency(withBody('Waiting For', 1, []), blockers('Done'))).toEqual({
        state: 'contradiction',
        kind: 'waiting_for_all_blockers_resolved',
      });
    });

    /**
     * The external party that the relation does not express is in the body, and the rule does not
     * read prose.
     */
    it('nothing is asserted for Waiting For with a resolved blocker and prose in the body', () => {
      expect(dependencyConsistency(withBody('Waiting For', 1, [block]), blockers('Done'))).toEqual({
        state: 'undetermined',
        because: 'prose',
      });
    });

    it('an unread body is not an answer either', () => {
      expect(dependencyConsistency(dependent('Waiting For', 1), blockers('Done'))).toEqual({
        state: 'undetermined',
        because: 'unread',
      });
    });

    it('Next Action with an open or a `Failed` blocker is a contradiction', () => {
      expect(dependencyConsistency(dependent('Next Action', 1), blockers('Waiting For'))).toEqual({
        state: 'contradiction',
        kind: 'next_action_with_unresolved_blocker',
      });
      expect(dependencyConsistency(dependent('Next Action', 1), blockers('Failed'))).toEqual({
        state: 'contradiction',
        kind: 'next_action_with_unresolved_blocker',
      });
    });

    it('Waiting For with an open blocker and Next Action with a closed one are consistent', () => {
      expect(dependencyConsistency(dependent('Waiting For', 1), blockers('Next Action'))).toEqual({
        state: 'consistent',
      });
      expect(dependencyConsistency(dependent('Next Action', 1), blockers('Done'))).toEqual({
        state: 'consistent',
      });
    });

    it('Next Action with no dependency relation is consistent, and with an unread blocker is not', () => {
      expect(dependencyConsistency(dependent('Next Action', 0), new Map())).toEqual({
        state: 'consistent',
      });
      expect(dependencyConsistency(dependent('Next Action', 1), new Map())).toEqual({
        state: 'undetermined',
        because: 'blocker_not_read',
      });
    });

    /**
     * `consistent` means the rule was applied and there is no conflict; here there is nothing to
     * compare.
     */
    it.each([
      [
        'Waiting For without a relation: a delegation, the party may be named in the body',
        'Waiting For',
        0,
      ],
      ['Scheduled: the dependency rules do not apply to it', 'Scheduled', 1],
      ['Someday/Maybe', 'Someday/Maybe', 1],
      ['a closed Task', 'Done', 1],
      ['a Task outside the model', 'Hidden', 1],
    ] as const)('%s — not applicable', (_, status, count) => {
      expect(dependencyConsistency(dependent(status, count), blockers('Next Action'))).toEqual({
        state: 'not_applicable',
      });
    });

    it('an unread blocker asserts nothing', () => {
      expect(dependencyConsistency(dependent('Waiting For', 1), new Map())).toEqual({
        state: 'undetermined',
        because: 'blocker_not_read',
      });
    });
  });
});
