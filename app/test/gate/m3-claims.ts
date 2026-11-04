import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { allowedTools, HARNESS_TOOLS, PLUGIN_TOOLS } from '../../src/claude/perimeter';
import { profileFor } from '../../src/claude/run-profile';
import { NO_MODEL } from '../../src/claude/runner/run-classifier';
import { PLUGIN_NAME } from '../../src/claude/runner/run-invocation';
import { DeliveryAbsentWire, DeliveryStateWire } from '../../src/delivery/delivery.wire';
import { McpServerName } from '../../src/generated/prisma/enums';
import { ToolCall } from '../../src/runs/run-outcome';
import { TraceView } from '../../src/runs/run-traces';
import { MCP_SERVER_NAMES } from '../../src/runs/toolsets';
import { failedOnUnreadEvidence } from './gate-attempts';
import { GATE_MODE, GateRun, INVALID_COMMENT, VALID_COMMENT } from './m3-runs';

/** The traces of the gate's runs. */
export type GateTraces = Readonly<Record<GateRun, TraceView>>;

/** A comment on the gate page: its text and who wrote it. */
export interface PageComment {
  readonly text: string;
  readonly author: string;
}

/** The App MCP endpoint's answer to a request without a bearer. */
export interface Probe {
  readonly url: string;
  readonly status: number;
  readonly challenge: string | null;
}

/** The state of a delivery by its key, as the delivery returns it. */
type DeliveryState = DeliveryStateWire | DeliveryAbsentWire;

/** What the gate saw outside the traces, and what is declared. */
export interface GateEvidence {
  /** The delivery of the valid run. */
  readonly delivered: DeliveryState;
  /** The delivery of the invalid run: there must be none. */
  readonly leaked: DeliveryState;
  readonly page: string;
  readonly comments: readonly PageComment[];
  /** The integration bot is the author of the system's writes. */
  readonly bot: string;
  /** The App MCP's own endpoint, always; the public one, if configured. */
  readonly probes: readonly Probe[];
  readonly publicProbed: boolean;
  /** The plugin directory the runner's environment declares. */
  readonly pluginDir: string;
}

/** A gate claim: whether it is proven, and on what. */
interface Claim {
  readonly ok: boolean;
  readonly detail: unknown;
}

export type ClaimName =
  | '1_plugin_from_declared_dir'
  | '2_three_servers_read'
  | '3_result_valid_and_invalid_leaves_nothing'
  | '4_no_builtin_tools'
  | '5_trace_and_no_fallback'
  | 'endpoint_refuses_without_bearer';

/**
 * Evaluates what the observations prove.
 *
 * The claims are gate criteria 1–5 in `docs/5-plan.md` § “M3 — App MCP and Agent SDK runner”. The
 * probe is a 401 without a bearer on the App MCP's own endpoint and, when configured, on the
 * public one.
 */
export function claimsOf(
  traces: GateTraces,
  evidence: GateEvidence,
): Readonly<Record<ClaimName, Claim>> {
  return {
    '1_plugin_from_declared_dir': pluginClaim(traces.valid, evidence.pluginDir),
    '2_three_servers_read': serversClaim(traces.valid),
    '3_result_valid_and_invalid_leaves_nothing': effectsClaim(traces, evidence),
    '4_no_builtin_tools': perimeterClaim(traces),
    '5_trace_and_no_fallback': traceClaim(traces),
    endpoint_refuses_without_bearer: {
      ok: evidence.probes.every(refuses),
      detail: {
        probes: evidence.probes,
        public: evidence.publicProbed ? 'probed' : 'APP_MCP_URL not configured',
      },
    },
  };
}

function pluginClaim(valid: TraceView, pluginDir: string): Claim {
  const plugin = valid.init?.plugins.find((loaded) => loaded.path !== 'builtin');

  return {
    ok: plugin?.name === PLUGIN_NAME && resolve(plugin.path) === resolve(pluginDir),
    detail: valid.init?.plugins ?? null,
  };
}

function serversClaim(valid: TraceView): Claim {
  const readFrom = (server: McpServerName): boolean =>
    valid.toolCalls?.some((call) => call.server === server && call.ok) === true;

  return {
    ok: MCP_SERVER_NAMES.every(readFrom),
    detail: { servers: valid.init?.mcpServers ?? null, calls: valid.toolCalls },
  };
}

function effectsClaim({ valid, invalid }: GateTraces, evidence: GateEvidence): Claim {
  const withText = (text: string): PageComment[] =>
    evidence.comments.filter((comment) => comment.text.includes(text));
  const voiced = withText(VALID_COMMENT);

  return {
    ok:
      valid.status === 'completed' &&
      'status' in evidence.delivered &&
      // The valid run leaves exactly one comment, and the system wrote it.
      voiced.length === 1 &&
      voiced.every((comment) => comment.author === evidence.bot) &&
      failedOnUnreadEvidence(invalid) &&
      (invalid.runtimeEffects ?? []).length === 0 &&
      'found' in evidence.leaked &&
      withText(INVALID_COMMENT).length === 0,
    detail: {
      valid: { status: valid.status, result: valid.result, effects: valid.runtimeEffects },
      delivered: evidence.delivered,
      invalid: { status: invalid.status, reason: invalid.reason, effects: invalid.runtimeEffects },
      leaked: evidence.leaked,
      page: evidence.page,
      bot: evidence.bot,
      comments: evidence.comments,
    },
  };
}

function perimeterClaim(traces: GateTraces): Claim {
  const { valid, builtin } = traces;
  const expected = [...allowedTools(GATE_MODE), ...PLUGIN_TOOLS, ...HARNESS_TOOLS].sort();
  const reachedOutside = Object.entries(traces).flatMap(([name, trace]) =>
    (trace.toolCalls ?? []).filter(reachesOutside).map((call) => `${name}: ${call.tool}`),
  );

  return {
    ok:
      isDeepStrictEqual([...(valid.init?.tools ?? [])].sort(), expected) &&
      builtin.status === 'completed' &&
      reachedOutside.length === 0 &&
      readOutsideDenied(builtin),
    detail: {
      init: valid.init?.tools ?? null,
      expected,
      attempt: {
        status: builtin.status,
        reason: builtin.reason,
        calls: builtin.toolCalls,
        decisions: builtin.policyDecisions,
      },
      reached_outside: reachedOutside,
    },
  };
}

/**
 * Checks whether a call is a built-in the run reached: a successful call outside the three MCP
 * domains and the harness tools. In this run `Read` reads `/etc/hostname`, so a successful `Read`
 * is outside the plugin directory too. An attempt the CLI rejected stays failed.
 */
function reachesOutside(call: ToolCall): boolean {
  return call.ok && call.server === undefined && !HARNESS_TOOLS.includes(call.tool);
}

/**
 * `Read` is the only built-in tool the run sees, so an attempt to read a file outside the plugin
 * directory must reach the perimeter and be denied, not go unnoticed: otherwise nothing proves
 * the claim that nothing outside the directory is read.
 */
function readOutsideDenied({ toolCalls }: TraceView): boolean {
  const reads = (toolCalls ?? []).filter(
    (call) => call.server === undefined && call.tool === 'Read',
  );

  return reads.length > 0 && reads.every((call) => !call.ok);
}

/**
 * A fallback would mean another model did the run's work. A run on a model that does not exist
 * must fail without having done anything: no tool call, no result. The CLI's internal call to an
 * auxiliary model, which completes before the failure, is not the run's work.
 */
function traceClaim({ valid, unavailable }: GateTraces): Claim {
  return {
    ok:
      valid.id.length > 0 &&
      valid.modelUsage !== null &&
      valid.numTurns !== null &&
      valid.durationMs !== null &&
      valid.model === profileFor(GATE_MODE).model &&
      unavailable.status === 'failed' &&
      unavailable.model === NO_MODEL &&
      unavailable.result === null &&
      (unavailable.toolCalls ?? []).length === 0,
    detail: {
      session_id: valid.id,
      model: valid.model,
      modelUsage: valid.modelUsage,
      num_turns: valid.numTurns,
      duration_ms: valid.durationMs,
      unavailable: {
        status: unavailable.status,
        reason: unavailable.reason,
        model: unavailable.model,
        modelUsage: unavailable.modelUsage,
        toolCalls: unavailable.toolCalls,
      },
    },
  };
}

/**
 * Checks whether a probe shows the refusal without a bearer: a 401 with no explanation
 * (`docs/2-system.md` § “Authentication boundary”) and the `Bearer` challenge that RFC 6750
 * requires.
 */
function refuses(probe: Probe): boolean {
  return probe.status === 401 && probe.challenge?.startsWith('Bearer') === true;
}
