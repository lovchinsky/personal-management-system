import { z } from 'zod';
import { McpServerName } from '../generated/prisma/enums';

/**
 * The tokens of one model: exactly those that go into the run trace (`run_model_usage`).
 *
 * The harness reports more fields about a model than are named here. The type names those the
 * token accounting rests on, because a rename in the harness must break the build, not silently
 * change what is recorded.
 */
export const modelTokensSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
  canonicalModel: z.string().optional(),
});

export type ModelTokens = z.infer<typeof modelTokensSchema>;

/**
 * What the run said about itself in the result message: the result snapshot of the run trace.
 *
 * `session_id` is not needed separately, because it is the `id` of the admitted run.
 */
export interface RunReport {
  /**
   * The profile's model in canonical form, if it actually ran; otherwise `none`, because the
   * CLI's auxiliary model is not the run's model.
   */
  readonly model: string;
  readonly modelUsage: Readonly<Record<string, ModelTokens>>;
  readonly numTurns: number;
  /** The duration the run itself reports; the App's clock around the call is separate. */
  readonly durationMs: number;
  /** How the loop ended, according to the CLI. The result message may not have it at all. */
  readonly terminalReason?: string;
}

/** A plugin the CLI loaded, with the version from the manifest if one is declared. */
export const loadedPluginSchema = z.object({
  name: z.string(),
  path: z.string(),
  version: z.string().optional(),
});

/** A run's MCP server and its status at init. */
export const attachedServerSchema = z.object({ name: z.string(), status: z.string() });

/**
 * What the run received at startup: the init snapshot of the run trace.
 *
 * Two trace fields come from it: the behavior contract version and the attached servers. The
 * behavior contract version consists of the plugin, with a digest of its content, and the CLI
 * version, because both determine the run's capability (`docs/2-system.md` § “Run invocation”).
 * The set of tools proves the perimeter (`INV-302`), and the runner checks the model and the
 * permission mode even before the first request to the API.
 */
export const runInitSchema = z.object({
  claudeCodeVersion: z.string(),
  model: z.string(),
  permissionMode: z.string(),
  plugins: z.array(loadedPluginSchema),
  /** The digest of the plugin the run used. Not every snapshot in the database has it. */
  pluginDigest: z.string().optional(),
  mcpServers: z.array(attachedServerSchema),
  tools: z.array(z.string()),
});

export type RunInit = z.infer<typeof runInitSchema>;

/** One tool call in a run. There are no payloads (GAP-07). */
export interface ToolCall {
  /** The MCP server. Absent means the tool belongs to the harness itself. */
  readonly server?: McpServerName;
  readonly tool: string;
  readonly ok: boolean;
}

/** What the runner saw in the run's stream from init to the end. */
export interface RunObservation {
  readonly init: RunInit;
  readonly toolCalls: readonly ToolCall[];
  /**
   * Tools the SDK perimeter denied, taken from the result message. Empty if the run did not
   * reach the result message.
   */
  readonly permissionDenials: readonly string[];
}

/**
 * A result that passed the App's schema (`contracts/canonical.yaml`, key `evaluation_result`).
 *
 * It is opaque to `runs/`: the runner knows the shape, and the ledger only stores it.
 */
export type RunResult = Readonly<Record<string, unknown>>;

/**
 * The outcome of a run: what the runner hands to the dispatcher.
 *
 * The runner classifies the outcome, because only it knows which harness fields can be trusted. A
 * completed run has all three snapshots. A failed or deferred run has the snapshots it reached,
 * because a process that died earlier had no time to report.
 *
 * `deferred` means the run did not fail but could not take place, and the origin row's attempt is
 * refunded. There are two causes:
 *
 * - `plan_quota` means the run hit the plan quota (ADR 0012). The breaker and the daily limit do
 *   not see it, and the run gates hold every run until the reset. `resetsAt` is the time of the
 *   reset, if the run knows it; without `resetsAt` the dispatcher decides how long to wait;
 * - `notion` means the run did not reach Notion (ADR 0045). Only its row waits. The model's
 *   result, if the model got that far, is kept for audit.
 */
export type RunOutcome =
  | {
      readonly status: 'completed';
      readonly report: RunReport;
      readonly observation: RunObservation;
      readonly result: RunResult;
    }
  | {
      readonly status: 'failed';
      readonly error: string;
      readonly report?: RunReport;
      readonly observation?: RunObservation;
      /** A result that passed the schema but not the remaining checks. */
      readonly result?: RunResult;
    }
  | {
      readonly status: 'deferred';
      readonly cause: 'plan_quota';
      readonly reason: string;
      readonly resetsAt?: Date;
      readonly report?: RunReport;
      readonly observation?: RunObservation;
    }
  | {
      readonly status: 'deferred';
      readonly cause: 'notion';
      readonly reason: string;
      readonly report?: RunReport;
      readonly observation?: RunObservation;
      readonly result?: RunResult;
    };
