/**
 * Comparison of gate M6 verdicts: the baseline and the candidate by the rule fixed before the
 * candidate's run (`docs/5-plan.md` § “M6 — Universal Detector”, `infra/GATE.md` § “Gate M6”).
 * The gate is a smoke acceptance test. This command does the comparison, because three trials per
 * scenario show only large differences.
 *
 *   npm run gate:compare -- baseline.json candidate.json [--confirm=file.json] [--targets=U1,W1]
 *
 * Verdicts with a different gate, schema, model or time zone are incomparable, and the command
 * refuses them. Exit code: 0 means the rule holds on the full set, 1 means it does not, and 2
 * means an invocation with an error, or verdicts that are incomparable or incomplete (a stopped
 * verdict, a blocking scenario without two judged trials).
 */
import { readFileSync } from 'node:fs';
import { messageOf } from '../src/platform/error/message-of';
import {
  compare,
  compareArguments,
  compareExitCode,
  parseVerdict,
  renderComparison,
  type Verdict,
} from '../test/gate/m6-compare';

function verdictAt(path: string): Verdict {
  return parseVerdict(JSON.parse(readFileSync(path, 'utf8')), path);
}

function main(args: readonly string[]): void {
  const given = compareArguments(args);
  const comparison = compare(verdictAt(given.baseline), verdictAt(given.candidate), {
    targets: given.targets,
    confirmations: given.confirmations.map((name) => ({ name, verdict: verdictAt(name) })),
  });

  process.stdout.write(renderComparison(comparison));
  process.exitCode = compareExitCode(comparison);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`gate:compare: ${messageOf(error)}\n`);
  process.exitCode = 2;
}
