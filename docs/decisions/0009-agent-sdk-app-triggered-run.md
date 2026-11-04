# ADR 0009 — App-triggered run harness — Claude Agent SDK on a subscription token

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D9` |
| **Related** | ADR 0008 · ADR 0012 · ADR 0020 · ADR 0031 · ADR 0047 · `INV-049` · `INV-219` · `INV-301` · `INV-303` · `INV-304` · `INV-306` · DEF-29 · GAP-13 · GAP-14 · GAP-15 · GAP-16 |

## Context

An App-triggered run executes without a person at the keyboard: the trigger is a Notion event, the scheduler or a runtime event, not the person's message. The interactive path is Claude with the chat plugin and three connectors: App, Notion, GBrain.

The harness of the App-triggered path must provide four properties:

- **the same domain knowledge on both paths** — otherwise the behavior of the Chat path and the App path diverges, and the `path-parity rate` metric has nothing left to measure;
- **a closed tool surface** — the run gets nothing except the three MCP domains and reading its own Skill;
- **reproducibility** — the result of a run does not depend on what is in the settings of the machine the App runs on;
- **authentication available to the installation owner** — without a separate identity service.

The App is written in NestJS/TypeScript.

## Decision

**An App-triggered run executes through the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) under the installation owner's Claude subscription token, with a runner plugin that carries the same domain knowledge as the chat plugin.**

Authentication is by Claude subscription only, through `CLAUDE_CODE_OAUTH_TOKEN`: `claude setup-token` issues the token, and model calls are charged to the plan's usage limits. The App has no other way of authenticating.

The image build assembles the runner plugin from its entry and the knowledge of the chat plugin (ADR 0047): both paths apply the same behavior release (`INV-219`).

## Consequences

- **The plugin is loaded by path.**

  ```typescript
  plugins: [{ type: 'local', path: pluginDir, skipMcpDiscovery: true }]
  ```

  `pluginDir` is `RUNNER_PLUGIN_DIR`, `/app/plugin` in the image. `skipMcpDiscovery` stops the plugin from bringing its own MCP servers: the App declares the servers of a run.

- **The three MCP servers are passed as remote HTTP with an injected bearer.**

  ```typescript
  mcpServers: {
    app:    { type: 'http', url: appMcpUrl,    headers: { Authorization: appBearer },    alwaysLoad: true },
    notion: { type: 'http', url: notionMcpUrl, headers: { Authorization: notionBearer }, alwaysLoad: true },
    gbrain: { type: 'http', url: gbrainMcpUrl, headers: { Authorization: gbrainBearer }, alwaysLoad: true },
  }
  ```

  The SDK performs no interactive OAuth, so the App manages the credentials: it refreshes the Notion MCP grant (Authorization Code + PKCE) and the GBrain token (client_credentials), issues the App MCP bearer for a run and substitutes a fresh bearer into the header on every run. `alwaysLoad` makes the server statuses final at `init`. Notion and App are required; GBrain without a token degrades and does not fail the run (`INV-301`).

- **The tool surface is closed on four sides.**

  ```typescript
  tools: ['Read'],
  disallowedTools: [/* built-in tools + mcp__<server>__<tool> outside the mode's row, by name */],
  allowedTools: [/* the tools of the mode's row in the matrix, by name */, 'Read(//<plugin directory>/**)'],
  permissionMode: 'dontAsk',
  ```

  The perimeter is set by the pair `allowedTools` + `dontAsk`: a call not covered by an allow rule is denied. The `dontAsk` mode matches the nature of the path: there is nobody to ask for permission. The only built-in tool is `Read` in the plugin directory (ADR 0020).

  `tools` and `disallowedTools` work at a different level and so are not a duplicate of the allow set: a deny entry on a bare name strips the tool's definition from the request itself, and Claude does not see it. Claude does see a tool outside the allow set; its call is simply denied. So `disallowedTools` carries both the built-in tools and those `mcp__<server>__<tool>` that must disappear from view in this mode (ADR 0031).

- **Reproducibility.** `settingSources: []` means no source of the machine's settings reaches the run. `strictMcpConfig: true` means only the servers declared programmatically take effect. The run's `env` consists of the declared set of variables (`INV-306`), and `HOME` is a separate temporary directory that the App cleans up after the run.

- **The result is structured.** The evaluation result is validated by `outputFormat: { type: 'json_schema' }`; zod emits the schema in the draft-07 dialect.

## Cost

- **One subprocess per run, about 1 GiB, with no top-level session timeout.** The App enforces the bound through four mechanisms: its own queue with limited concurrency, `maxTurns`, `maxBudgetUsd` and its own `AbortController`, which aborts the run before its ticket expires (`INV-304`).

- **Model calls are charged to the plan's usage limits.** The system and the owner share a single quota: an unbounded loop of runs degrades the owner's own interactive work. The run budget (`run_budget`) and deferral on reaching the plan quota (ADR 0012) keep the plan available.

- **No source confirms that a subscription token is suitable for an unattended server-side run.** The token is documented for Claude Code in CI, and the Agent SDK hosting page does not cover it. This is a property of the chosen mechanism, not an argument for a different credential — GAP-14.

- **Retention on the providers' side is not established.** Model traffic goes to `api.anthropic.com` under the subscription token, and tool traffic goes from the container to the three MCP hosts. What part of this is stored, for how long and under what contract — GAP-16.

- **An oversized tool result becomes a dead end inside the run.** The CLI writes the result of an MCP tool above the `MAX_MCP_OUTPUT_TOKENS` limit (a run sets 50,000 tokens) to a file and replaces it with an error naming that file; the file lies outside the plugin directory, so `Read` cannot read it. App MCP responses are bounded by construction (`INV-303`), and for Notion and GBrain the remedy is the Skill's discipline of selective reads (DEF-29).

- **Managed organization policies take precedence over programmatic options.** The runner checks their consequences where `init` shows them (permission mode, the set of tools, the model, the servers) and aborts the run on a discrepancy. The `effort` level stays invisible, and so does the set of policies in force itself — GAP-13.

- **The CLI binary ships with the version of the SDK package.** An SDK upgrade changes the harness, not just the library. Whether an SDK upgrade falls under the comparison of eval results in the same way as a change to the prompt is not stated anywhere — GAP-15.
