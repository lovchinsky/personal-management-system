import { randomInt } from 'node:crypto';
import { extname, join } from 'node:path';
import { pluginDigest } from '../../src/claude/runner/plugin-digest';
import { runnerConfig, type RunnerConfig } from '../../src/claude/runner/runner.config';
import type { GateResult } from './gate-boot';
import { cleanupVerdict, UNMANAGED } from './gate-cleanup';
import { GateSession } from './gate-session';
import { SUITES } from './gate-suites';
import { chainConductors, conductAll, type Conducted } from './m6-conduct';
import { gateDigest, schemaDigest } from './m6-fingerprint';
import { LivePort } from './m6-live';
import { selectionOf, type GateOptions } from './m6-options';
import { autonomousRunsOf, planOf, startRefusalOf } from './m6-plan';
import { preflight } from './m6-preflight';
import { verdictOf } from './m6-verdict';
import { NotionAllowance } from './notion-allowance';

/**
 * What the gate does not clean up by construction: scenario memory and foreign comments, added to
 * the shared list.
 */
const SCENARIO_UNMANAGED: readonly string[] = [
  ...UNMANAGED,
  'GBrain pages planted by the scenarios (soft-deleted: recoverable until GBrain purges them)',
  'facts and events the scenarios planted on those pages (they stay in the database and name only objects of the gate worlds)',
  'comments the runs wrote outside the pages of the world (Notion cannot delete them; they are listed under foreign in the artifacts)',
];

/**
 * Conducts the gate of a suite (`gate-suites.ts`) and says whether it is proven: worlds in a real
 * workspace, runs with the real Skill through the second App instance, the verdict as JSON on
 * stdout. Every attempt cleans up after itself. There is always a verdict, including when the gate
 * run could not start (the runner is not ready, the run gates are closed). Then the verdict has the
 * reason in `stopped` and marks all selected scenarios as not conducted.
 */
export async function runGate(options: GateOptions): Promise<GateResult> {
  const log = (line: string): void => {
    process.stderr.write(`${options.suite} gate: ${line}\n`);
  };
  const session = await GateSession.open(options.suite);

  try {
    const suite = SUITES[options.suite](session.app);
    const { world } = suite;
    const port = new LivePort(world);
    const run = String(randomInt(1_000, 10_000));
    const { pluginDir } = session.app.get<RunnerConfig>(runnerConfig.KEY);
    // Digests are an input of the launch, not its result: when one cannot be computed, the runs do
    // not start, instead of losing the verdict after they have spent quota.
    const header = {
      at: new Date(),
      timeZone: world.timeZone(),
      language: world.language(),
      skill: pluginDir === undefined ? null : pluginDigest(pluginDir),
      schema: schemaDigest(),
      gate: gateDigest({ app: join(__dirname, '../../src'), gate: __dirname }, extname(__filename)),
      notionQueryAllowance: session.app.get(NotionAllowance).described,
    };

    session.holdAgainstAbort(() => world.abandon());

    const selected = selectionOf(options);
    const refusal = await startRefusalOf(session, options, autonomousRunsOf(selected, options));
    const checks =
      refusal === null
        ? [
            ...(await suite.checksBefore(selected, run)),
            ...(await preflight(world, selected, run, options.preflight)),
            ...(await suite.checksAfter(selected, run)),
          ]
        : [];
    const plan = planOf(selected, checks, options);
    const conducted: Conducted =
      refusal === null
        ? await conductAll(
            plan,
            port,
            { ...chainConductors(port), ...suite.conductors(options) },
            session,
            run,
            log,
          )
        : { repetitions: {}, skipped: {}, stopped: refusal };
    const cleanup = cleanupVerdict(await world.abandon(), [
      ...SCENARIO_UNMANAGED,
      ...suite.unmanaged,
    ]);

    const { document, result } = verdictOf({
      options,
      selected,
      preflight: checks,
      conducted: conducted.repetitions,
      skipped: conducted.skipped,
      stopped: conducted.stopped,
      cleanup,
      header,
    });

    session.report(document);

    return result;
  } finally {
    await session.close();
  }
}
