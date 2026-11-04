import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../../platform/config/env-value';

/**
 * The runner for runs (ADR 0013): a switch that is off by default, and the values needed only
 * when the runner is on, namely the subscription token, the plugin directory, the GBrain MCP URL
 * and the `PATH` that the run process inherits. The runner requires the values that are optional
 * here when it starts.
 */
export const runnerConfig = registerAs('runner', () => ({
  enabled: process.env.RUNNER_ENABLED === 'true',
  oauthToken: optional(process.env.CLAUDE_CODE_OAUTH_TOKEN),
  pluginDir: optional(process.env.RUNNER_PLUGIN_DIR),
  gbrainMcpUrl: optional(process.env.RUNNER_GBRAIN_MCP_URL),
  path: optional(process.env.PATH),
}));

export type RunnerConfig = ConfigType<typeof runnerConfig>;
