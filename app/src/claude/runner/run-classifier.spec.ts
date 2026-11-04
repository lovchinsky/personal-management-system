import {
  aResult,
  initMessage,
  PLUGIN_DIR,
  PROFILE_MODEL,
  rateLimitEvent,
  resultMessage,
  StreamMessage,
  toolResult,
  toolUse,
} from '../../../test/fixtures/claude-stream.fixture';
import { RunOutcome } from '../../runs/run-outcome';
import { DEADLINE_REACHED } from '../../runs/run.launcher';
import { EvaluationResult, SOURCE_UNREADABLE } from '../result/evaluation-result';
import { DEFAULT_RUN_PROFILE } from '../run-profile';
import { classify, NO_MODEL } from './run-classifier';
import { ObservedStream, RunObserver } from './run-observer';

const RUN = 'run-1';
const PLUGIN_FINGERPRINT = '0a1b2c3d4e5f';

/** Reads a stream the way the runner reads it, without the init check unless stated otherwise. */
function observed(messages: StreamMessage[], problems: string[] = []): ObservedStream {
  const observer = new RunObserver(
    () => problems,
    () => undefined,
    PLUGIN_DIR,
  );

  for (const message of messages) observer.see(message);

  return observer.observed();
}

/** A run that read the page the result's evidence points to. */
const READ_PAGE = [
  toolUse('t1', 'mcp__notion__notion-fetch', { id: 'page-read-1' }),
  toolResult('t1', '{"id":"page-read-1","title":"Launch Alpha"}'),
];

function outcomeOf(
  messages: StreamMessage[],
  extra: Partial<Parameters<typeof classify>[0]> = {},
): RunOutcome {
  return classify({
    runId: RUN,
    profile: DEFAULT_RUN_PROFILE,
    observed: observed(messages),
    deadlineReached: false,
    notionUnavailableAtInit: false,
    pluginDigest: PLUGIN_FINGERPRINT,
    redact: (text) => text,
    ...extra,
  });
}

describe('run outcome', () => {
  it('is `completed` for a valid run, with three snapshots', () => {
    const outcome = outcomeOf([initMessage(RUN), ...READ_PAGE, resultMessage(RUN)]);

    expect(outcome).toMatchObject({
      status: 'completed',
      report: { model: PROFILE_MODEL, numTurns: 5, durationMs: 6_838, terminalReason: 'completed' },
      result: aResult(),
    });
    expect(outcome.status === 'completed' && outcome.observation.toolCalls).toEqual([
      { server: 'notion', tool: 'notion-fetch', ok: true },
    ]);
  });

  /**
   * The plugin declares no version: the digest of its content says which Skill the run worked
   * from.
   */
  it('includes the plugin digest in the init snapshot', () => {
    const outcome = outcomeOf([initMessage(RUN), ...READ_PAGE, resultMessage(RUN)]);

    expect(outcome.status === 'completed' && outcome.observation.init.pluginDigest).toBe(
      PLUGIN_FINGERPRINT,
    );
  });

  /**
   * Failure is reported by `is_error` and `terminal_reason`, not by `subtype`
   * (`docs/2-system.md` § “Run result”). Each row is a shape of a result message, measured live
   * or named in the SDK types.
   */
  const failures: [string, StreamMessage][] = [
    ['success with is_error: unavailable model', { is_error: true, terminal_reason: 'api_error' }],
    [
      'success with is_error and no terminal_reason: unauthenticated run',
      { is_error: true, terminal_reason: undefined },
    ],
    ['turn limit', { subtype: 'error_max_turns', is_error: true, terminal_reason: 'max_turns' }],
    [
      'budget limit',
      { subtype: 'error_max_budget_usd', is_error: true, terminal_reason: 'budget_exhausted' },
    ],
    ['success without an error but not completed', { terminal_reason: 'aborted_tools' }],
    ['success without terminal_reason', { terminal_reason: undefined }],
  ];

  it.each(failures)('is `failed` for %s', (_, overrides) => {
    const outcome = outcomeOf([initMessage(RUN), ...READ_PAGE, resultMessage(RUN, overrides)]);

    expect(outcome.status).toBe('failed');
  });

  /** The live shape of a result message for a model that does not exist: no model did the work. */
  it('is `failed` for an unavailable model, and the report attributes the work to no model', () => {
    const outcome = outcomeOf([
      initMessage(RUN),
      resultMessage(RUN, {
        is_error: true,
        terminal_reason: 'api_error',
        num_turns: 1,
        modelUsage: {},
      }),
    ]);

    expect(outcome).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('api_error'),
      report: { model: NO_MODEL, modelUsage: {} },
    });
  });

  /**
   * The same unavailable model, when the CLI's auxiliary model managed to do its own utility call:
   * it does not become the run's model, otherwise the run trace would record a fallback that did
   * not happen.
   */
  it('does not make the auxiliary model the run model when the profile model is unavailable', () => {
    const outcome = outcomeOf([
      initMessage(RUN),
      resultMessage(RUN, {
        is_error: true,
        terminal_reason: 'api_error',
        num_turns: 1,
        modelUsage: {
          'claude-haiku-4-5-20251001': {
            inputTokens: 1_032,
            outputTokens: 10,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            canonicalModel: 'claude-haiku-4-5',
          },
        },
      }),
    ]);

    expect(outcome).toMatchObject({ status: 'failed', report: { model: NO_MODEL } });
  });

  it('keeps the report of a `failed` run that reached the result', () => {
    const outcome = outcomeOf([
      initMessage(RUN),
      resultMessage(RUN, { is_error: true, terminal_reason: 'api_error' }),
    ]);

    expect(outcome).toMatchObject({ status: 'failed', report: { numTurns: 5 } });
  });

  /** The SDK throws after a result with `is_error` too: the result decides, not the exception. */
  it('does not let an exception after the result override the result', () => {
    const outcome = outcomeOf(
      [initMessage(RUN), resultMessage(RUN, { is_error: true, terminal_reason: 'api_error' })],
      { thrown: new Error('Claude Code returned an error result') },
    );

    expect(outcome.status === 'failed' && outcome.error).toContain('api_error');
  });

  it('is `failed` with a reason for an exception without a result', () => {
    const outcome = outcomeOf([initMessage(RUN)], {
      thrown: new Error('process exited with code 1'),
    });

    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('code 1') });
  });

  it('is `failed` for a result of another session, as a technical failure', () => {
    expect(outcomeOf([initMessage(RUN), resultMessage('run-other')]).status).toBe('failed');
  });

  describe('model (INV-033)', () => {
    it('does not count an auxiliary smaller model alongside as a fallback', () => {
      expect(outcomeOf([initMessage(RUN), ...READ_PAGE, resultMessage(RUN)]).status).toBe(
        'completed',
      );
    });

    it('is `failed` for a profile model that did no work', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        ...READ_PAGE,
        resultMessage(RUN, {
          modelUsage: {
            'claude-sonnet-5': {
              inputTokens: 10,
              outputTokens: 400,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              canonicalModel: 'claude-sonnet-5',
            },
          },
        }),
      ]);

      expect(outcome).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('did no work'),
      });
    });

    it('is `failed` when another model does the main work', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        ...READ_PAGE,
        resultMessage(RUN, {
          modelUsage: {
            [PROFILE_MODEL]: {
              inputTokens: 10,
              outputTokens: 20,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              canonicalModel: PROFILE_MODEL,
            },
            'claude-sonnet-5': {
              inputTokens: 10,
              outputTokens: 900,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              canonicalModel: 'claude-sonnet-5',
            },
          },
        }),
      ]);

      expect(outcome).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('main work'),
      });
    });
  });

  describe('result (INV-035, INV-036)', () => {
    it('is `failed` without structured output', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        ...READ_PAGE,
        resultMessage(RUN, { structured_output: undefined }),
      ]);

      expect(outcome).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('no structured'),
      });
    });

    it('is `failed` for a result outside the schema', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        ...READ_PAGE,
        resultMessage(RUN, { structured_output: { ...aResult(), operating_phase: ['Guess'] } }),
      ]);

      expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('schema') });
    });

    it('is `failed` for evidence citing something unread, and the result stays in the trace', () => {
      const outcome = outcomeOf([initMessage(RUN), resultMessage(RUN)]);

      expect(outcome).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('notion:page-read-1'),
        result: aResult(),
      });
    });

    it('does not count evidence read through another server as read', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        toolUse('t1', 'mcp__gbrain__get_page', { slug: 'page-read-1' }),
        toolResult('t1', 'page-read-1: nothing notable'),
        resultMessage(RUN),
      ]);

      expect(outcome.status).toBe('failed');
    });

    it('does not count a failed call as a read', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        toolUse('t1', 'mcp__notion__notion-fetch', { id: 'page-read-1' }),
        toolResult('t1', 'object page-read-1 not found', true),
        resultMessage(RUN),
      ]);

      expect(outcome.status).toBe('failed');
    });
  });

  describe('plan quota (ADR 0012)', () => {
    it('is `deferred` until the reset time after a quota refusal', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        rateLimitEvent({ status: 'rejected', resetsAt: 1_790_557_800 }),
      ]);

      expect(outcome).toEqual(
        expect.objectContaining({ status: 'deferred', resetsAt: new Date(1_790_557_800_000) }),
      );
    });

    it('treats overage as a quota too, not a failure', () => {
      const outcome = outcomeOf([initMessage(RUN), rateLimitEvent({ isUsingOverage: true })]);

      expect(outcome.status).toBe('deferred');
    });

    it('treats an ordinary limit event with status `allowed` as a normal run', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        rateLimitEvent({ status: 'allowed' }),
        ...READ_PAGE,
        resultMessage(RUN),
      ]);

      expect(outcome.status).toBe('completed');
    });

    it('is `deferred` for `blocking_limit` in the result', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        resultMessage(RUN, { is_error: true, terminal_reason: 'blocking_limit' }),
      ]);

      expect(outcome.status).toBe('deferred');
    });
  });

  it('is `failed` at the deadline even if something got done', () => {
    const outcome = outcomeOf([initMessage(RUN), ...READ_PAGE], { deadlineReached: true });

    expect(outcome).toMatchObject({ status: 'failed', error: DEADLINE_REACHED });
  });

  /** The classifier assembles the list of reasons: the observer only remembers that init failed. */
  it('is `failed` with a list of reasons for an init that cannot be trusted', () => {
    const outcome = classify({
      runId: RUN,
      profile: DEFAULT_RUN_PROFILE,
      observed: observed(
        [initMessage(RUN), resultMessage(RUN)],
        ['tools outside the allow-set: Bash', 'plugins are none'],
      ),
      deadlineReached: false,
      notionUnavailableAtInit: false,
      pluginDigest: PLUGIN_FINGERPRINT,
      redact: (text) => text,
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      error: 'init check failed: tools outside the allow-set: Bash; plugins are none',
    });
  });

  /**
   * An init that cannot be trusted is more precise than the quota that came after it: its reason
   * comes first.
   */
  it('lets an init that cannot be trusted outweigh the plan quota', () => {
    const outcome = classify({
      runId: RUN,
      profile: DEFAULT_RUN_PROFILE,
      observed: observed(
        [initMessage(RUN), rateLimitEvent({ status: 'rejected' })],
        ['tools outside the allow-set: Bash'],
      ),
      deadlineReached: false,
      notionUnavailableAtInit: false,
      pluginDigest: PLUGIN_FINGERPRINT,
      redact: (text) => text,
    });

    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringContaining('Bash') });
  });

  describe('model substitution (INV-032)', () => {
    const FALLBACK: StreamMessage = {
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'claude-opus-5-5',
      fallback_model: 'claude-sonnet-5',
    };

    it('is `failed` with an error that names both models', () => {
      const outcome = outcomeOf([initMessage(RUN), FALLBACK, resultMessage(RUN)]);

      expect(outcome).toMatchObject({
        status: 'failed',
        error: 'model fell back from claude-opus-5-5 to claude-sonnet-5 (INV-032)',
      });
    });

    /** A substitution followed by a plan quota is a deferral, not a failure: the run is retried. */
    it('is `deferred` for a substitution together with a plan quota', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        FALLBACK,
        rateLimitEvent({ status: 'rejected' }),
      ]);

      expect(outcome.status).toBe('deferred');
    });
  });

  /**
   * A run that did not reach Notion is a deferral, not a failure (ADR 0045). The App believes a run
   * did not reach Notion only when it sees that for itself: an init without Notion (and only
   * without it), or a result label under which no Notion call succeeded and at least one failed.
   */
  describe('Notion unavailable (ADR 0045)', () => {
    const NOTION_DOWN = 'required MCP server notion is failed';

    it('is `deferred`, not `failed`, for an init that stopped only on Notion', () => {
      const outcome = classify({
        runId: RUN,
        profile: DEFAULT_RUN_PROFILE,
        observed: observed([initMessage(RUN)], [NOTION_DOWN]),
        deadlineReached: false,
        notionUnavailableAtInit: true,
        pluginDigest: PLUGIN_FINGERPRINT,
        redact: (text) => text,
      });
      const expected: Partial<RunOutcome> = {
        status: 'deferred',
        cause: 'notion',
        reason: `Notion MCP was not connected: ${NOTION_DOWN}`,
      };

      expect(outcome).toMatchObject(expected);
    });

    /** The model has not started: a quota that came after is a consequence, not the cause. */
    it('lets Notion at init outweigh the plan quota', () => {
      const outcome = classify({
        runId: RUN,
        profile: DEFAULT_RUN_PROFILE,
        observed: observed(
          [initMessage(RUN), rateLimitEvent({ status: 'rejected' })],
          [NOTION_DOWN],
        ),
        deadlineReached: false,
        notionUnavailableAtInit: true,
        pluginDigest: PLUGIN_FINGERPRINT,
        redact: (text) => text,
      });

      expect(outcome).toMatchObject({ status: 'deferred', cause: 'notion' });
    });

    it('is `deferred` with the cause `plan_quota` for a plan quota', () => {
      const outcome = outcomeOf([initMessage(RUN), rateLimitEvent({ status: 'rejected' })]);

      expect(outcome).toMatchObject({ status: 'deferred', cause: 'plan_quota' });
    });

    const UNREADABLE: EvaluationResult = {
      ...aResult(),
      outcome: SOURCE_UNREADABLE,
      detections: [],
    };
    const unreadable = (calls: StreamMessage[]): RunOutcome =>
      outcomeOf([
        initMessage(RUN),
        ...calls,
        resultMessage(RUN, { structured_output: UNREADABLE }),
      ]);

    const FAILED_READ: StreamMessage[] = [
      toolUse('t1', 'mcp__notion__notion-fetch', { id: 'page-1' }),
      toolResult('t1', 'Notion is temporarily unavailable', true),
    ];

    it('is `deferred` for a label under which no Notion call succeeded and one failed', () => {
      const expected: Partial<RunOutcome> = {
        status: 'deferred',
        cause: 'notion',
        reason: 'no Notion read succeeded',
        result: UNREADABLE,
      };

      expect(unreadable(FAILED_READ)).toMatchObject(expected);
    });

    /** A run that read anything did reach Notion: a deleted page beside it is no unavailability. */
    it('is `failed` for a label next to a successful read', () => {
      const SUCCEEDED_READ: StreamMessage[] = [
        toolUse('t2', 'mcp__notion__notion-search', { query: 'Launch' }),
        toolResult('t2', '{"results":[]}'),
      ];

      expect(unreadable([...FAILED_READ, ...SUCCEEDED_READ])).toMatchObject({
        status: 'failed',
        error: `${SOURCE_UNREADABLE} while a Notion read succeeded`,
        result: UNREADABLE,
      });
    });

    const unproven: [string, StreamMessage[]][] = [
      ['with no Notion call at all', []],
      [
        'with only a failed GBrain call',
        [
          toolUse('t1', 'mcp__gbrain__get_page', { slug: 'launch' }),
          toolResult('t1', 'GBrain is unavailable', true),
        ],
      ],
    ];

    /** A label without evidence would defer the row endlessly. */
    it.each(unproven)('is `failed` for a label %s', (_, calls) => {
      expect(unreadable(calls)).toMatchObject({
        status: 'failed',
        error: `${SOURCE_UNREADABLE} without a failed Notion read`,
      });
    });

    /**
     * A call the perimeter did not let through never went to Notion: it is no evidence of
     * unavailability.
     */
    it('is `failed` for a label under which Notion “went down” only because the perimeter denied the call', () => {
      const outcome = outcomeOf([
        initMessage(RUN),
        ...FAILED_READ,
        resultMessage(RUN, {
          structured_output: UNREADABLE,
          permission_denials: [{ tool_name: 'mcp__notion__notion-fetch' }],
        }),
      ]);

      expect(outcome).toMatchObject({
        status: 'failed',
        error: `${SOURCE_UNREADABLE} without a failed Notion read`,
      });
    });
  });

  it('passes an error through secret redaction', () => {
    const outcome = outcomeOf([initMessage(RUN)], {
      thrown: new Error('connect failed with Bearer secret-token-123'),
      redact: (text) => text.replace('secret-token-123', '[redacted]'),
    });

    expect(outcome.status === 'failed' && outcome.error).not.toContain('secret-token-123');
  });
});
