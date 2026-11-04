import { launchGate } from './gate-boot';
import { optionsOf } from './m6-options';

/**
 * The gate M7 command (`docs/5-plan.md` § “M7 — GBrain knowledge lifecycle”):
 *
 *   ./bin/gate m7 [--only=H1,H4 | --preflight] [--trials=3] [--recorded-trials=1]
 *                 [--without-held-out] > gate-m7.json
 *
 * It is the same measurement as in gate M6 (attempts, trials, digests, verdict), over other
 * scenarios: what a run leaves in GBrain memory and what it does not. Before the first quota,
 * `--preflight` (and an ordinary launch) checks on a live GBrain the assumptions the scenarios rest
 * on: search by id, a write to a page, drift after a replacement.
 *
 * The runs spend the plan quota of the same subscription (the verdict states the ceiling).
 */
launchGate('m7', () => {
  const options = optionsOf(process.argv.slice(2), 'm7');

  return import('./m6-gate.js').then(({ runGate }) => runGate(options));
});
