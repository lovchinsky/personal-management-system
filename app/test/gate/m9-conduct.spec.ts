import { dayOf, FakeM9Port, type FakeRun } from '../fixtures/m9-port.fixture';
import type { Claim } from './gate-claims';
import { emptyResidue } from './gate-cleanup';
import { SCENARIOS, type ScenarioId, type ScenarioInfo } from './m6-scenarios';
import { m9Conductors } from './m9-conduct';
import { AP4_MOVED_IN_DAYS } from './m9-scenarios';

function info(id: ScenarioId): ScenarioInfo {
  const found = SCENARIOS.find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`no scenario ${id}`);

  return found;
}

/** Conducts a scenario over a fake port: the first trial of the first attempt. */
async function conduct(port: FakeM9Port, id: ScenarioId): Promise<Claim> {
  const conductor = m9Conductors(port)[id];

  if (conductor === undefined) throw new Error(`no conductor for ${id}`);

  return conductor(
    info(id),
    { run: '4821', scenario: id, trial: 1, attempt: 0 },
    emptyResidue(),
    (e) => e,
  );
}

const failedIn = (claim: Claim): string[] =>
  claim.observations
    .filter((observation) => !observation.ok)
    .map((observation) => observation.item);

const STATUS = 'status-property';
const DATE = 'date-property';
const DEADLINE = 'deadline-property';

/**
 * Returns a run that remembers the first proposal, because the next run of the scenario relies on
 * it.
 */
function remembering(into: { id: string }, run: FakeRun): FakeRun {
  return (port, step) => {
    const evidence = run(port, step);

    into.id = evidence.proposed[0]?.id ?? '';

    return evidence;
  };
}

describe('gate M9 conductors', () => {
  describe('AP1', () => {
    const done: FakeRun = (port, step) =>
      port.ran(step, { propose: [{ page: 'badges', values: { [STATUS]: 'Done' } }], notify: [0] });

    it('the claim holds for a proposal, a “yes” that is not a decision and a press on the notification of run 2', async () => {
      const port = new FakeM9Port();
      const first = { id: '' };

      port.runs.push(remembering(first, done), (p, step) => p.ran(step, { notify: [first.id] }));

      const claim = await conduct(port, 'AP1_proposal_approved');

      expect(failedIn(claim)).toEqual([]);
      expect(port.calls).toEqual([
        'allowance:event_evaluation',
        'build',
        'notify:badges',
        'reply:2147483648',
        'run:reply',
        'executor',
        'deliver',
        'reply:2147483649',
        'run:confirm',
        'executor',
        'deliver',
        'press:approve:2147483650',
        'executor',
        'publication',
      ]);
    });

    it('without a notification in run 2 the press is on the notification of run 1', async () => {
      const port = new FakeM9Port();

      port.runs.push(done, (p, step) => p.ran(step, {}));

      const claim = await conduct(port, 'AP1_proposal_approved');

      expect(port.calls).toContain('press:approve:2147483649');
      expect(failedIn(claim)).toEqual(['run 2: the notification carries the same proposal']);
    });

    it('a new proposal in reply to a “yes” fails run 2', async () => {
      const port = new FakeM9Port();
      const first = { id: '' };

      port.runs.push(remembering(first, done), (p, step) =>
        p.ran(step, {
          propose: [{ page: 'hall', values: { [STATUS]: 'Done' } }],
          notify: [first.id, 0],
        }),
      );

      expect(failedIn(await conduct(port, 'AP1_proposal_approved'))).toEqual([
        'run 2: no new proposal',
      ]);
    });

    it('a proposal and a notification outside the conversation thread fail, because a “yes” has nowhere to land', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) =>
        p.ran(
          step,
          { propose: [{ page: 'badges', values: { [STATUS]: 'Done' } }], notify: [0] },
          null,
        ),
      );

      expect(failedIn(await conduct(port, 'AP1_proposal_approved'))).toEqual([
        'run 1: the proposal lives in the thread of the conversation',
        'run 1: the notification lives in the thread of the conversation',
        'run 2: the person answers yes to the notification',
      ]);
    });

    it('a proposal not on the Task stops the scenario, because the gate will not press on a foreign change', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) =>
        p.ran(step, { propose: [{ page: 'project', values: { [STATUS]: 'Done' } }], notify: [0] }),
      );

      const claim = await conduct(port, 'AP1_proposal_approved');

      expect(port.calls.some((call) => call.startsWith('press'))).toBe(false);
      expect(port.runs).toHaveLength(0);
      expect(failedIn(claim)).toEqual([
        'run 1: the proposal marks only the task Done',
        'run 2: the person answers yes to the notification',
      ]);
    });
  });

  describe('AP2', () => {
    const start: FakeRun = (port, step) =>
      port.ran(step, {
        propose: [{ page: 'report', values: { [STATUS]: 'Next Action', [DATE]: 'clear' } }],
        notify: [0],
      });

    it('when the person outpaces the proposal, the new one with its preconditions holds', async () => {
      const port = new FakeM9Port();

      port.runs.push(start, start);

      const claim = await conduct(port, 'AP2_outpaced_reproposed');

      expect(failedIn(claim)).toEqual([]);
      expect(port.calls.slice(4)).toEqual([
        'run:reply',
        'executor',
        'deliver',
        'edit:report',
        'executor',
        'publication',
        'comment:report',
        'run:thread',
        'executor',
      ]);
      expect(port.said).toHaveLength(2);
    });

    it('a proposal that does not clear Date fails run 1, and the scenario goes no further', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) =>
        p.ran(step, {
          propose: [{ page: 'report', values: { [STATUS]: 'Next Action' } }],
          notify: [0],
        }),
      );

      const claim = await conduct(port, 'AP2_outpaced_reproposed');

      expect(failedIn(claim)).toEqual([
        'run 1: the proposal makes the task a Next Action and clears its Date in one contract',
        'outpaced: the person outpaces the proposal',
      ]);
      expect(port.calls).not.toContain('edit:report');
    });

    it('on “давай зараз” without a new proposal, run 2 fails', async () => {
      const port = new FakeM9Port();

      port.runs.push(start, (p, step) => p.ran(step, {}));

      expect(failedIn(await conduct(port, 'AP2_outpaced_reproposed'))).toEqual([
        'run 2: exactly one new proposal',
        'run 2: the new proposal makes the same change',
        'run 2: the proposal lives in the thread of the conversation',
        'run 2: the notification carries the new proposal',
        'run 2: the conditions of the new proposal read the page as the person left it',
      ]);
    });
  });

  describe('AP3', () => {
    it('the claim holds when the run does not propose the same change after a rejection', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) => p.ran(step, {}));

      const claim = await conduct(port, 'AP3_rejected_kept');

      expect(failedIn(claim)).toEqual([]);
      expect(port.calls.slice(2)).toEqual([
        'propose:movers',
        'deliver',
        'press:reject:2147483648',
        'executor',
        'publication',
        'run:recheck',
        'executor',
      ]);
    });

    it.each([
      ['the same change', { [STATUS]: 'Next Action' }],
      ['the same change together with another', { [STATUS]: 'Next Action', [DATE]: 'clear' }],
    ])('%s proposed again fails', async (_case, values) => {
      const port = new FakeM9Port();

      port.runs.push((p, step) =>
        p.ran(step, { propose: [{ page: 'movers', values }], notify: [0] }),
      );

      expect(failedIn(await conduct(port, 'AP3_rejected_kept'))).toEqual([
        'recheck: the run proposes the rejected change no more',
        'recheck: no notification carries the rejected change',
      ]);
    });
  });

  describe('AP5', () => {
    it('without a rejection, the claim holds when the recheck proposes Next Action and says so', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) =>
        p.ran(step, {
          propose: [{ page: 'movers', values: { [STATUS]: 'Next Action' } }],
          notify: [0],
        }),
      );

      const claim = await conduct(port, 'AP5_unblocked_proposed');

      expect(failedIn(claim)).toEqual([]);
      expect(port.calls.slice(2)).toEqual(['notify:movers', 'run:recheck', 'executor']);
    });

    it('a silent recheck fails the control, because the silence of AP3 proves nothing', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) => p.ran(step, {}));

      expect(failedIn(await conduct(port, 'AP5_unblocked_proposed'))).toEqual([
        'one proposal moves the task to Next Action',
        'the notification carries it',
      ]);
    });
  });

  describe('AP4', () => {
    const target = dayOf(AP4_MOVED_IN_DAYS);

    it('exactly the named date with a precondition on the current deadline holds', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) =>
        p.ran(step, { propose: [{ page: 'copy', values: { [DEADLINE]: target } }], notify: [0] }),
      );

      const claim = await conduct(port, 'AP4_deadline_instruction');

      expect(failedIn(claim)).toEqual([]);
      expect(port.said[0]).toMatch(/\d{1,2} (листопада|грудня)/);
      expect(port.calls.slice(-2)).toEqual(['run:reply', 'executor']);
    });

    it('a different date fails', async () => {
      const port = new FakeM9Port();

      port.runs.push((p, step) =>
        p.ran(step, {
          propose: [{ page: 'copy', values: { [DEADLINE]: dayOf(AP4_MOVED_IN_DAYS + 1) } }],
          notify: [0],
        }),
      );

      expect(failedIn(await conduct(port, 'AP4_deadline_instruction'))).toEqual([
        'the proposal moves exactly the Deadline to the named date',
      ]);
    });
  });
});
