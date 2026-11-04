import { ReasonCode, RunOrigin } from '../../src/generated/prisma/enums';
import {
  budgetClassOf,
  DELEGATING_ORIGINS,
  ScheduledOrigin,
  ScheduledProvenance,
  UNSCHEDULED_ORIGINS,
} from '../../src/runs/provenance';
import {
  byPriority,
  CLASS_OF_ORIGIN,
  CLASS_OF_REASON,
  PRIORITY_CLASSES,
  priorityClassOf,
  Ranked,
} from '../../src/runs/run-priority';
import { canonical } from './contracts';

const declared = canonical.runPriority();

/** Origins that classify themselves and that the scheduler manages. */
const SELF_CLASSIFIED = Object.values(RunOrigin).filter(
  (origin): origin is ScheduledOrigin => origin in CLASS_OF_ORIGIN,
);

/** Every origin the scheduler manages: it classifies itself or delegates to its reason. */
const SCHEDULED: readonly ScheduledProvenance[] = [
  ...SELF_CLASSIFIED.map((origin): ScheduledProvenance => ({ origin })),
  ...Object.values(ReasonCode).map((reasonCode): ScheduledProvenance => ({
    origin: 'scheduled_check',
    reasonCode,
  })),
];

function names<K extends string>(classOf: Readonly<Record<K, string>>, name: string): string[] {
  return Object.entries<string>(classOf)
    .filter(([, of]) => of === name)
    .map(([key]) => key)
    .sort();
}

/**
 * `INV-085` The scheduler takes due origins in the order of `run_priority`: the class, then fresh
 * before retried, then the earlier time. The `autonomous` class is exactly the budgeted origins of
 * `run_budget`.
 */
describe('INV-085', () => {
  it('the classes and their order match the contract', () => {
    expect([...PRIORITY_CLASSES]).toEqual(declared.classes.map((entry) => entry.name));
  });

  it.each(declared.classes)('the makeup of class $name matches the contract', (entry) => {
    expect(names(CLASS_OF_ORIGIN, entry.name)).toEqual([...entry.origins].sort());
    expect(names(CLASS_OF_REASON, entry.name)).toEqual([...entry.reason_codes].sort());
  });

  it('the delegating and unscheduled origins match the contract', () => {
    expect([...DELEGATING_ORIGINS]).toEqual(declared.delegating_origins);
    expect([...UNSCHEDULED_ORIGINS]).toEqual(declared.unscheduled_origins);
  });

  /**
   * A new origin or reason that is not given a class is an error here, not a row that would
   * silently end up last or first.
   */
  it('every origin and every reason has exactly one place', () => {
    const origins = [
      ...declared.classes.flatMap((entry) => entry.origins),
      ...declared.delegating_origins,
      ...declared.unscheduled_origins,
    ];
    const reasons = declared.classes.flatMap((entry) => entry.reason_codes);

    expect([...origins].sort()).toEqual([...Object.values(RunOrigin)].sort());
    expect(new Set(origins).size).toBe(origins.length);
    expect([...reasons].sort()).toEqual([...Object.values(ReasonCode)].sort());
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  /**
   * Only autonomous work is stopped by the breaker and the daily limit. Because it ranks last, it
   * does not delay what the person asked for.
   */
  it.each(SCHEDULED)('$origin $reasonCode: autonomous exactly when budgeted', (provenance) => {
    expect(priorityClassOf(provenance) === 'autonomous').toBe(
      budgetClassOf(provenance) === 'budgeted',
    );
  });

  describe('order', () => {
    const at = (minutes: number): Date => new Date(Date.UTC(2026, 8, 29, 9, minutes));
    const snooze = (minutes: number, retried = false): Ranked => ({
      provenance: { origin: 'scheduled_check', reasonCode: 'user_snooze' },
      retried,
      dueAt: at(minutes),
    });
    const window = (minutes: number, retried = false): Ranked => ({
      provenance: { origin: 'evaluation_window' },
      retried,
      dueAt: at(minutes),
    });

    it('the class comes first: a time the person named ranks before an older evaluation window', () => {
      const expected: Ranked[] = [snooze(30), window(0)];

      expect([window(0), snooze(30)].sort(byPriority)).toEqual(expected);
    });

    it('within a class a fresh row ranks before an older retried row', () => {
      const expected: Ranked[] = [window(30), window(0, true)];

      expect([window(0, true), window(30)].sort(byPriority)).toEqual(expected);
    });

    it('among equals the earlier time ranks first', () => {
      const expected: Ranked[] = [snooze(0), snooze(10), snooze(20)];

      expect([snooze(20), snooze(0), snooze(10)].sort(byPriority)).toEqual(expected);
    });
  });
});
