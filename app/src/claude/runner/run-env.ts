/**
 * The limit on an MCP tool's result in a run (`MAX_MCP_OUTPUT_TOKENS`). The CLI's default limit
 * is 25,000 tokens; a run doubles it (`docs/2-system.md` § “Tool surface boundaries”), and the
 * App MCP answers far below it (`INV-303`).
 */
export const MAX_MCP_OUTPUT_TOKENS = 50_000;

/** The names of a run's environment variables: exactly these and no other (`INV-306`). */
export const RUN_ENV_NAMES = [
  'PATH',
  'HOME',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
  'MAX_MCP_OUTPUT_TOKENS',
] as const;

export type RunEnv = Readonly<Record<(typeof RUN_ENV_NAMES)[number], string>>;

/**
 * Builds the environment of a run's subprocess.
 *
 * `env` in the SDK's TypeScript surface **replaces** the process environment instead of merging
 * with it, so the environment is part of the definition of a run: it is built from a declared set,
 * not inherited from the App (`docs/2-system.md` § “Run invocation”). `HOME` is a separate
 * temporary directory of the run, because even without a transcript the CLI writes its state, the
 * organization's policies and oversized tool results there.
 */
export function runEnv(home: string, path: string, oauthToken: string): RunEnv {
  return {
    PATH: path,
    HOME: home,
    CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    MAX_MCP_OUTPUT_TOKENS: String(MAX_MCP_OUTPUT_TOKENS),
  };
}
