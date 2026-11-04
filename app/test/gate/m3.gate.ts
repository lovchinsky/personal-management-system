import { launchGate } from './gate-boot';

/**
 * The gate M3 command (`docs/5-plan.md` § “M3 — App MCP and Agent SDK runner”):
 *
 *   ./bin/gate m3 > gate-m3.json
 *
 * It starts a second App instance in the gate environment (ADR 0041), on the loopback port
 * `GATE_PORT` (3100 by default), with the runner enabled and the background workers off
 * (ADR 0013), and conducts the gate's runs through it. The main App keeps running.
 *
 * `launchGate` sets the environment before the application is built. The verdict is JSON on
 * stdout; the exit code is nonzero if any claim is not proven.
 */
launchGate('m3', () => import('./m3-gate.js').then(({ runGate }) => runGate()));
