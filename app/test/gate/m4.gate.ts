import { launchGate } from './gate-boot';

/**
 * The gate M4 command (`docs/5-plan.md` § “M4 — Skill v1, dialogue, capture”):
 *
 *   ./bin/gate m4 > gate-m4.json
 *
 * It works as gate M3 does: in the gate environment (ADR 0041) a second App instance starts on
 * the loopback port `GATE_PORT` (3100 by default), with the runner enabled and the workers off.
 * The difference is that the runs go through the real Skill, not through the gate's own
 * instructions, and what they left in Notion is what gets checked.
 *
 * The runs spend the plan quota of the same subscription as interactive work (the verdict states
 * the ceiling).
 */
launchGate('m4', () => import('./m4-gate.js').then(({ runGate }) => runGate()));
