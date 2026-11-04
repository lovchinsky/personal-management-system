import type { Options } from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeQueryParams {
  readonly prompt: string;
  readonly options: Options;
}

/**
 * The port to the Agent SDK's `query()`: one invocation is one run, a stream of messages up to
 * the result message.
 *
 * It is a port, not a direct import, because the SDK is ESM-only and jest on Node 22 cannot load
 * it. The real call goes through a dynamic import, the tests through a generator that reproduces
 * a stream measured on a live CLI.
 *
 * Messages are `unknown`: the runner reads the stream with schemas, not with SDK types, because
 * the CLI adds subtypes and fields from version to version.
 */
export type ClaudeQuery = (params: ClaudeQueryParams) => AsyncIterable<unknown>;

export const CLAUDE_QUERY = Symbol('ClaudeQuery');

/** The real `query()`. The SDK is loaded on the first run, not at App startup. */
export const sdkQuery: ClaudeQuery = async function* (params: ClaudeQueryParams) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  yield* query({ prompt: params.prompt, options: params.options });
};
