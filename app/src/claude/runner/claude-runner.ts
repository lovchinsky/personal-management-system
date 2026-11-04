import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { differenceInMilliseconds } from 'date-fns';
import { ConnectorUnavailableError } from '../../credentials/connector-unavailable.error';
import { GbrainToken } from '../../credentials/gbrain/gbrain.token';
import { NotionMcpGrant } from '../../credentials/notion-mcp/notion-mcp.grant';
import { required } from '../../platform/config/env-value';
import { messageOf } from '../../platform/error/message-of';
import { isPersonsSnooze } from '../../runs/provenance';
import { RunOutcome } from '../../runs/run-outcome';
import { AdmittedRun, McpEndpoint, Readiness, RunLauncher } from '../../runs/run.launcher';
import { serverTools } from '../../runs/toolsets';
import { toolNameOf } from '../perimeter';
import { profileFor } from '../run-profile';
import { CLAUDE_QUERY, type ClaudeQuery } from './claude-query';
import { driftOf, initProblems, notionUnavailableAtInit } from './init-check';
import { PLUGIN_DIGEST, type PluginDigest } from './plugin-digest';
import { classify } from './run-classifier';
import { runEnv, RunEnv } from './run-env';
import { attachedOf, invocationOf, promptOf, RunServers } from './run-invocation';
import { RunObserver, type ObservedStream } from './run-observer';
import { RUN_TAP, type RunTap } from './run-tap';
import { runnerConfig, type RunnerConfig } from './runner.config';
import { redacted, redactedValue, redactedValues } from './secrets';

/** How much of the CLI's stderr to keep for diagnosing a run that ended without a result. */
const STDERR_TAIL = 2_000;

/**
 * How many characters of a schema rejection to write to the log. For a deep result, a schema error
 * with all the violations (the CLI collects them all) takes more than one line, but not pages.
 */
const REJECTION_LOG = 2_000;

/**
 * Returns the rejections as they go to the log. They are redacted first and then truncated,
 * because truncating in the middle of a secret would leave a fragment that redaction does not
 * recognize.
 */
const loggedRejections = (rejections: readonly string[], secrets: readonly string[]): string[] =>
  rejections.map((text) => redacted(text, secrets).slice(0, REJECTION_LOG));

/** What a run passes to `query()`: servers, secrets to redact, the plugin and the environment. */
interface QuerySetup {
  readonly servers: RunServers;
  /**
   * Everything that must not reach the log or the run trace: the servers' bearers and the
   * subscription token.
   */
  readonly secrets: readonly string[];
  readonly pluginDir: string;
  readonly pluginDigest: string;
  readonly env: RunEnv;
}

/**
 * The runner of App-triggered runs on the Claude Agent SDK, and the adapter of the `RunLauncher`
 * port (ADR 0009).
 *
 * One run is one `query()` invocation with an explicit set of options, a separate temporary `HOME`
 * that is removed afterwards, and an outcome classified by what the run showed, not by whether the
 * SDK threw an exception.
 *
 * It is always wired in but available only behind the `RUNNER_ENABLED` switch (ADR 0013), because
 * its runs share the plan quota with the owner's own work.
 */
@Injectable()
export class ClaudeRunner implements RunLauncher {
  private readonly logger = new Logger(ClaudeRunner.name);

  /**
   * Vendor tools the contract did not know: `init` showed them, the runner denied them and
   * repeated the launch. They are kept until the process restarts, so that later runs deny them at
   * once instead of incurring a retry (`ADR 0031`).
   */
  private readonly learned = new Set<string>();

  /** The plugin digest: the image does not change, so computing it once per process is enough. */
  private digest?: string;

  constructor(
    @Inject(runnerConfig.KEY) private readonly config: RunnerConfig,
    private readonly notion: NotionMcpGrant,
    private readonly gbrain: GbrainToken,
    @Inject(CLAUDE_QUERY) private readonly sdk: ClaudeQuery,
    @Inject(PLUGIN_DIGEST) private readonly digestOf: PluginDigest,
    @Optional() @Inject(RUN_TAP) private readonly tap?: RunTap,
  ) {}

  get available(): boolean {
    return this.config.enabled;
  }

  /**
   * Reports the runner ready when the Notion MCP grant is live. Without Notion a run has nothing to
   * work with (`INV-301`), and only the person can bring a dead grant back. GBrain is not part of
   * readiness: without it a run degrades instead of stopping.
   */
  async readiness(): Promise<Readiness> {
    const grant = await this.notion.liveness();

    return grant.alive ? { ready: true } : { ready: false, reason: grant.reason };
  }

  async launch(run: AdmittedRun): Promise<RunOutcome> {
    const servers = await this.servers(run);
    if ('error' in servers) {
      const error = redacted(servers.error, [run.app.bearer]);

      // Notion access that failed to refresh because of a refusal that clears on its own is not a
      // failure: the run waits for Notion (ADR 0045). A dead grant is a failure, as is any
      // unrecognized refusal.
      return servers.unavailable
        ? { status: 'deferred', cause: 'notion', reason: error }
        : { status: 'failed', error };
    }

    const oauthToken = required(this.config.oauthToken, 'CLAUDE_CODE_OAUTH_TOKEN');
    const path = required(this.config.path, 'PATH');
    const pluginDir = required(this.config.pluginDir, 'RUNNER_PLUGIN_DIR');
    const home = await mkdtemp(join(tmpdir(), 'personal-management-system-run-'));

    try {
      this.digest ??= this.digestOf(pluginDir);

      return await this.query(run, {
        servers: servers.access,
        secrets: [...bearersOf(servers.access), oauthToken],
        pluginDir,
        pluginDigest: this.digest,
        env: runEnv(home, path, oauthToken),
      });
    } finally {
      await this.removeHome(run.id, home);
    }
  }

  /**
   * Runs one attempt and, when `init` showed vendor tools the contract does not know, a second
   * attempt with those tools denied. The abort triggered by `init` happens before the first request
   * to the model, so the first attempt costs nothing but the CLI startup, and its outcome is not
   * recorded. There is one retry: drift that remains is an anomaly, not news.
   */
  private async query(run: AdmittedRun, setup: QuerySetup): Promise<RunOutcome> {
    const first = await this.attempt(run, setup);

    if (first.drift.length === 0) return first.outcome;

    for (const tool of first.drift) this.learn(run.id, tool);

    return (await this.attempt(run, setup)).outcome;
  }

  /**
   * Writes every schema rejection to the log, because a result the CLI rejected by the schema costs
   * a model round and the run trace keeps only the last reason (`run_traces.reason`). The log gets
   * the path and the rule, not the page content.
   */
  private reportRejections(runId: string, rejections: readonly string[]): void {
    for (const rejection of rejections) {
      this.logger.warn(`${runId}: the result was rejected by the schema: ${rejection}`);
    }
  }

  /**
   * Tells the attempt subscriber about an attempt, with the same redacted and truncated texts as
   * the log, because a secret must not reach anywhere the log does not. A run subscriber failure
   * does not fail the run, because the subscriber observes and does not decide.
   */
  private tell(
    run: AdmittedRun,
    observed: ObservedStream,
    rejections: readonly string[],
    secrets: readonly string[],
    transcript: readonly unknown[],
  ): void {
    try {
      this.tap?.attempted(run.id, {
        skillReads: observed.skillReads.map((path) => redacted(path, secrets)),
        rejections,
        gbrainCalls: observed.gbrainCalls.map((call) => ({
          ...call,
          input: redactedValues(call.input, secrets),
        })),
        transcript: transcript.map((message) => redactedValue(message, secrets)),
      });
    } catch (error) {
      this.logger.warn(`${run.id}: the run tap failed — ${messageOf(error)}`);
    }
  }

  /** Remembers a vendor tool the contract did not know, and warns about it once. */
  private learn(runId: string, tool: string): void {
    if (this.learned.has(tool)) return;

    this.learned.add(tool);
    this.logger.warn(
      `${runId}: ${toolNameOf(tool).server ?? 'a server'} serves a tool the contract does not know — ` +
        `${tool}; it is denied from now on (name it in contracts/canonical.yaml, mcp_toolsets)`,
    );
  }

  /**
   * Makes one `query()` invocation. The stream goes to the observer, and the classifier derives the
   * outcome from what the run showed, not from whether the SDK threw an exception. `drift` lists
   * the vendor tools the contract does not know and `init` should not have shown.
   */
  private async attempt(
    run: AdmittedRun,
    setup: QuerySetup,
  ): Promise<{ readonly outcome: RunOutcome; readonly drift: string[] }> {
    const profile = profileFor(run.envelope.mode, run.shape?.model);
    const { secrets } = setup;
    const controller = new AbortController();
    const onDeadline = (): void => {
      controller.abort(run.signal.reason);
    };
    let stderr = '';
    let thrown: unknown;
    const instructions = run.shape?.instructions ?? '';
    const { options, expects } = invocationOf({
      runId: run.id,
      mode: run.envelope.mode,
      profile,
      servers: setup.servers,
      pluginDir: setup.pluginDir,
      env: setup.env,
      instructions,
      abortController: controller,
      // Redaction first, then truncation: a secret cut by the tail boundary would leave its end,
      // which is recognizable neither as the whole secret nor by the shape of a header.
      stderr: (data) => {
        stderr = redacted(stderr + data, secrets).slice(-STDERR_TAIL);
      },
      learned: [...this.learned],
    });
    let drift: string[] = [];
    let notionUnavailable = false;

    const observer = new RunObserver(
      (init) => {
        drift = driftOf(init, expects);
        notionUnavailable = notionUnavailableAtInit(init, expects);

        return initProblems(init, expects);
      },
      (reason) => {
        controller.abort(new Error(reason));
      },
      setup.pluginDir,
    );

    // The `abort` event does not repeat, so a signal that fired before this point is read from its
    // state.
    if (run.signal.aborted) {
      onDeadline();
    } else {
      run.signal.addEventListener('abort', onDeadline, { once: true });
    }

    // The attempt's stream includes the content of what was read, so it is kept only for the
    // subscriber.
    const transcript: unknown[] = [];

    try {
      const prompt = promptOf(JSON.stringify(run.envelope), instructions);

      for await (const message of this.sdk({ prompt, options })) {
        observer.see(message);
        if (this.tap) transcript.push(message);
      }
    } catch (error) {
      // The SDK throws after a result message with `is_error` and after an abort alike. The
      // classifier derives the outcome from what the run showed; the exception is only context,
      // when the run managed to show nothing.
      thrown = stderr
        ? new Error(`${messageOf(error)}; stderr: ${stderr}`, { cause: error })
        : error;
    } finally {
      run.signal.removeEventListener('abort', onDeadline);
    }

    const observed = observer.observed();

    const rejections = loggedRejections(observed.rejections, secrets);

    this.reportRejections(run.id, rejections);
    this.tell(run, observed, rejections, secrets, transcript);

    const outcome = classify({
      runId: run.id,
      profile,
      observed,
      deadlineReached: run.signal.aborted,
      notionUnavailableAtInit: notionUnavailable,
      thrown,
      redact: (text) => redacted(text, secrets),
      pluginDigest: setup.pluginDigest,
    });

    return { outcome, drift };
  }

  /**
   * Removes the run's directory.
   *
   * After an abort the CLI may keep writing there for a few more seconds, so the removal is
   * retried. A directory that never got removed is a reason to say so in the log, not to replace
   * the run's outcome: a deferred run turned into a failure would send the following runs
   * straight into the same plan quota.
   */
  private async removeHome(runId: string, home: string): Promise<void> {
    try {
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (error) {
      this.logger.warn(`${runId}: the run's temporary HOME was not removed — ${messageOf(error)}`);
    }
  }

  /**
   * Requests the bearers of a run's servers. The tokens must outlive the whole run, so they are
   * requested for the rest of the ticket. The header is set once at startup.
   *
   * Without Notion a run has nothing to work with (`INV-301`), so the process does not launch at
   * all. GBrain is attached only to a mode whose matrix row lists tools for it; when unavailable,
   * it degrades (`docs/3-policy.md` § “GBrain unavailability”): the run proceeds without it, and
   * init records the degradation.
   */
  private async servers(
    run: AdmittedRun,
  ): Promise<
    { readonly access: RunServers } | { readonly error: string; readonly unavailable: boolean }
  > {
    const validForMs = Math.max(0, differenceInMilliseconds(run.expiresAt, new Date()));
    let notionToken: string;

    try {
      // A wake at a time the person named does not wait out the pause after a provider refusal:
      // its three attempts fit into half a minute, and the pause would make the reminder fail
      // during a one-minute outage.
      notionToken = await this.notion.accessToken(validForMs, {
        bypassCooldown: isPersonsSnooze(run.provenance),
      });
    } catch (error) {
      return {
        error: `Notion MCP is unavailable to the run: ${messageOf(error)}`,
        unavailable: error instanceof ConnectorUnavailableError,
      };
    }

    const gbrain =
      serverTools(run.envelope.mode, 'gbrain').length > 0
        ? await this.gbrainAccess(run, validForMs)
        : undefined;

    return {
      access: {
        app: run.app,
        notion: { url: this.notion.serverUrl(), bearer: notionToken },
        ...(gbrain ? { gbrain } : {}),
      },
    };
  }

  private async gbrainAccess(
    run: AdmittedRun,
    validForMs: number,
  ): Promise<McpEndpoint | undefined> {
    // The address is configuration, not availability: without it a run does not degrade but is
    // built wrong, so the refusal must be loud.
    const url = required(this.config.gbrainMcpUrl, 'RUNNER_GBRAIN_MCP_URL');

    try {
      return { url, bearer: await this.gbrain.accessToken(validForMs) };
    } catch (error) {
      this.logger.warn(
        `${run.id}: GBrain MCP unavailable, the run continues degraded — ${messageOf(error)}`,
      );

      return undefined;
    }
  }
}

/** Returns the bearers of a run's servers; each is a secret. */
function bearersOf(servers: RunServers): string[] {
  return attachedOf(servers).map(({ access }) => access.bearer);
}
