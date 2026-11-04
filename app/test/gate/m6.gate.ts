import { launchGate } from './gate-boot';
import { optionsOf } from './m6-options';

/**
 * The gate M6 command (`docs/5-plan.md` § “M6 — Universal Detector”):
 *
 *   ./bin/gate m6 [--only=U1,W1 | --preflight] [--trials=3] [--recorded-trials=1]
 *                 [--without-held-out] > gate-m6.json
 *
 * It works as gate M3, M4 and M5 do: in the gate environment (ADR 0041) a second App instance
 * starts on the loopback port `GATE_PORT` (3100 by default), with the runner enabled and the
 * workers off. The difference is the measurement. Every blocking scenario is conducted `--trials`
 * times with a fresh world (recorded ones, `--recorded-trials` times), and the trials run
 * round-robin over all the scenarios. The verdict reports the shares and the digests of the Skill,
 * the schema and the gate, and it leaves the run texts for reading.
 *
 * The runs spend the plan quota of the same subscription as interactive work (the verdict states
 * the ceiling).
 */
launchGate('m6', () => {
  const options = optionsOf(process.argv.slice(2));

  return import('./m6-gate.js').then(({ runGate }) => runGate(options));
});
