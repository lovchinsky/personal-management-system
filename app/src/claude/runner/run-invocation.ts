import { resolve } from 'node:path';
import type { McpHttpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import { McpServerName, WorkflowMode } from '../../generated/prisma/enums';
import { McpEndpoint } from '../../runs/run.launcher';
import { MCP_SERVER_NAMES } from '../../runs/toolsets';
import {
  allowedTools,
  disallowedTools,
  permissionRules,
  PLUGIN_TOOLS,
  RequiredServer,
} from '../perimeter';
import { EVALUATION_RESULT_JSON_SCHEMA } from '../result/evaluation-result';
import { RunProfile } from '../run-profile';
import { InitExpectation } from './init-check';
import { RunEnv } from './run-env';

/**
 * The servers of a run. The required ones are always present; the rest may be absent: without a
 * token the run degrades instead of failing (`INV-301`).
 */
export type RunServers = Readonly<Record<RequiredServer, McpEndpoint>> &
  Readonly<Partial<Record<Exclude<McpServerName, RequiredServer>, McpEndpoint>>>;

/** A server the run actually received: its name and the access to it, in registry order. */
interface AttachedServer {
  readonly name: McpServerName;
  readonly access: McpEndpoint;
}

/**
 * Returns the servers passed to a run, as one list for the options, the init expectations and the
 * secrets.
 */
export function attachedOf(servers: RunServers): AttachedServer[] {
  return MCP_SERVER_NAMES.flatMap((name) => {
    const access = servers[name];

    return access ? [{ name, access }] : [];
  });
}

interface InvocationInput {
  readonly runId: string;
  readonly mode: WorkflowMode;
  readonly profile: RunProfile;
  readonly servers: RunServers;
  readonly pluginDir: string;
  readonly env: RunEnv;
  /** The run's own instructions (a gate command), in which case the run is not a Skill run. */
  readonly instructions: string;
  readonly abortController: AbortController;
  readonly stderr: (data: string) => void;
  /** Vendor tools the contract did not know and the runner has already denied (`ADR 0031`). */
  readonly learned: readonly string[];
}

/** One `query()` invocation: its options and what init must confirm about them. */
export interface Invocation {
  readonly options: Options;
  /**
   * What the run expects from init. It is derived from the same values as the options and not
   * composed separately: the options set the intent, init says what came of it, and an
   * expectation written separately would diverge from the intent (`INV-301`, `INV-302`).
   */
  readonly expects: InitExpectation;
}

/**
 * The plugin a run loads. It is not the chat plugin: that one is handed to the person, while this
 * one sits next to the App and ships only in its image
 * (`docs/decisions/0047-chat-and-runner-plugins.md`).
 */
export const PLUGIN_NAME = 'personal-management-system-runner';

/**
 * The entry of a run in the qualified form in which `init` names it: the plugin, a colon, the
 * name of the skill's directory.
 */
export const SKILL_NAME = `${PLUGIN_NAME}:run`;

/** The plugin command that loads the Skill in the first turn of a run. */
export const SKILL_COMMAND = `/${SKILL_NAME}`;

/**
 * Checks whether a run is a Skill run. A run with its own instructions (a gate command) is not:
 * its prompt is the envelope itself, and the instructions go into `systemPrompt`. All other runs
 * work from the plugin's Skill.
 */
export function isSkillRun(instructions: string): boolean {
  return instructions === '';
}

/**
 * Builds the prompt of a run: the Skill command with the envelope, or the envelope alone when the
 * run has its own instructions.
 */
export function promptOf(envelope: string, instructions: string): string {
  return isSkillRun(instructions) ? `${SKILL_COMMAND} ${envelope}` : envelope;
}

/** Everything absent from `allowedTools` is denied without asking. */
const PERMISSION_MODE = 'dontAsk';

/**
 * Builds the options of one `query()` invocation, with everything explicit and nothing taken from
 * SDK or CLI defaults (`docs/2-system.md` § “Run invocation”).
 *
 * It never sets `fallbackModel` (`INV-032`), `resume` and `forkSession` (the session is the `id` of
 * the ledger row), or `canUseTool` and `hooks` (the options enforce the perimeter, not code in the
 * App process).
 */
export function invocationOf(input: InvocationInput): Invocation {
  const { profile } = input;
  const attached = attachedOf(input.servers);
  const skillRun = isSkillRun(input.instructions);

  return {
    options: {
      plugins: [{ type: 'local', path: resolve(input.pluginDir), skipMcpDiscovery: true }],
      mcpServers: Object.fromEntries(
        attached.map(({ name, access }) => [name, httpServer(access)]),
      ),
      strictMcpConfig: true,
      settingSources: [],
      tools: [...PLUGIN_TOOLS],
      allowedTools: permissionRules(input.mode, input.pluginDir),
      disallowedTools: disallowedTools(input.mode, input.learned),
      permissionMode: PERMISSION_MODE,
      outputFormat: { type: 'json_schema', schema: EVALUATION_RESULT_JSON_SCHEMA },
      model: profile.model,
      effort: profile.effort,
      thinking: { type: profile.thinking },
      maxTurns: profile.maxTurns,
      maxBudgetUsd: profile.maxBudgetUsd,
      sessionId: input.runId,
      persistSession: false,
      systemPrompt: input.instructions,
      abortController: input.abortController,
      env: { ...input.env },
      // The run's directory is also its working directory: the run sees none of the machine's
      // project files.
      cwd: input.env.HOME,
      stderr: input.stderr,
    },
    expects: {
      runId: input.runId,
      model: profile.model,
      permissionMode: PERMISSION_MODE,
      plugin: PLUGIN_NAME,
      pluginDir: input.pluginDir,
      attached: attached.map(({ name }) => name),
      allowed: allowedTools(input.mode),
      ...(skillRun ? { skill: SKILL_NAME } : {}),
    },
  };
}

/**
 * `alwaysLoad` makes server statuses final at init and does not hide tools behind tool search;
 * otherwise the init check would see `pending` and an incomplete set.
 */
function httpServer(access: McpEndpoint): McpHttpServerConfig {
  return {
    type: 'http',
    url: access.url,
    headers: { Authorization: `Bearer ${access.bearer}` },
    alwaysLoad: true,
  };
}
