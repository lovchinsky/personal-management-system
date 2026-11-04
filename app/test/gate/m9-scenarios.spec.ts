import { scenariosOf, worldOf, type ScenarioInfo } from './m6-scenarios';
import {
  AP1_DONE,
  AP1_YES,
  AP2_NOW,
  AP2_START,
  AP3_PROPOSAL,
  AP4_MOVE,
  M9_PROCEDURES,
  spokenDate,
} from './m9-scenarios';

const TAG = '4821-ap-1';

const pageOf = (id: ScenarioInfo['id'], key: string) => {
  const page = worldOf(id, TAG).find((candidate) => candidate.key === key);

  if (page === undefined) throw new Error(`the world of ${id} has no ${key}`);

  return page;
};

/** Scenarios of gate M9: the world of each says what its claim rests on. */
describe('gate M9 scenarios', () => {
  it('AP1–AP4 are blocking, 6 runs per trial; AP5 is a recorded control of AP3', () => {
    const suite = scenariosOf('m9');
    const blocking = suite.filter((info) => info.tier === 'blocking');

    expect(suite.map((info) => [info.id, info.tier, info.models, info.budgeted])).toEqual([
      ['AP1_proposal_approved', 'blocking', 2, 0],
      ['AP2_outpaced_reproposed', 'blocking', 2, 0],
      ['AP3_rejected_kept', 'blocking', 1, 1],
      ['AP4_deadline_instruction', 'blocking', 1, 0],
      ['AP5_unblocked_proposed', 'recorded', 1, 1],
    ]);
    expect(blocking.reduce((sum, info) => sum + info.models, 0)).toBe(6);
  });

  /**
   * The control differs from AP3 only in the thread: otherwise the silence of AP3 and the proposal
   * of AP5 would not be comparable.
   */
  it('AP5 is the same world as AP3', () => {
    expect(worldOf('AP5_unblocked_proposed', TAG)).toEqual(worldOf('AP3_rejected_kept', TAG));
    expect(M9_PROCEDURES.AP5_unblocked_proposed.replies).toBe(false);
  });

  it('AP1: the Project has other open work, so closing it is not a legitimate step', () => {
    expect(pageOf('AP1_proposal_approved', 'badges')).toMatchObject({ status: 'Waiting For' });
    expect(pageOf('AP1_proposal_approved', 'hall')).toMatchObject({
      status: 'Next Action',
      project: 'project',
    });
  });

  it('AP2: a Waiting For with a date that the proposal must clear', () => {
    expect(pageOf('AP2_outpaced_reproposed', 'report')).toMatchObject({
      status: 'Waiting For',
      dateInDays: 0,
    });
    expect(M9_PROCEDURES.AP2_outpaced_reproposed.slots).toEqual(['task.status', 'task.date']);
  });

  it('AP3: the blocker is Done, and the proposal reads the Task status as built', () => {
    expect(pageOf('AP3_rejected_kept', 'lease')).toMatchObject({ status: 'Done' });
    expect(pageOf('AP3_rejected_kept', AP3_PROPOSAL.page)).toMatchObject({
      status: AP3_PROPOSAL.from,
      blockedBy: ['lease'],
    });
  });

  it('AP4: a Next Action with a deadline', () => {
    expect(pageOf('AP4_deadline_instruction', 'copy')).toMatchObject({
      status: 'Next Action',
      deadlineInDays: 4,
    });
  });

  it("the person's words come in three variants per step, and the three acceptance trials see them all", () => {
    for (const pool of [AP1_DONE, AP1_YES, AP2_START, AP2_NOW, AP4_MOVE]) {
      expect(pool).toHaveLength(3);
    }
  });

  it("a date in the person's words has the year only when it is not the current year", () => {
    expect(spokenDate('2026-11-07', '2026-10-26')).toBe('7 листопада');
    expect(spokenDate('2027-01-06', '2026-12-25')).toBe('6 січня 2027 року');
  });
});
