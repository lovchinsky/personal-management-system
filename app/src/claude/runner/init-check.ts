import { resolve } from 'node:path';
import { McpServerName } from '../../generated/prisma/enums';
import { MCP_SERVER_NAMES } from '../../runs/toolsets';
import {
  HARNESS_TOOLS,
  knownTools,
  PLUGIN_TOOLS,
  REQUIRED_SERVERS,
  toolNameOf,
} from '../perimeter';
import { InitMessage } from './stream';

/** What a run expects from init, taken from the options it was launched with. */
export interface InitExpectation {
  readonly runId: string;
  readonly model: string;
  readonly permissionMode: string;
  /** The plugin the run loads and the directory it must come from. */
  readonly plugin: string;
  readonly pluginDir: string;
  /** The servers passed in `mcpServers`. */
  readonly attached: readonly McpServerName[];
  /** The allow-set of MCP tools of the mode's row, by full names. */
  readonly allowed: readonly string[];
  /**
   * The Skill the run loads by command. It is named only for a Skill run: without the Skill in
   * `init.skills` the CLI would read the command as plain text
   * (`docs/decisions/0020-skill-delivery-in-runs.md`).
   */
  readonly skill?: string;
}

/**
 * Lists what is wrong in init; an empty list means the run can be trusted (`INV-301`, `INV-302`).
 *
 * The options set the intent, and an organization's policy can narrow it, so the check covers what
 * the run actually received. Any divergence is a technical failure, and the run is aborted before
 * the first request to the model.
 */
export function initProblems(init: InitMessage, expected: InitExpectation): string[] {
  const problems: string[] = [];

  if (init.session_id !== expected.runId) {
    problems.push(`session ${init.session_id} is not this run`);
  }

  if (init.permissionMode !== expected.permissionMode) {
    problems.push(`permission mode is ${init.permissionMode}, not ${expected.permissionMode}`);
  }

  if (init.model !== expected.model) {
    problems.push(`model is ${init.model}, not the profile's ${expected.model}`);
  }

  const status = new Map(init.mcp_servers.map((server) => [server.name, server.status]));
  const unexpected = [...status.keys()].filter(
    (name) => !expected.attached.some((attached) => attached === name),
  );
  const missing = expected.attached.filter((name) => !status.has(name));

  if (unexpected.length > 0) problems.push(`unexpected MCP servers: ${unexpected.join(', ')}`);
  if (missing.length > 0) problems.push(`MCP servers missing from init: ${missing.join(', ')}`);

  for (const server of REQUIRED_SERVERS) {
    if (status.get(server) !== 'connected') {
      problems.push(`required MCP server ${server} is ${status.get(server) ?? 'absent'}`);
    }
  }

  const { extra, absent } = toolsDiff(init, expected, status);

  if (extra.length > 0) problems.push(`tools outside the allow-set: ${extra.join(', ')}`);
  if (absent.length > 0) problems.push(`allowed tools missing from init: ${absent.join(', ')}`);

  if (expected.skill !== undefined && !init.skills.includes(expected.skill)) {
    problems.push(
      `the skill ${expected.skill} is not in init.skills (${init.skills.length} listed) — ` +
        'the run would take its command for plain text',
    );
  }

  // The check requires exactly one non-builtin plugin, ours and from the declared directory,
  // because the CLI adds the rest itself (`path: builtin`) and their set is not deterministic
  // (`docs/2-system.md` § “Runner execution environment”).
  const loaded = init.plugins.filter((plugin) => plugin.path !== 'builtin');
  const ours = loaded.length === 1 && loaded[0].name === expected.plugin;

  if (!ours || resolve(loaded[0].path) !== resolve(expected.pluginDir)) {
    problems.push(
      `plugins are ${loaded.map((plugin) => `${plugin.name}@${plugin.path}`).join(', ') || 'none'}, ` +
        `not exactly ${expected.plugin}@${expected.pluginDir}`,
    );
  }

  return problems;
}

/**
 * Compares the contents of `init.tools` with what is expected and returns what is extra and what
 * is missing. A GBrain that did not connect degrades (`INV-301`): its tools leave the expected
 * set, and the status stays in the init snapshot.
 */
function toolsDiff(
  init: InitMessage,
  expected: InitExpectation,
  status: ReadonlyMap<string, string>,
): { readonly extra: string[]; readonly absent: string[] } {
  const usable = new Set(MCP_SERVER_NAMES.filter((server) => status.get(server) === 'connected'));
  const expectedTools = new Set([
    ...expected.allowed.filter((tool) => {
      const { server } = toolNameOf(tool);

      return server !== undefined && usable.has(server);
    }),
    ...PLUGIN_TOOLS,
    ...HARNESS_TOOLS,
  ]);

  return {
    extra: init.tools.filter((tool) => !expectedTools.has(tool)),
    absent: [...expectedTools].filter((tool) => !init.tools.includes(tool)),
  };
}

/**
 * Returns the extra tools that the runner may deny before launching again: tools of an external
 * server (Notion, GBrain) that the contract does not know, when they are the only discrepancy in
 * `init`.
 *
 * A vendor's hosted server adds tools without warning, and they cannot be denied in advance,
 * because the vendor's list is open. Everything else is a failure that a retry does not fix: a
 * tool known to the contract outside the allow-set (the deny layer did not work), a built-in tool,
 * a foreign server, a missing allowed tool, a status, a plugin, a model.
 */
export function driftOf(init: InitMessage, expected: InitExpectation): string[] {
  const problems = initProblems(init, expected);
  const status = new Map(init.mcp_servers.map((server) => [server.name, server.status]));
  const { extra } = toolsDiff(init, expected, status);
  const known = new Set(knownTools());
  const vendor = (tool: string): boolean => {
    const { server } = toolNameOf(tool);

    return server !== undefined && server !== 'app' && expected.attached.includes(server);
  };

  // Extra tools produce exactly one problem: with more problems, the discrepancy is not only in
  // the extra tools.
  return problems.length === 1 &&
    extra.length > 0 &&
    extra.every((tool) => vendor(tool) && !known.has(tool))
    ? extra
    : [];
}

/**
 * The statuses of the Notion server that clear on their own: the server did not respond or is
 * still connecting. Revoked access (`needs-auth`) and a disabled server (`disabled`) do not clear
 * on their own, so they are a failure.
 */
const NOTION_PASSING: ReadonlySet<string> = new Set(['failed', 'pending']);

/**
 * Checks whether init stopped the run only because the Notion server is currently unavailable
 * (ADR 0045): its status is one of those that clear on their own, and init reports no other
 * problem. A Notion server that did not connect takes its tools out of the expected set
 * (`toolsDiff`), so any other discrepancy is already a second problem and a failure.
 */
export function notionUnavailableAtInit(init: InitMessage, expected: InitExpectation): boolean {
  const status = init.mcp_servers.find((server) => server.name === 'notion')?.status;

  return (
    status !== undefined && NOTION_PASSING.has(status) && initProblems(init, expected).length === 1
  );
}
