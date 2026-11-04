import { launchGate } from './gate-boot';
import { optionsOf } from './m6-options';

/**
 * The gate M9 command (`docs/5-plan.md` § “M9 — Approvals by behavioral criteria”):
 *
 *   ./bin/gate m9 [--only=AP1,AP3 | --preflight] [--trials=3] > gate-m9.json
 *
 * The harness is the same as in gates M6–M8 (attempts, trials, fingerprints, verdict), applied to
 * run proposals and the person's decisions. The model-free checks prove the approval chain live:
 * delivery through the Bot API listener of the gate environment, button presses, and executor and
 * publication ticks. Scenarios AP1–AP4 measure what the model proposes and whom it tells about it.
 *
 * The gate writes the person's edits and comments in Notion with a personal token
 * (`GATE_NOTION_PERSONAL_TOKEN`).
 */
launchGate('m9', () => {
  const options = optionsOf(process.argv.slice(2), 'm9');

  return import('./m6-gate.js').then(({ runGate }) => runGate(options));
});
