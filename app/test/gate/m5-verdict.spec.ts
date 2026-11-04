import { standingOf } from './gate-attempts';
import type { Claim } from './gate-claims';
import { runsOf, trialOf, type Attempt } from './m5-verdict';

const HELD: Claim = {
  ok: true,
  observations: [{ item: 'x', expected: true, actual: true, ok: true, kind: 'effect' }],
  unobserved: [],
};
const BROKEN: Claim = {
  ...HELD,
  ok: false,
  observations: [{ item: 'x', expected: true, actual: false, ok: false, kind: 'effect' }],
};

const judged = (claim: Claim): Attempt => ({ kind: 'judged', claim, runs: [] });

describe('a scenario attempt and its kind', () => {
  it('a claim that holds in full yields `held`', () => {
    expect(trialOf(judged(HELD))).toBe('held');
  });

  it('a violated claim yields `broke`', () => {
    expect(trialOf(judged(BROKEN))).toBe('broke');
  });

  it('a step without the person yields `incomplete`, both with a claim and without one', () => {
    expect(trialOf(judged({ ...HELD, unobserved: ['closure of the resolved thread'] }))).toBe(
      'incomplete',
    );
    expect(trialOf({ kind: 'waiting', unobserved: ['closure'], runs: [] })).toBe('incomplete');
  });

  it('a failure while conducting yields `errored`', () => {
    expect(trialOf({ kind: 'error', error: 'fetch failed', runs: [] })).toBe('errored');
  });

  /** A claim that holds but leaves a step unobserved does not yield `proven`. */
  it('a non-empty `unobserved` does not yield `proven`', () => {
    const attempts: Attempt[] = [
      judged({ ...HELD, unobserved: ['closure of the resolved thread'] }),
    ];

    expect(standingOf(attempts.map(trialOf))).toBe('not_proven');
  });

  it('a failure and a retry that holds yield `proven`; a violation yields `failed` with no retry', () => {
    const thrown: Attempt = { kind: 'error', error: 'x', runs: [] };

    expect(standingOf([thrown, judged(HELD)].map(trialOf))).toBe('proven');
    expect(standingOf([judged(BROKEN)].map(trialOf))).toBe('failed');
  });
});

describe('cost', () => {
  it('a scenario without a person does not count the steps that need one', () => {
    expect(runsOf('S1_dependency_slice', false)).toBe(3);
    expect(runsOf('S6_closure_decision', false)).toBe(0);
  });

  it('with an operator present the closure steps are added', () => {
    expect(runsOf('S1_dependency_slice', true)).toBe(4);
    expect(runsOf('S6_closure_decision', true)).toBe(1);
  });

  it('the rest take one run each, S4 takes two', () => {
    expect(runsOf('S2_alternative_path', true)).toBe(1);
    expect(runsOf('S4_terminal_project', false)).toBe(2);
  });
});
