import { launchGate, type GateResult } from './gate-boot';
import { optionsOf } from './m6-options';

/**
 * The gate M8 command (`docs/5-plan.md` § “M8 — Time-based cognition and reviews”):
 *
 *   ./bin/gate m8 --seed
 *   ./bin/gate m8 [--only=D1,W1 | --preflight] [--trials=3] [--recorded-trials=1] [--manual]
 *
 * `--seed` seeds the stale Inbox items that the reviews rely on (`m8-fixtures.ts`): they become
 * stale after a few days, so they are seeded in advance and persist between gate runs. The verdict
 * of the seeding says what was seeded, what stayed and when the items will become stale.
 *
 * Without `--seed` the command uses the same harness as gates M6 and M7 (attempts, trials,
 * fingerprints, verdict), over scheduled reviews, the sweep, the reconciliation of resolved threads
 * and ingress by page content. `--manual` means an operator is at hand and resolves a thread in
 * Notion when the gate asks.
 */
launchGate('m8', () => {
  const args = process.argv.slice(2);

  if (args.includes('--seed')) {
    if (args.length !== 1) throw new Error('gate M8: --seed takes no other argument');

    return seed();
  }

  const options = optionsOf(args, 'm8');

  return import('./m6-gate.js').then(({ runGate }) => runGate(options));
});

async function seed(): Promise<GateResult> {
  const [{ GateSession }, { Fixtures }] = await Promise.all([
    import('./gate-session.js'),
    import('./m8-fixtures.js'),
  ]);
  const session = await GateSession.open('m8');

  try {
    const report = await new Fixtures(session.app).seed();

    session.report(report);

    return { ok: report.problems.length === 0, clean: true };
  } finally {
    await session.close();
  }
}
