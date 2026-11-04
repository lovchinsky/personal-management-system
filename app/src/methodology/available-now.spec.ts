import { Records } from '../../test/fixtures/methodology-records';
import { availableNowCandidacy, projectLinkOf } from './available-now';
import { TASK_LIFECYCLE } from './lifecycle';

/**
 * `SCEN-19-14`, `-15`, `-24`, `-25`: the mechanical necessary conditions of Available Now.
 * The remaining conditions, the judgment of whoever composes Available Now, are not tested here.
 */
describe('Available Now: necessary conditions', () => {
  let records: Records;

  beforeAll(async () => {
    records = await Records.create();
  });

  /** A standalone Task: no Projects are given to the rule, and there is no relation. */
  const standalone = new Map<string, ReturnType<Records['project']>>();

  describe('standalone Task', () => {
    it('Next Action is a candidate (SCEN-19-24)', () => {
      expect(availableNowCandidacy(records.task({ status: 'Next Action' }), standalone)).toEqual({
        state: 'candidate',
      });
    });

    const others = Object.keys(TASK_LIFECYCLE).filter((status) => status !== 'Next Action');

    it.each(others)('%s is not part of the general Available Now (SCEN-19-25)', (status) => {
      expect(availableNowCandidacy(records.task({ status }), standalone)).toEqual({
        state: 'excluded',
        reason: 'not_next_action',
        status,
      });
    });

    it('Hidden is outside the model and does not get into Available Now', () => {
      expect(availableNowCandidacy(records.task({ status: 'Hidden' }), standalone)).toEqual({
        state: 'excluded',
        reason: 'out_of_scope',
      });
    });

    it('an unknown status asserts nothing', () => {
      expect(availableNowCandidacy(records.task({ status: 'Blocked' }), standalone)).toEqual({
        state: 'undetermined',
        because: 'gap',
      });
    });
  });

  describe('Task of a Project', () => {
    /**
     * Creates a Task that points to Project `p` (in the status passed in), with the Projects that
     * were read.
     */
    const inProject = (
      status: string,
      taskStatus = 'Next Action',
    ): [ReturnType<Records['task']>, Map<string, ReturnType<Records['project']>>] => [
      records.task({ status: taskStatus, project: ['p'] }),
      new Map([['p', records.project({ id: 'p', status })]]),
    ];

    it.each(['Planning', 'Active'])(
      'a Project with status %s does not interfere: Planning can have eligible Tasks (SCEN-19-14)',
      (status) => {
        expect(availableNowCandidacy(...inProject(status))).toEqual({ state: 'candidate' });
      },
    );

    it('a Paused Project suppresses a Task without changing its status (SCEN-19-15)', () => {
      const [next, projects] = inProject('Paused');

      expect(availableNowCandidacy(next, projects)).toEqual({
        state: 'excluded',
        reason: 'project_paused',
      });
      expect(next.readings.status).toEqual({
        state: 'value',
        value: { type: 'option', option: 'Next Action' },
      });
    });

    it.each(['Done', 'Canceled'])(
      'a closed %s Project takes a Task out of Available Now',
      (status) => {
        expect(availableNowCandidacy(...inProject(status))).toEqual({
          state: 'excluded',
          reason: 'project_terminal',
        });
      },
    );

    it('a Project the rule was not given is not an answer but the absence of one', () => {
      const task = records.task({ status: 'Next Action', project: ['project-2'] });

      expect(availableNowCandidacy(task, new Map())).toEqual({
        state: 'undetermined',
        because: 'project_not_read',
      });
    });

    it('a Task with two Project ids, neither given to the rule, yields `ambiguous_link` and asserts nothing', () => {
      const task = records.task({ status: 'Next Action', project: ['a', 'b'] });

      expect(availableNowCandidacy(task, new Map())).toEqual({
        state: 'undetermined',
        because: 'ambiguous_link',
      });
    });

    it('a Project status outside the model asserts nothing', () => {
      expect(availableNowCandidacy(...inProject('Sprint'))).toEqual({
        state: 'undetermined',
        because: 'gap',
      });
    });

    /**
     * A closed Task of a paused Project stays closed, because the first verdict is about the
     * Task's own status.
     */
    it('the Task status decides before the Project does', () => {
      expect(availableNowCandidacy(...inProject('Paused', 'Done'))).toEqual({
        state: 'excluded',
        reason: 'not_next_action',
        status: 'Done',
      });
    });
  });

  describe('Project by the relation of a Task', () => {
    const project = (): ReturnType<Records['project']> =>
      records.project({ id: 'project-1', status: 'Active' });

    it('without a relation the Task is standalone', () => {
      expect(projectLinkOf(records.task({ status: 'Next Action' }), new Map())).toEqual({
        kind: 'none',
      });
    });

    it('a relation to a Project that was read yields its record', () => {
      const known = new Map([['project-1', project()]]);

      expect(
        projectLinkOf(records.task({ status: 'Next Action', project: ['project-1'] }), known),
      ).toEqual({ kind: 'record', project: known.get('project-1') });
    });

    it('a relation to a Project not among those read is unread', () => {
      expect(
        projectLinkOf(records.task({ status: 'Next Action', project: ['project-2'] }), new Map()),
      ).toEqual({ state: 'undetermined', because: 'project_not_read' });
    });

    it('two Projects where the property allows one is an ambiguity', () => {
      expect(
        projectLinkOf(
          records.task({ status: 'Next Action', project: ['project-1', 'project-2'] }),
          new Map(),
        ),
      ).toEqual({ state: 'undetermined', because: 'ambiguous_link' });
    });
  });
});
