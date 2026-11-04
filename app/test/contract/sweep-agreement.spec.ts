import { SweepRule } from '../../src/generated/prisma/enums';
import { sweepConfig } from '../../src/sweeps/sweep.config';
import { canonical, repoFile } from './contracts';

/**
 * The numbers of the sweep and the reconciliation in the code and in the contract are the same.
 *
 * The running App does not read contracts, so the config namespace keeps its own copy of the
 * numbers. A number that diverged from the contract would silently change how many autonomous
 * runs the sweep can wake in a day or how far back the reconciliation looks.
 */
describe('the sweep and the contract', () => {
  it('the frequency, limits and thresholds match', () => {
    const implemented = sweepConfig();
    const declared = canonical.sweep();

    expect({
      tick_minutes: implemented.tickMinutes,
      wakes_per_tick: implemented.wakesPerTick,
      wakes_per_day: implemented.wakesPerDay,
      recency_hours: implemented.recencyHours,
      deadline_lead_days: implemented.deadlineLeadDays,
      reconciliation: {
        tick_minutes: implemented.reconciliation.tickMinutes,
        horizon_days: implemented.reconciliation.horizonDays,
        anchors_per_tick: implemented.reconciliation.anchorsPerTick,
      },
    }).toEqual(declared);
  });

  /** The sweep's limit per day is part of the daily limit on autonomous runs, not on top of it. */
  it('in a day the sweep wakes fewer than the daily limit on autonomous runs', () => {
    expect(canonical.sweep().wakes_per_day).toBeLessThan(canonical.runBudget().daily_limit);
  });

  /**
   * The list of candidates in the norm is the same set of rules the sweep wakes on: a rule the
   * norm does not name would wake without a ground in the description of the system, and a rule
   * that is named but not implemented is a promise.
   */
  it('the candidates in docs/2-system.md are the SweepRule rules', () => {
    const doc = repoFile('docs/2-system.md');
    const section = doc.slice(
      doc.indexOf('#### Periodic safety sweep'),
      doc.indexOf('What the sweep does not take'),
    );
    const named = [...section.matchAll(/\(`([a-z_]+)`\)[;.:]/g)].map((match) => match[1]);

    expect([...named].sort()).toEqual(Object.values(SweepRule).sort());
  });
});
