import { runnerConfig } from '../claude/runner/runner.config';
import { gbrainConfig } from '../credentials/gbrain/gbrain.config';
import { GbrainToken } from '../credentials/gbrain/gbrain.token';
import { messageOf } from '../platform/error/message-of';
import { anchorsReport, problemsIn, renderReport } from './anchors-report';
import { GbrainClient } from './gbrain-client';

/**
 * Runs the operator command, a read-only check of the anchors in GBrain.
 *
 *   ./bin/dc exec app npm run anchors:check
 *
 * The command uses the same App GBrain client as the runs, configured from the container's
 * environment.
 * Exit code: 0 means no violations, 1 means the anchors have violations, 2 means GBrain could not
 * be read.
 */
async function main(): Promise<void> {
  const client = GbrainClient.of(new GbrainToken(gbrainConfig()), runnerConfig());
  const report = await anchorsReport(client);

  process.stdout.write(renderReport(report));
  process.exitCode = problemsIn(report) === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`anchors:check: ${messageOf(error)}\n`);
  process.exitCode = 2;
});
