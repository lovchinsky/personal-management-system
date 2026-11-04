import { DEFAULT_RUN_PROFILE } from '../../src/claude/run-profile';
import { classify } from '../../src/claude/runner/run-classifier';
import { RunObserver } from '../../src/claude/runner/run-observer';
import type { RunOutcome } from '../../src/runs/run-outcome';
import type { TraceView } from '../../src/runs/run-traces';
import { DEADLINE_REACHED } from '../../src/runs/run.launcher';
import { eventEnvelope } from '../../src/runs/trigger-envelope';
import {
  initMessage,
  PLUGIN_DIR,
  resultMessage,
  toolResult,
  toolUse,
  type StreamMessage,
} from '../fixtures/claude-stream.fixture';
import {
  conducted,
  expectMode,
  failedOnUnreadEvidence,
  failureCauseOf,
  HarnessError,
  runCeilingUsd,
  standingOf,
  summaryOf,
  unreached,
  type FailureCause,
  type Trial,
} from './gate-attempts';

describe('the standing of a scenario over its attempts', () => {
  const cases: [string, readonly Trial[], string][] = [
    ['one attempt holds', ['held'], 'proven'],
    ['a violation means `failed`', ['broke'], 'failed'],
    ['a person is needed but was not present', ['incomplete'], 'not_proven'],
    ['only infrastructure failures mean no verdict', ['errored', 'errored'], 'error'],
    ['a failure followed by an attempt that holds', ['errored', 'held'], 'proven'],
    ['a failure followed by a violation', ['errored', 'broke'], 'failed'],
    ['a failure followed by a step without a person', ['errored', 'incomplete'], 'not_proven'],
    ['a violation prevails regardless of the other attempts', ['held', 'broke'], 'failed'],
    ['an empty list means no verdict', [], 'error'],
  ];

  it.each(cases)('%s', (_, trials, expected) => {
    expect(standingOf(trials)).toBe(expected);
  });
});

describe('conducting a scenario', () => {
  /** Attempts that follow one another; `once` hands them out in turn. */
  const sequence = (...trials: Trial[]): { once: () => Promise<Trial>; calls: () => number } => {
    let next = 0;

    return {
      once: () => Promise.resolve(trials[next++] ?? 'errored'),
      calls: () => next,
    };
  };
  const trialOf = (trial: Trial): Trial => trial;

  it('an infrastructure failure is retried, and a retry that holds proves the claim', async () => {
    const run = sequence('errored', 'held');

    await expect(conducted(run.once, trialOf, 1)).resolves.toEqual({
      attempts: ['errored', 'held'],
      standing: 'proven',
    });
  });

  /** A violated claim is a result: rerunning until green would hide it. */
  it('a violation is not retried', async () => {
    const run = sequence('broke', 'held');

    await expect(conducted(run.once, trialOf, 1)).resolves.toEqual({
      attempts: ['broke'],
      standing: 'failed',
    });
    expect(run.calls()).toBe(1);
  });

  it.each<Trial>(['held', 'incomplete'])('attempt %s is not retried', async (trial) => {
    const run = sequence(trial, 'held');

    await conducted(run.once, trialOf, 1);

    expect(run.calls()).toBe(1);
  });

  it('retries do not exceed the allowed number, and the standing is a failure', async () => {
    const run = sequence('errored', 'errored', 'held');

    await expect(conducted(run.once, trialOf, 1)).resolves.toEqual({
      attempts: ['errored', 'errored'],
      standing: 'error',
    });
    expect(run.calls()).toBe(2);
  });

  it('with no retries a failure is the only attempt', async () => {
    const run = sequence('errored', 'held');

    await expect(conducted(run.once, trialOf, 0)).resolves.toMatchObject({
      attempts: ['errored'],
      standing: 'error',
    });
  });

  /** A harness fault is not fixed by a retry, which would only spend one more model run. */
  it('a failure that a retry would not fix is not retried', async () => {
    const run = sequence('errored', 'held');

    await expect(conducted(run.once, trialOf, 1, () => false)).resolves.toEqual({
      attempts: ['errored'],
      standing: 'error',
    });
    expect(run.calls()).toBe(1);
  });

  it('retryability is decided by the last attempt, not the first', async () => {
    const seen: Trial[] = [];
    const run = sequence('errored', 'errored', 'held');

    await conducted(run.once, trialOf, 2, (attempt) => {
      seen.push(attempt);

      return seen.length < 2;
    });

    expect(run.calls()).toBe(2);
  });
});

describe('run mode', () => {
  const envelope = eventEnvelope('event_evaluation', {
    type: 'page.properties_updated',
    event_types: ['page.properties_updated'],
    event_id: 'gate-1',
    timestamp: '2026-10-08T09:00:00.000Z',
    entity_id: 'page-1',
    page_id: 'page-1',
    updated_property_ids: [],
  });

  it('the expected mode passes', () => {
    expect(() => expectMode(envelope, 'event_evaluation', 'reply')).not.toThrow();
  });

  /**
   * A harness fault, not an infrastructure failure: the error type says a retry is useless here.
   */
  it('another mode is a harness fault that names both modes', () => {
    expect(() => expectMode(envelope, 'dialogue', 'reply')).toThrow(HarnessError);
    expect(() => expectMode(envelope, 'dialogue', 'reply')).toThrow(
      'reply: the run would go in event_evaluation, the scenario means dialogue',
    );
  });
});

describe('whose failure the trace recorded', () => {
  const RUN = 'run-1';
  const FALLBACK: StreamMessage = {
    type: 'system',
    subtype: 'model_refusal_fallback',
    trigger: 'refusal',
    direction: 'retry',
    original_model: 'claude-opus-5-5',
    fallback_model: 'claude-sonnet-5',
  };
  const READ_PAGE = [
    toolUse('t1', 'mcp__notion__notion-fetch', { id: 'page-read-1' }),
    toolResult('t1', '{"id":"page-read-1","title":"Launch Alpha"}'),
  ];
  const usage = (model: string, outputTokens: number): Record<string, unknown> => ({
    [model]: {
      inputTokens: 10,
      outputTokens,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      canonicalModel: model,
    },
  });

  interface Stream {
    readonly messages: StreamMessage[];
    readonly problems?: string[];
    readonly deadlineReached?: boolean;
    readonly thrown?: Error;
  }

  /**
   * Returns the classifier's outcome for a stream, the same one a real run's trace would record.
   */
  function classified({
    messages,
    problems = [],
    deadlineReached = false,
    thrown,
  }: Stream): RunOutcome {
    const observer = new RunObserver(
      () => problems,
      () => undefined,
      PLUGIN_DIR,
    );

    for (const message of messages) observer.see(message);

    return classify({
      runId: RUN,
      profile: DEFAULT_RUN_PROFILE,
      observed: observer.observed(),
      deadlineReached,
      notionUnavailableAtInit: false,
      thrown,
      redact: (text) => text,
      pluginDigest: '0a1b2c3d4e5f',
    });
  }

  /** Returns what stays in the trace from a failure outcome: the reason and terminal_reason. */
  function recorded(outcome: RunOutcome): Pick<TraceView, 'status' | 'reason' | 'terminalReason'> {
    if (outcome.status !== 'failed') {
      throw new Error(`the stream was expected to fail, not ${outcome.status}`);
    }

    return {
      status: 'failed',
      reason: outcome.error,
      terminalReason: outcome.report?.terminalReason ?? null,
    };
  }

  /**
   * Every failure branch of `classify()` is named here together with whose failure it is. The
   * classifier builds the reason strings, and a divergence between it and the gate shows up here,
   * not in a verdict that recorded an infrastructure failure as Skill behavior (or the reverse).
   */
  const failures: [string, FailureCause, Stream][] = [
    [
      'init failed the check',
      'infrastructure',
      {
        messages: [initMessage(RUN), resultMessage(RUN)],
        problems: ['tools outside the allow-set: Bash'],
      },
    ],
    [
      'deadline',
      'infrastructure',
      { messages: [initMessage(RUN), ...READ_PAGE], deadlineReached: true },
    ],
    [
      'model substitution',
      'infrastructure',
      { messages: [initMessage(RUN), FALLBACK, resultMessage(RUN)] },
    ],
    ['no result', 'infrastructure', { messages: [initMessage(RUN)] }],
    [
      'no result, the SDK threw an exception',
      'infrastructure',
      { messages: [initMessage(RUN)], thrown: new Error('process exited with code 1') },
    ],
    ['no init', 'infrastructure', { messages: [resultMessage(RUN)] }],
    [
      'result of another session',
      'infrastructure',
      { messages: [initMessage(RUN), resultMessage('run-other')] },
    ],
    [
      'unavailable model (`api_error`)',
      'infrastructure',
      {
        messages: [
          initMessage(RUN),
          resultMessage(RUN, { is_error: true, terminal_reason: 'api_error' }),
        ],
      },
    ],
    [
      '`is_error` without `terminal_reason` means an unauthenticated run',
      'infrastructure',
      {
        messages: [
          initMessage(RUN),
          resultMessage(RUN, { is_error: true, terminal_reason: undefined }),
        ],
      },
    ],
    [
      'the profile model did not work',
      'infrastructure',
      {
        messages: [
          initMessage(RUN),
          ...READ_PAGE,
          resultMessage(RUN, { modelUsage: usage('claude-sonnet-5', 400) }),
        ],
      },
    ],
    [
      'another model did the main work',
      'infrastructure',
      {
        messages: [
          initMessage(RUN),
          ...READ_PAGE,
          resultMessage(RUN, {
            modelUsage: { ...usage('claude-opus-5-5', 20), ...usage('claude-sonnet-5', 900) },
          }),
        ],
      },
    ],
    [
      'turn limit',
      'behaviour',
      {
        messages: [
          initMessage(RUN),
          resultMessage(RUN, {
            subtype: 'error_max_turns',
            is_error: true,
            terminal_reason: 'max_turns',
          }),
        ],
      },
    ],
    [
      'budget limit',
      'behaviour',
      {
        messages: [
          initMessage(RUN),
          resultMessage(RUN, {
            subtype: 'error_max_budget_usd',
            is_error: true,
            terminal_reason: 'budget_exhausted',
          }),
        ],
      },
    ],
    [
      'aborted tool calls',
      'behaviour',
      { messages: [initMessage(RUN), resultMessage(RUN, { terminal_reason: 'aborted_tools' })] },
    ],
    [
      'no structured output',
      'behaviour',
      {
        messages: [
          initMessage(RUN),
          ...READ_PAGE,
          resultMessage(RUN, { structured_output: undefined }),
        ],
      },
    ],
    [
      'result outside the schema',
      'behaviour',
      {
        messages: [
          initMessage(RUN),
          ...READ_PAGE,
          resultMessage(RUN, { structured_output: { operating_phase: ['Guess'] } }),
        ],
      },
    ],
    [
      'evidence citing something unread',
      'behaviour',
      { messages: [initMessage(RUN), resultMessage(RUN)] },
    ],
    [
      'reading outside the plugin directory',
      'behaviour',
      {
        messages: [
          initMessage(RUN),
          toolUse('t1', 'Read', { file_path: '/etc/hosts' }),
          toolResult('t1', '127.0.0.1 localhost'),
          resultMessage(RUN),
        ],
      },
    ],
  ];

  it.each(failures)('%s — %s', (_, cause, stream) => {
    expect(failureCauseOf(recorded(classified(stream)))).toBe(cause);
  });

  /**
   * Two reasons do not come from `classify()`: the runner records an unavailable Notion MCP before
   * launch, and the dispatcher records a session poisoned by a transient failure. Both are
   * infrastructure failures.
   */
  it.each([
    ['Notion MCP is unavailable to the run: the grant refresh failed'],
    ['App effects not applied: the session was poisoned — Notion answered 502'],
  ])('“%s” is an infrastructure failure', (reason) => {
    expect(failureCauseOf({ status: 'failed', reason, terminalReason: null })).toBe(
      'infrastructure',
    );
  });

  /**
   * A string absent from the list is behavior, because a visible failure is better than a hidden
   * retry.
   */
  it.each([
    ['an unknown reason', 'App effects not applied: the page was not found'],
    ['no reason', null],
  ])('%s is behavior', (_, reason) => {
    expect(failureCauseOf({ status: 'failed', reason, terminalReason: null })).toBe('behaviour');
  });

  it.each(['completed', 'deferred', 'abandoned', 'running'] as const)(
    'a run with status %s did not fail',
    (status) => {
      expect(
        failureCauseOf({ status, reason: DEADLINE_REACHED, terminalReason: 'api_error' }),
      ).toBeNull();
    },
  );
});

/**
 * An invalid run in gates M3 and M4 must fail on the unread evidence itself: a run that failed
 * for another reason and a run that did not fail do not show this.
 */
describe('a failure on unread evidence', () => {
  it.each([
    ['failed', 'evidence not read in this run: the page', true],
    ['failed', 'the result does not match the schema', false],
    ['failed', null, false],
    ['completed', 'evidence not read in this run: the page', false],
    ['completed', null, false],
  ] as const)('%s with reason %s: %s', (status, reason, expected) => {
    expect(failedOnUnreadEvidence({ status, reason })).toBe(expected);
  });
});

describe('a run without a conclusion about behavior', () => {
  const trace = (
    status: TraceView['status'],
    reason: string | null = null,
    terminalReason: string | null = null,
  ): Pick<TraceView, 'id' | 'status' | 'reason' | 'terminalReason'> => ({
    id: 'run-1',
    status,
    reason,
    terminalReason,
  });

  it.each([
    ['completed', trace('completed')],
    [
      'an invalid result is a conclusion about the Skill',
      trace('failed', 'the structured output does not match the result schema'),
    ],
    [
      'unread evidence is a conclusion about the Skill',
      trace('failed', 'evidence not read in this run: notion:p1'),
    ],
    [
      'the turn limit is a conclusion about the Skill',
      trace(
        'failed',
        'the run ended with max_turns (subtype error_max_turns, is_error)',
        'max_turns',
      ),
    ],
  ])('%s: there is evidence', (_, run) => {
    expect(unreached(run)).toBeNull();
  });

  it.each([
    ['deferred on the plan quota', trace('deferred', 'plan limit reached (five_hour)'), 'deferred'],
    ['abandoned', trace('abandoned'), 'abandoned'],
    ['still running', trace('running'), 'running'],
    [
      'unavailable model',
      trace('failed', 'the run ended with api_error (subtype success, is_error)', 'api_error'),
      'environment',
    ],
    [
      'an init that cannot be trusted',
      trace('failed', 'init check failed: plugins are none'),
      'environment',
    ],
    ['deadline', trace('failed', DEADLINE_REACHED), 'environment'],
  ])('%s: there is no evidence', (_, run, word) => {
    expect(unreached(run)).toContain(word);
  });

  /**
   * A run whose Notion queries were refused would judge from what it did not see, which is an
   * infrastructure failure.
   */
  it('a completed run whose Notion queries were refused over the allowance yields no evidence', () => {
    expect(unreached(trace('completed'), 2)).toContain('refused 2 Notion queries');
    expect(unreached(trace('completed'), 0)).toBeNull();
  });
});

describe('the verdict summary', () => {
  it('counts scenarios by status, skipping none', () => {
    expect(
      summaryOf({
        first: { status: 'proven' },
        second: { status: 'failed' },
        third: { status: 'proven' },
        fourth: { status: 'not_proven' },
        fifth: { status: 'error' },
        sixth: undefined,
      }),
    ).toEqual({ proven: 2, failed: 1, error: 1, not_proven: 1 });
  });
});

describe('the cost ceiling', () => {
  it('is taken from the run profile, not from a copy of the number', () => {
    expect(runCeilingUsd()).toBe(DEFAULT_RUN_PROFILE.maxBudgetUsd);
  });
});
