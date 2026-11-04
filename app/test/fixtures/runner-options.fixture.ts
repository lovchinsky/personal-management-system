import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { profileFor } from '../../src/claude/run-profile';
import { runEnv } from '../../src/claude/runner/run-env';
import { Invocation, invocationOf, RunServers } from '../../src/claude/runner/run-invocation';
import { WorkflowMode } from '../../src/generated/prisma/enums';
import { PLUGIN_DIR } from './claude-stream.fixture';

/** All three servers of a run. */
export const ALL_SERVERS: RunServers = {
  app: { url: 'http://127.0.0.1:3000/mcp', bearer: 'app-bearer' },
  notion: { url: 'https://mcp.notion.com/mcp', bearer: 'notion-bearer' },
  gbrain: { url: 'http://gbrain:3131/mcp', bearer: 'gbrain-bearer' },
};

/** Builds the invocation of a `mode` run as the runner would, with no network and no SDK. */
export function invocationFor(
  mode: WorkflowMode,
  servers: RunServers = ALL_SERVERS,
  instructions = '',
  learned: readonly string[] = [],
): Invocation {
  return invocationOf({
    runId: 'run-1',
    mode,
    profile: profileFor(mode),
    servers,
    pluginDir: PLUGIN_DIR,
    env: runEnv('/tmp/personal-management-system-run-x', '/usr/bin', 'oauth-token'),
    instructions,
    abortController: new AbortController(),
    stderr: () => undefined,
    learned,
  });
}

/** Returns the options of a `mode` run. */
export function optionsFor(mode: WorkflowMode): Options {
  return invocationFor(mode).options;
}

export const MODES: readonly WorkflowMode[] = Object.values(WorkflowMode);
