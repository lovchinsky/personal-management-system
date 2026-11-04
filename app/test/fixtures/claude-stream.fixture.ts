import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../../src/claude/perimeter';
import { EvaluationResult } from '../../src/claude/result/evaluation-result';
import { ClaudeQuery, ClaudeQueryParams } from '../../src/claude/runner/claude-query';
import { PLUGIN_NAME, SKILL_NAME } from '../../src/claude/runner/run-invocation';
import { WorkflowMode } from '../../src/generated/prisma/enums';

/**
 * The CLI stream in the shape measured on a live run of CLI 2.1.283. Messages are plain objects:
 * the runner reads the stream with schemas, not SDK types, so the test supplies it the way it
 * arrives on the wire.
 */
export type StreamMessage = Record<string, unknown>;

export const PLUGIN_DIR = '/app/plugin';
export const PROFILE_MODEL = 'claude-opus-5-5';

export function initMessage(
  runId: string,
  mode: WorkflowMode = 'event_evaluation',
  overrides: StreamMessage = {},
): StreamMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: runId,
    claude_code_version: '2.1.283',
    model: PROFILE_MODEL,
    permissionMode: 'dontAsk',
    cwd: '/tmp/personal-management-system-run-x',
    apiKeySource: 'none',
    tools: [...allowedTools(mode), ...PLUGIN_TOOLS, ...HARNESS_TOOLS],
    mcp_servers: [
      { name: 'app', status: 'connected', source: 'dynamic' },
      { name: 'notion', status: 'connected', source: 'dynamic' },
      { name: 'gbrain', status: 'connected', source: 'dynamic' },
    ],
    plugins: [
      { name: PLUGIN_NAME, path: PLUGIN_DIR, source: `${PLUGIN_NAME}@inline` },
      { name: 'agents-md', path: 'builtin', source: 'agents-md@builtin' },
      { name: 'telemetry', path: 'builtin', source: 'telemetry@builtin' },
    ],
    skills: [SKILL_NAME, 'code-review'],
    slash_commands: [SKILL_NAME, 'code-review'],
    agents: [],
    output_style: 'default',
    ...overrides,
  };
}

export function toolUse(id: string, name: string, input: object = {}): StreamMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
    parent_tool_use_id: null,
  };
}

export function toolResult(id: string, text: string, isError = false): StreamMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          is_error: isError,
          content: [{ type: 'text', text }],
        },
      ],
    },
    parent_tool_use_id: null,
  };
}

export function rateLimitEvent(info: StreamMessage): StreamMessage {
  return {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: 1_790_557_800,
      rateLimitType: 'five_hour',
      isUsingOverage: false,
      ...info,
    },
  };
}

/** Builds a result that would pass the schema, with evidence for what the run read. */
export function aResult(evidenceRef = 'page-read-1'): EvaluationResult {
  return {
    outcome: 'no_intervention',
    operating_phase: ['Reflect'],
    scope: { object_type: 'task', object_id: 'page-1' },
    detections: [
      {
        type: 'dependency',
        claim: 'The task waits on a vendor',
        why_now: 'The deadline is in four days',
        evidence: [{ server: 'notion', ref: evidenceRef }],
        counterevidence_checked: ['Read the vendor thread: no reply yet'],
        uncertainties: [],
      },
    ],
  };
}

export function resultMessage(runId: string, overrides: StreamMessage = {}): StreamMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    terminal_reason: 'completed',
    session_id: runId,
    duration_ms: 6_838,
    duration_api_ms: 5_900,
    num_turns: 5,
    result: '',
    stop_reason: 'tool_use',
    total_cost_usd: 0.02,
    usage: {},
    permission_denials: [],
    structured_output: aResult(),
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 955,
        outputTokens: 17,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        canonicalModel: 'claude-haiku-4-5',
      },
      [PROFILE_MODEL]: {
        inputTokens: 8,
        outputTokens: 267,
        cacheReadInputTokens: 4_052,
        cacheCreationInputTokens: 1_611,
        canonicalModel: PROFILE_MODEL,
      },
    },
    ...overrides,
  };
}

/**
 * A run driven by the test. It yields the messages one at a time and, like the real CLI, throws
 * `Claude Code process aborted by user` after an abort.
 */
export class ScriptedQuery {
  readonly calls: ClaudeQueryParams[] = [];

  constructor(private readonly script: (params: ClaudeQueryParams) => StreamMessage[]) {}

  readonly query: ClaudeQuery = (params) => {
    this.calls.push(params);

    const messages = this.script(params);
    const aborted = (): boolean => params.options.abortController?.signal.aborted === true;

    return (async function* (): AsyncGenerator<StreamMessage> {
      for (const message of messages) {
        await Promise.resolve();

        if (aborted()) throw new Error('Claude Code process aborted by user');

        yield message;
      }
    })();
  };
}
