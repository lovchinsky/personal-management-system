import { resolve } from 'node:path';
import { McpServerName, WorkflowMode } from '../generated/prisma/enums';
import { MCP_SERVER_NAMES, MCP_TOOLSETS, serverTools } from '../runs/toolsets';

/**
 * The perimeter of tools for an App-triggered run, as the SDK sees it: full names
 * `mcp__<server>__<tool>`, the harness's own tools and the built-in tools that are denied by name.
 *
 * What the run of a mode sees mirrors the contract in `runs/toolsets.ts`; this file knows only
 * what concerns the SDK (`contracts/canonical.yaml`, keys `harness_tools` and `plugin_tools`).
 */

/**
 * Servers without which a run has nothing to work with. At init, any status other than `connected`
 * for one of them is a technical failure (`INV-301`). GBrain degrades.
 */
export const REQUIRED_SERVERS = ['notion', 'app'] as const satisfies readonly McpServerName[];

export type RequiredServer = (typeof REQUIRED_SERVERS)[number];

/** Tools the harness itself adds, not an MCP server: `outputFormat` is `StructuredOutput`. */
export const HARNESS_TOOLS: readonly string[] = ['StructuredOutput'];

/**
 * The only built-in tool of a run: reading the Skill's `references/`. It is allowed by the rule
 * that limits `Read` to the plugin directory (`pluginReadRule`); every other path is rejected
 * under `dontAsk` (`docs/decisions/0020-skill-delivery-in-runs.md`).
 */
export const PLUGIN_TOOLS: readonly string[] = ['Read'];

/**
 * Builds the rule that allows `Read` in the plugin directory only. An absolute path in a rule
 * starts with `//`. A single `/` is a path relative to the run's cwd, and a rule with such a path
 * allows nothing (measured on CLI 2.1.283).
 */
export function pluginReadRule(pluginDir: string): string {
  return `Read(/${resolve(pluginDir)}/**)`;
}

/** The SDK version `BUILT_IN_TOOLS` was reviewed against; an SDK upgrade forces a new review. */
export const REVIEWED_FOR_SDK = '0.3.283';

/**
 * Built-in CLI tools denied by name as the second layer (`INV-049`).
 *
 * The list cannot be complete, because the CLI has dozens of tools of its own and the set changes
 * with the version. The primary layer is `tools: PLUGIN_TOOLS`, and init checks what a run actually
 * received (`INV-302`). An extra name here is harmless. `StructuredOutput` and `PLUGIN_TOOLS`
 * cannot be listed here, because deny takes precedence over allow and a denied `Read` would not
 * read the plugin directory either.
 */
export const BUILT_IN_TOOLS: readonly string[] = [
  'Agent',
  'Artifact',
  'AskUserQuestion',
  'Bash',
  'BashOutput',
  'ClaudeDesign',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'KillShell',
  'ListMcpResourcesTool',
  'Monitor',
  'NotebookEdit',
  'Projects',
  'ProposeGoal',
  'ProposeSkills',
  'PushNotification',
  'ReadMcpResourceDirTool',
  'ReadMcpResourceTool',
  'ReadNotifications',
  'RefreshMcpTools',
  'RemoteTrigger',
  'ReportFindings',
  'ScheduleWakeup',
  'SendFeedback',
  'ShowOnboardingRolePicker',
  'Skill',
  'SlashCommand',
  'Task',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskStop',
  'TaskUpdate',
  'TodoWrite',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
];

/** Returns the full name of a server's tool in the SDK. */
export function qualified(server: McpServerName, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/**
 * A tool as the SDK names it: a server's tool is named together with its server, and a tool without
 * a server is the harness's own.
 */
export interface ToolName {
  readonly server?: McpServerName;
  readonly tool: string;
}

export function toolNameOf(name: string): ToolName {
  for (const server of MCP_SERVER_NAMES) {
    const prefix = qualified(server, '');

    if (name.startsWith(prefix)) return { server, tool: name.slice(prefix.length) };
  }

  return { tool: name };
}

/**
 * Returns the allow-set of a run: the expanded bundles of its mode's row, as literal names
 * (`INV-307`).
 */
export function allowedTools(mode: WorkflowMode): string[] {
  return MCP_SERVER_NAMES.flatMap((server) =>
    serverTools(mode, server).map((tool) => qualified(server, tool)),
  ).sort();
}

/**
 * Returns all permission rules of a run: the allow-set of its row and `Read` in the plugin
 * directory. The contents of `init.tools` equal `allowedTools` plus `PLUGIN_TOOLS` and
 * `HARNESS_TOOLS`.
 */
export function permissionRules(mode: WorkflowMode, pluginDir: string): string[] {
  return [...allowedTools(mode), pluginReadRule(pluginDir)];
}

/** Returns all known tool names of the three servers, triaged and untriaged. */
export function knownTools(): string[] {
  return MCP_SERVER_NAMES.flatMap((server) => {
    const toolset = MCP_TOOLSETS[server];

    return [...Object.values(toolset.capabilities).flat(), ...toolset.untriaged].map((tool) =>
      qualified(server, tool),
    );
  }).sort();
}

/**
 * Returns the second layer: built-in tools by name, the servers' known tools outside the row's
 * allow-set, and the `learned` tools, which the contract did not know but the vendor's server
 * returned and the runner denied after `init` showed them (`ADR 0031`).
 */
export function disallowedTools(mode: WorkflowMode, learned: readonly string[]): string[] {
  const allowed = new Set(allowedTools(mode));
  const denied = new Set([...knownTools(), ...learned]);

  return [...BUILT_IN_TOOLS, ...[...denied].filter((tool) => !allowed.has(tool))];
}
