import { launchGate } from './gate-boot';
import { optionsOf } from './m5-options';

/**
 * The command for gate M5 (`docs/5-plan.md` § “M5 — Canonical domain behavior and vertical
 * slice”):
 *
 *   ./bin/gate m5 [--only=S1,S4 | --preflight] [--manual] > gate-m5.json
 *
 * It works as gate M3 and gate M4 do: in the gate environment (ADR 0041) a second App instance
 * starts on the loopback port `GATE_PORT` (3100 by default), with the runner enabled and the
 * workers off. The difference is the world: Projects, Tasks with relations, Areas of Focus and
 * threads in a real workspace, and runs of the real Skill over that world.
 *
 * The runs spend the plan quota of the same subscription as interactive work (the verdict names
 * the ceiling).
 */
launchGate('m5', () => {
  const options = optionsOf(process.argv.slice(2));

  return import('./m5-gate.js').then(({ runGate }) => runGate(options));
});
