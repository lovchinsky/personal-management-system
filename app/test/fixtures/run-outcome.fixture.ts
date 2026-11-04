import { PLUGIN_NAME } from '../../src/claude/runner/run-invocation';
import { EffectsReport } from '../../src/runs/run-effects';
import { RunObservation, RunOutcome, RunReport, RunResult } from '../../src/runs/run-outcome';
import { PLUGIN_DIR } from './claude-stream.fixture';

/**
 * The report that ends a run in tests: run trace fields in the live format of the result message.
 */
export const A_REPORT: RunReport = {
  model: 'claude-opus-5-5',
  modelUsage: {
    'claude-opus-5-5': {
      inputTokens: 1_200,
      outputTokens: 340,
      cacheReadInputTokens: 9_000,
      cacheCreationInputTokens: 2_100,
      canonicalModel: 'claude-opus-5-5',
    },
  },
  numTurns: 4,
  durationMs: 18_500,
  terminalReason: 'completed',
};

/**
 * What the runner saw in the run, in the shape measured on CLI 2.1.283.
 */
export const AN_OBSERVATION: RunObservation = {
  init: {
    claudeCodeVersion: '2.1.283',
    model: 'claude-opus-5-5',
    permissionMode: 'dontAsk',
    plugins: [{ name: PLUGIN_NAME, path: PLUGIN_DIR }],
    pluginDigest: '0a1b2c3d4e5f',
    mcpServers: [
      { name: 'app', status: 'connected' },
      { name: 'notion', status: 'connected' },
      { name: 'gbrain', status: 'connected' },
    ],
    tools: ['mcp__app__get_runtime_state', 'mcp__notion__notion-fetch', 'StructuredOutput'],
  },
  toolCalls: [
    { server: 'notion', tool: 'notion-fetch', ok: true },
    { tool: 'StructuredOutput', ok: true },
  ],
  permissionDenials: [],
};

/**
 * A result that passed the schema. The values are placeholders: `runs/` treats the result as
 * opaque, and the runner owns its schema.
 */
export const A_RESULT: RunResult = { outcome: 'fixture', detections: [] };

/** A run that wrote nothing, and so applied nothing. */
export const NO_EFFECTS: EffectsReport = { applied: [], refused: [] };

export function completed(): RunOutcome {
  return { status: 'completed', report: A_REPORT, observation: AN_OBSERVATION, result: A_RESULT };
}

/** Builds a failed outcome, with the report and the init snapshot only if the run got that far. */
export function failed(error: string, reached: 'nothing' | 'result' = 'nothing'): RunOutcome {
  return reached === 'result'
    ? { status: 'failed', error, report: A_REPORT, observation: AN_OBSERVATION }
    : { status: 'failed', error };
}

/**
 * Builds the outcome of a run that hit the plan quota, with `resetsAt` if the limit event named it.
 */
export function deferred(resetsAt?: Date): RunOutcome {
  return resetsAt
    ? {
        status: 'deferred',
        cause: 'plan_quota',
        reason: 'plan limit reached',
        resetsAt,
        report: A_REPORT,
        observation: AN_OBSERVATION,
      }
    : { status: 'deferred', cause: 'plan_quota', reason: 'plan limit reached' };
}

/** Builds the outcome of a run that did not reach Notion (ADR 0045). */
export function unreachable(): RunOutcome {
  return { status: 'deferred', cause: 'notion', reason: 'no Notion read succeeded' };
}
