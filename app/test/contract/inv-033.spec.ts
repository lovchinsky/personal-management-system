import { DEFAULT_RUN_PROFILE } from '../../src/claude/run-profile';
import { classify } from '../../src/claude/runner/run-classifier';
import { RunObserver } from '../../src/claude/runner/run-observer';
import {
  initMessage,
  PLUGIN_DIR,
  PROFILE_MODEL,
  resultMessage,
  StreamMessage,
  toolResult,
  toolUse,
} from '../fixtures/claude-stream.fixture';

function statusOf(modelUsage: Record<string, object>): string {
  const observer = new RunObserver(
    () => [],
    () => undefined,
    PLUGIN_DIR,
  );
  const messages: StreamMessage[] = [
    initMessage('run-1'),
    toolUse('t1', 'mcp__notion__notion-fetch'),
    toolResult('t1', 'page-read-1'),
    resultMessage('run-1', { modelUsage }),
  ];

  for (const message of messages) observer.see(message);

  return classify({
    runId: 'run-1',
    profile: DEFAULT_RUN_PROFILE,
    observed: observer.observed(),
    deadlineReached: false,
    notionUnavailableAtInit: false,
    redact: (text) => text,
    pluginDigest: '0a1b2c3d4e5f',
  }).status;
}

const tokens = (outputTokens: number, canonicalModel: string): object => ({
  inputTokens: 10,
  outputTokens,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  canonicalModel,
});

/**
 * `INV-033` The `modelUsage` of every run is asserted in the trace: the profile's model is present
 * with the same `canonicalModel` and did the main work. Auxiliary CLI entries are not a fallback.
 */
describe('INV-033', () => {
  it("the profile's model with a smaller auxiliary one beside it is an accepted run", () => {
    expect(
      statusOf({
        [PROFILE_MODEL]: tokens(300, PROFILE_MODEL),
        'claude-haiku-4-5-20251001': tokens(17, 'claude-haiku-4-5'),
      }),
    ).toBe('completed');
  });

  it("without the profile's model the run fails", () => {
    expect(statusOf({ 'claude-sonnet-5': tokens(300, 'claude-sonnet-5') })).toBe('failed');
  });

  it("when the profile's model is present but another one did the main work, the run fails", () => {
    expect(
      statusOf({
        [PROFILE_MODEL]: tokens(5, PROFILE_MODEL),
        'claude-sonnet-5': tokens(300, 'claude-sonnet-5'),
      }),
    ).toBe('failed');
  });
});
