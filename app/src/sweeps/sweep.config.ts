import { registerAs, type ConfigType } from '@nestjs/config';

/**
 * Periodic safety sweep and resolved-thread reconciliation: frequency, limits and thresholds.
 *
 * Some of the numbers are contract values: their source is `contracts/canonical.yaml`, key `sweep`,
 * and `sweep-agreement.spec.ts` fails on a discrepancy. The rest are the read limits of one tick:
 * they keep the tick finite and are not contract values.
 */
export const sweepConfig = registerAs('sweep', () => ({
  /** The pause between sweep ticks (contract). */
  tickMinutes: 60,
  /** The most pages the sweep wakes per tick (contract). */
  wakesPerTick: 5,
  /** The most pages the sweep wakes per local day (contract). */
  wakesPerDay: 10,
  /** How many hours a situation stays new to the sweep (contract). */
  recencyHours: 72,
  /** How many days before its deadline a `Waiting For` becomes a risk (contract). */
  deadlineLeadDays: 2,
  /** The pause before the first tick after startup. */
  firstDelayMinutes: 5,
  /** The most records one sweep query returns. */
  queryLimit: 50,
  /** The most Projects a tick reads, together with their Tasks. */
  projectsPerTick: 20,
  /** The most blockers a tick reads. */
  blockersPerTick: 40,
  reconciliation: {
    /** The pause between reconciliation ticks (contract). */
    tickMinutes: 20,
    /** How many days after a system write a thread stays in the reconciliation scope (contract). */
    horizonDays: 14,
    /** The most anchors the reconciliation queries per tick (contract). */
    anchorsPerTick: 20,
    /** The pause before the first tick after startup. */
    firstDelayMinutes: 3,
  },
}));

export type SweepConfig = ConfigType<typeof sweepConfig>;
