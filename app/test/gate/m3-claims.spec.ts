import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../../src/claude/perimeter';
import { NO_MODEL } from '../../src/claude/runner/run-classifier';
import { PLUGIN_NAME } from '../../src/claude/runner/run-invocation';
import { ModelTokens, RunInit, ToolCall } from '../../src/runs/run-outcome';
import { TraceView } from '../../src/runs/run-traces';
import { PLUGIN_DIR, PROFILE_MODEL } from '../fixtures/claude-stream.fixture';
import { INTEGRATION_BOT } from '../fixtures/notion-bot';
import { ClaimName, claimsOf, GateEvidence, GateTraces, PageComment } from './m3-claims';
import { GATE_MODE, INVALID_COMMENT, VALID_COMMENT } from './m3-runs';

function tokens(inputTokens: number, outputTokens: number): ModelTokens {
  return { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
}

const STRUCTURED_OUTPUT: ToolCall = { tool: 'StructuredOutput', ok: true };

/**
 * The init of gate runs has the form of a live CLI 2.1.283 run: our plugin and two built-in
 * ones, three servers, the mode's tool list with the harness tools.
 */
const INIT: RunInit = {
  claudeCodeVersion: '2.1.283',
  model: PROFILE_MODEL,
  permissionMode: 'dontAsk',
  plugins: [
    { name: PLUGIN_NAME, path: PLUGIN_DIR },
    { name: 'agents-md', path: 'builtin' },
    { name: 'telemetry', path: 'builtin' },
  ],
  mcpServers: [
    { name: 'app', status: 'connected' },
    { name: 'notion', status: 'connected' },
    { name: 'gbrain', status: 'connected' },
  ],
  tools: [...HARNESS_TOOLS, ...PLUGIN_TOOLS, ...allowedTools(GATE_MODE)],
};

const VALID: TraceView = {
  id: 'run-valid',
  status: 'completed',
  origin: 'operator',
  budgetClass: 'exempt',
  createdAt: new Date('2026-09-29T11:30:00Z'),
  finishedAt: new Date('2026-09-29T11:30:16Z'),
  latencyMs: 15_900,
  reason: null,
  deferredUntil: null,
  init: INIT,
  toolCalls: [
    { server: 'app', tool: 'get_runtime_state', ok: true },
    { server: 'notion', tool: 'notion-fetch', ok: true },
    { server: 'gbrain', tool: 'whoami', ok: true },
    { server: 'app', tool: 'queue_notification', ok: true },
    { server: 'app', tool: 'add_comment', ok: true },
    STRUCTURED_OUTPUT,
  ],
  policyDecisions: [],
  model: PROFILE_MODEL,
  modelUsage: { [PROFILE_MODEL]: tokens(30, 1_400), 'claude-haiku-4-5': tokens(1_000, 15) },
  numTurns: 6,
  durationMs: 10_903,
  terminalReason: 'completed',
  result: { outcome: 'gate_check' },
  runtimeEffects: [
    { kind: 'comment', id: 'comment-1' },
    { kind: 'delivery', id: 'delivery-1' },
  ],
};

const INVALID: TraceView = {
  ...VALID,
  id: 'run-invalid',
  status: 'failed',
  reason: 'evidence not read in this run: notion:00000000-0000-4000-8000-000000000000',
  toolCalls: [
    { server: 'app', tool: 'get_runtime_state', ok: true },
    { server: 'app', tool: 'queue_notification', ok: true },
    { server: 'app', tool: 'add_comment', ok: true },
    STRUCTURED_OUTPUT,
  ],
  runtimeEffects: [],
};

/**
 * Of the built-ins the model sees only `Read`: it has no shell, and an attempt to read a file
 * outside the plugin directory reaches the perimeter and is denied.
 */
const BUILTIN: TraceView = {
  ...VALID,
  id: 'run-builtin',
  toolCalls: [{ tool: 'Read', ok: false }, STRUCTURED_OUTPUT],
  numTurns: 3,
  runtimeEffects: [],
};

const UNAVAILABLE: TraceView = {
  ...VALID,
  id: 'run-unavailable',
  status: 'failed',
  reason: 'the run ended with api_error (subtype success, is_error)',
  init: { ...INIT, model: 'claude-opus-9-9' },
  toolCalls: [],
  model: NO_MODEL,
  modelUsage: {},
  numTurns: 1,
  terminalReason: 'api_error',
  result: null,
  runtimeEffects: [],
};

const TRACES: GateTraces = {
  valid: VALID,
  invalid: INVALID,
  builtin: BUILTIN,
  unavailable: UNAVAILABLE,
};

const VOICED: PageComment = { text: VALID_COMMENT, author: INTEGRATION_BOT };

const EVIDENCE: GateEvidence = {
  delivered: { idempotency_key: 'gate-m3-valid-k', status: 'pending' },
  leaked: { idempotency_key: 'gate-m3-invalid-k', found: false },
  page: 'page-1',
  comments: [VOICED],
  bot: INTEGRATION_BOT,
  probes: [{ url: 'http://127.0.0.1:3100/mcp', status: 401, challenge: 'Bearer' }],
  publicProbed: false,
  pluginDir: PLUGIN_DIR,
};

/** Returns the names of the claims that what was seen does not prove. */
function unproven(traces: GateTraces, evidence: GateEvidence): string[] {
  return Object.entries(claimsOf(traces, evidence))
    .filter(([, claim]) => !claim.ok)
    .map(([name]) => name);
}

/** A deviation from what the live gate saw. */
interface Deviation {
  readonly traces?: Partial<GateTraces>;
  readonly evidence?: Partial<GateEvidence>;
}

const DEVIATIONS: readonly [string, Deviation, ClaimName][] = [
  [
    'a plugin from another directory',
    {
      traces: {
        valid: {
          ...VALID,
          init: { ...INIT, plugins: [{ name: PLUGIN_NAME, path: '/home/someone/plugin' }] },
        },
      },
    },
    '1_plugin_from_declared_dir',
  ],
  [
    'a foreign plugin from the declared directory',
    {
      traces: {
        valid: { ...VALID, init: { ...INIT, plugins: [{ name: 'other', path: PLUGIN_DIR }] } },
      },
    },
    '1_plugin_from_declared_dir',
  ],
  [
    'a GBrain call failed',
    {
      traces: {
        valid: {
          ...VALID,
          toolCalls: [
            { server: 'app', tool: 'get_runtime_state', ok: true },
            { server: 'notion', tool: 'notion-fetch', ok: true },
            { server: 'gbrain', tool: 'whoami', ok: false },
            STRUCTURED_OUTPUT,
          ],
        },
      },
    },
    '2_three_servers_read',
  ],
  [
    'there is no delivery of the valid run',
    { evidence: { delivered: { idempotency_key: 'gate-m3-valid-k', found: false } } },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'the comment of the valid run was not written by the system',
    { evidence: { comments: [{ text: VALID_COMMENT, author: 'person-1' }] } },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'there are two comments of the valid run',
    { evidence: { comments: [VOICED, VOICED] } },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'the invalid outcome passed',
    { traces: { invalid: { ...INVALID, status: 'completed', reason: null } } },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'the invalid run failed for a reason other than unread evidence',
    {
      traces: {
        invalid: {
          ...INVALID,
          reason: 'the run ended with api_error (subtype success, is_error)',
          terminalReason: 'api_error',
        },
      },
    },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'the invalid run applied an effect',
    { traces: { invalid: { ...INVALID, runtimeEffects: [{ kind: 'comment', id: 'comment-2' }] } } },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'the delivery of the invalid run is in the queue',
    { evidence: { leaked: { idempotency_key: 'gate-m3-invalid-k', status: 'pending' } } },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'the comment of the invalid run is on the page',
    { evidence: { comments: [VOICED, { text: INVALID_COMMENT, author: INTEGRATION_BOT }] } },
    '3_result_valid_and_invalid_leaves_nothing',
  ],
  [
    'init includes a built-in',
    { traces: { valid: { ...VALID, init: { ...INIT, tools: [...INIT.tools, 'Bash'] } } } },
    '4_no_builtin_tools',
  ],
  [
    'the run reached a built-in',
    {
      traces: {
        builtin: { ...BUILTIN, toolCalls: [{ tool: 'Bash', ok: true }, STRUCTURED_OUTPUT] },
      },
    },
    '4_no_builtin_tools',
  ],
  [
    'the run read a file outside the plugin directory',
    {
      traces: {
        builtin: { ...BUILTIN, toolCalls: [{ tool: 'Read', ok: true }, STRUCTURED_OUTPUT] },
      },
    },
    '4_no_builtin_tools',
  ],
  [
    'the run did not try to read a file outside the directory, so the perimeter is unchecked',
    { traces: { builtin: { ...BUILTIN, toolCalls: [STRUCTURED_OUTPUT] } } },
    '4_no_builtin_tools',
  ],
  [
    'the valid run did not run on the profile model',
    { traces: { valid: { ...VALID, model: 'claude-sonnet-5' } } },
    '5_trace_and_no_fallback',
  ],
  [
    'the run on the unavailable model was taken over by another model',
    { traces: { unavailable: { ...UNAVAILABLE, model: 'claude-haiku-4-5' } } },
    '5_trace_and_no_fallback',
  ],
  [
    'the run on the unavailable model got as far as a tool call',
    {
      traces: {
        unavailable: {
          ...UNAVAILABLE,
          toolCalls: [{ server: 'app', tool: 'get_runtime_state', ok: true }],
        },
      },
    },
    '5_trace_and_no_fallback',
  ],
  [
    'the endpoint answered without a bearer',
    { evidence: { probes: [{ url: 'http://127.0.0.1:3100/mcp', status: 200, challenge: null }] } },
    'endpoint_refuses_without_bearer',
  ],
  [
    '401 without a Bearer challenge',
    { evidence: { probes: [{ url: 'http://127.0.0.1:3100/mcp', status: 401, challenge: null }] } },
    'endpoint_refuses_without_bearer',
  ],
];

/**
 * The gate verdict comes from what it saw: the run traces of four runs, deliveries, page
 * comments and endpoint probes.
 */
describe('the verdict of gate M3', () => {
  it('everything is proven on what the live gate saw', () => {
    expect(unproven(TRACES, EVIDENCE)).toEqual([]);
  });

  it("an internal call to the CLI's auxiliary model before the failure is not a fallback", () => {
    const traces: GateTraces = {
      ...TRACES,
      unavailable: { ...UNAVAILABLE, modelUsage: { 'claude-haiku-4-5': tokens(1_032, 10) } },
    };

    expect(unproven(traces, EVIDENCE)).toEqual([]);
  });

  it('an attempt at a built-in that the CLI rejected does not count as reachability', () => {
    const traces: GateTraces = {
      ...TRACES,
      builtin: {
        ...BUILTIN,
        toolCalls: [{ tool: 'Bash', ok: false }, { tool: 'Read', ok: false }, STRUCTURED_OUTPUT],
      },
    };

    expect(unproven(traces, EVIDENCE)).toEqual([]);
  });

  it.each(DEVIATIONS)('%s: only %s is not proven', (_, deviation, claim) => {
    expect(
      unproven({ ...TRACES, ...deviation.traces }, { ...EVIDENCE, ...deviation.evidence }),
    ).toEqual([claim]);
  });
});
