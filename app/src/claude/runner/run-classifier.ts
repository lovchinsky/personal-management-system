import { z } from 'zod';
import { messageOf } from '../../platform/error/message-of';
import {
  ModelTokens,
  RunInit,
  RunObservation,
  RunOutcome,
  RunReport,
} from '../../runs/run-outcome';
import { DEADLINE_REACHED } from '../../runs/run.launcher';
import { qualified } from '../perimeter';
import {
  EvaluationResult,
  evaluationResultSchema,
  SOURCE_UNREADABLE,
} from '../result/evaluation-result';
import { unreadEvidence } from '../result/evidence';
import { RunProfile } from '../run-profile';
import { ObservedStream } from './run-observer';
import { InitMessage, ResultMessage } from './stream';

/**
 * The model in a run's report when the profile's model did no work: the result message is present,
 * but `modelUsage` lacks the profile's model and holds only the CLI's auxiliary model or nothing.
 * This is how a run on an unavailable model ends (`docs/2-system.md` § “Implementation
 * inventory”). Naming the auxiliary model as the run's model would record a fallback that did not
 * happen, and the field cannot be left blank, because it is required once the result message is
 * present (`run_trace_fields`).
 */
export const NO_MODEL = 'none';

interface Classification {
  readonly runId: string;
  readonly profile: RunProfile;
  readonly observed: ObservedStream;
  readonly deadlineReached: boolean;
  /**
   * Init stopped the run only because the Notion server is currently unavailable
   * (`notionUnavailableAtInit`).
   */
  readonly notionUnavailableAtInit: boolean;
  readonly thrown?: unknown;
  /** Removes the run's secrets from a text. */
  readonly redact: (text: string) => string;
  /** The digest of the plugin the run worked from: it goes into the init snapshot. */
  readonly pluginDigest: string;
}

/**
 * The start of the failure reason when the result cites something the run did not read
 * (`INV-036`). The gate checks this reason, because “invalid” without it does not say which layer
 * rejected the result.
 */
export const UNREAD_EVIDENCE = 'evidence not read in this run';

/**
 * Classifies a run's outcome from what the run showed.
 *
 * Failure is reported by `is_error` and `terminal_reason`, not by `subtype`, because `success`
 * also comes with `is_error: true`. After a `success` result with `is_error: true` the SDK throws
 * an exception too, so the result message is classified, not the exception
 * (`docs/2-system.md` § “Run result”). The order of the checks matters: a cause named earlier is
 * more precise than the consequence that accompanies it.
 */
export function classify(input: Classification): RunOutcome {
  const { observed } = input;
  const model = input.profile.model;
  const reached = {
    ...(observed.result && { report: reportOf(observed.result, model) }),
    ...(observed.init && {
      observation: observationOf(observed.init, observed, input.pluginDigest),
    }),
  };
  const failed = (error: string, result?: EvaluationResult): RunOutcome => ({
    status: 'failed',
    error: input.redact(error),
    ...reached,
    ...(result && { result }),
  });

  // Notion unavailable at init is not an abort but a deferral: the model has not started, and a
  // retry later makes sense (ADR 0045).
  if (input.notionUnavailableAtInit) {
    return {
      status: 'deferred',
      cause: 'notion',
      reason: input.redact(`Notion MCP was not connected: ${observed.initProblems.join('; ')}`),
      ...reached,
    };
  }

  const stopped = stopOf(input);
  if (stopped !== undefined) {
    return failed(stopped);
  }

  if (observed.quota) {
    return {
      status: 'deferred',
      cause: 'plan_quota',
      reason: observed.quota.reason,
      ...(observed.quota.resetsAt && { resetsAt: observed.quota.resetsAt }),
      ...reached,
    };
  }

  const { result, init } = observed;
  if (!result) {
    return failed(withoutResult(input.thrown));
  }
  if (!init) {
    return failed('the run reported no init');
  }

  const problem = resultProblem(result, input.runId, model);
  if (problem !== undefined) {
    return failed(problem);
  }

  const parsed = evaluationResultSchema.safeParse(result.structured_output);
  if (!parsed.success) {
    return failed(
      `the structured output does not match the result schema: ${z.prettifyError(parsed.error)}`,
    );
  }

  const unread = unreadEvidence(parsed.data, observed.reads);
  if (unread.length > 0) {
    const listed = unread.map((evidence) => `${evidence.server}:${evidence.ref}`).join(', ');

    return failed(`${UNREAD_EVIDENCE}: ${listed}`, parsed.data);
  }

  if (parsed.data.outcome === SOURCE_UNREADABLE) {
    return unreadable(observed, parsed.data, reached, failed);
  }

  return {
    status: 'completed',
    report: reportOf(result, model),
    observation: observationOf(init, observed, input.pluginDigest),
    result: parsed.data,
  };
}

/**
 * Classifies a run that declared it did not reach Notion (ADR 0045). The App trusts the label only
 * when it sees for itself that Notion was not reached: at least one Notion call failed and none
 * succeeded. Otherwise the outcome is a failure: a run that read anything did reach Notion, and a
 * label without evidence would defer the row endlessly. A call the perimeter did not let through
 * never went to Notion and says nothing about Notion's availability.
 */
function unreadable(
  observed: ObservedStream,
  result: EvaluationResult,
  reached: Pick<Extract<RunOutcome, { status: 'failed' }>, 'report' | 'observation'>,
  failed: (error: string, result?: EvaluationResult) => RunOutcome,
): RunOutcome {
  const denied = new Set(observed.result?.permission_denials.map((denial) => denial.tool_name));
  const notion = observed.toolCalls.filter(
    (call) => call.server === 'notion' && !denied.has(qualified('notion', call.tool)),
  );

  if (notion.some((call) => call.ok)) {
    return failed(`${SOURCE_UNREADABLE} while a Notion read succeeded`, result);
  }

  if (notion.length === 0) {
    return failed(`${SOURCE_UNREADABLE} without a failed Notion read`, result);
  }

  return {
    status: 'deferred',
    cause: 'notion',
    reason: 'no Notion read succeeded',
    ...reached,
    result,
  };
}

/**
 * Returns the reason the run was aborted, if it was: an init that cannot be trusted, a model
 * substitution, a perimeter that did not hold or the deadline. Running into the plan quota is not
 * an abort here: it is a deferral, and so is a substitution that the quota followed.
 */
function stopOf({ observed, deadlineReached }: Classification): string | undefined {
  if (observed.initProblems.length > 0) {
    return `init check failed: ${observed.initProblems.join('; ')}`;
  }

  if (observed.breaches.length > 0) {
    return `perimeter breach: ${observed.breaches.join('; ')}`;
  }

  if (observed.fellBack && !observed.quota) {
    return `model fell back from ${observed.fellBack.from} to ${observed.fellBack.to} (INV-032)`;
  }

  return deadlineReached ? DEADLINE_REACHED : undefined;
}

/** Describes a run without a result message, with the SDK exception as context if there was one. */
function withoutResult(thrown: unknown): string {
  return thrown === undefined
    ? 'the run ended without a result'
    : `the run ended without a result: ${messageOf(thrown)}`;
}

/** Describes what is wrong with the result message before the result is parsed. */
function resultProblem(result: ResultMessage, runId: string, model: string): string | undefined {
  if (result.session_id !== runId) {
    return `the result belongs to session ${result.session_id}, not to this run`;
  }

  if (result.is_error || result.terminal_reason !== 'completed') {
    return (
      `the run ended with ${result.terminal_reason ?? 'no terminal reason'} ` +
      `(subtype ${result.subtype}${result.is_error ? ', is_error' : ''})` +
      (result.errors?.length ? `: ${result.errors.join('; ')}` : '')
    );
  }

  return (
    mainModelProblem(result.modelUsage, model) ??
    (result.structured_output === undefined ? 'the run returned no structured output' : undefined)
  );
}

/**
 * Returns the problem with the main model, if there is one. The profile's model must be present
 * and do the main work (`INV-033`). The CLI also reports a smaller auxiliary model alongside, and
 * that model is not a fallback.
 */
function mainModelProblem(
  usage: Readonly<Record<string, ModelTokens>>,
  model: string,
): string | undefined {
  const entries = Object.entries(usage);
  const profile = profileEntry(entries, model);

  if (!profile) {
    return `the profile model ${model} did no work; models used: ${entries.map(([key]) => key).join(', ') || 'none'}`;
  }

  const main = mainOf(entries);

  if (main && main[0] !== profile[0]) {
    return `${main[0]}, not the profile model ${model}, did the main work`;
  }

  return undefined;
}

/** Finds the `modelUsage` entry of the profile's model, by canonical name or by key. */
function profileEntry(
  entries: readonly [string, ModelTokens][],
  model: string,
): [string, ModelTokens] | undefined {
  return entries.find(([key, tokens]) => (tokens.canonicalModel ?? key) === model || key === model);
}

function mainOf(entries: readonly [string, ModelTokens][]): [string, ModelTokens] | undefined {
  return entries.reduce<[string, ModelTokens] | undefined>(
    (main, entry) => (!main || entry[1].outputTokens > main[1].outputTokens ? entry : main),
    undefined,
  );
}

/**
 * Builds the report of a result message. The run's model is the profile's model in canonical form,
 * if it actually did the work. When it did not, the `INV-033` error says who did the main work,
 * together with the full `modelUsage`.
 */
function reportOf(result: ResultMessage, profileModel: string): RunReport {
  const entries = Object.entries(result.modelUsage);
  const profile = profileEntry(entries, profileModel);

  return {
    model: profile ? (profile[1].canonicalModel ?? profile[0]) : NO_MODEL,
    modelUsage: result.modelUsage,
    numTurns: result.num_turns,
    durationMs: result.duration_ms,
    ...(result.terminal_reason ? { terminalReason: result.terminal_reason } : {}),
  };
}

function observationOf(
  init: InitMessage,
  observed: ObservedStream,
  pluginDigest: string,
): RunObservation {
  const snapshot: RunInit = {
    claudeCodeVersion: init.claude_code_version,
    model: init.model,
    permissionMode: init.permissionMode,
    plugins: init.plugins,
    pluginDigest,
    mcpServers: init.mcp_servers,
    tools: init.tools,
  };

  return {
    init: snapshot,
    toolCalls: observed.toolCalls,
    permissionDenials: observed.result?.permission_denials.map((denial) => denial.tool_name) ?? [],
  };
}
