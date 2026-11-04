# ADR 0031 — An unknown vendor tool is denied rather than stopping runs

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D31` |
| **Related** | ADR 0009 · ADR 0020 · ADR 0045 · `INV-049` · `INV-301` · `INV-302` · `INV-307` |

## Context

The perimeter of an App-triggered run is held by `allowedTools` and `permissionMode: 'dontAsk'`: a call outside the allow-set is denied. The second layer, `disallowedTools`, removes a tool from the model's view: these are all the server tools known to the contract that are not in the mode's row. The `init` check requires `init.tools` to equal the allow-set together with `Read` and the harness tools: an extra tool means the deny layer did not work.

The deny list is made up of the names **known** to the contract. The hosted Notion MCP adds tools without warning, and GBrain is pinned (`GBRAIN_REF`), so its new tools arrive with a version bump; some of the new ones are mutating. An unknown tool lands neither in the allow-set nor in the deny list and shows up in `init`; a strict match would stop every run until someone adds the name to the contract.

## Decision

**When `init` shows extra tools of an external server that the contract does not know, the runner denies them and repeats the launch once.**

- This applies only to Notion and GBrain tools that are in neither the allow-set nor the list known to the contract, and only when they are the sole discrepancy in `init`.
- An abort on `init` happens before the first request to the model, so the first attempt costs a CLI start, and its conclusion is not recorded. The result is the second attempt's.
- The names are remembered for the lifetime of the process (`learned`): later runs deny them at once. The runner logs each name once: it is worth sorting it out in `contracts/canonical.yaml` (`mcp_toolsets`), but safety does not depend on it.
- The strictness of `init` remains: after the retry, an extra tool means a real anomaly. A tool known to the contract that appears in `init` outside the allow-set (the deny layer did not work), a built-in tool, a foreign server, a missing allowed tool, a server status, the plugin and the model — each is a failure without a retry. The server status has two exceptions (`INV-301`): a GBrain that did not connect degrades, and a Notion that does not respond (`failed`, `pending`), when that is the only problem in `init`, defers the run (ADR 0045).
- The perimeter does not widen automatically: an unknown tool does not become available, it is denied. The allow-set remains an authored registry, not one derived from `tools/list` (`INV-307`).

**Rejected:**

- **A live `tools/list` through a separate App client before a run.** The list depends on the transport, the credential and the client's capabilities: the same server gives different clients a different set of tools, so the App's list may not match what the CLI sees. It would also add a new network dependency on every run and a strict parsing of the vendor's schemas, which breaks on the newest tool.
- **Relaxing `init`** (allowing extras within the three prefixes). That would remove the alarm “a known mutating tool in `init`” and change the invariant instead of removing the cause.
- **The glob `mcp__notion__*` in `disallowedTools`.** Deny takes precedence over allow and would wipe out the allow-set too.

## Consequences

- A new name from the vendor does not stop work: the first run after it appears pays for one repeated CLI start, and the rest pay nothing.
- The truth about what a run sees comes from the CLI itself, not from a separate request that could diverge from it.

## Cost

- One extra CLI start for each new name and after each restart of the process, until the name is sorted out in the contract.
- The retry runs with the same `sessionId` — the id of the ledger row — and `persistSession: false`, so it relies on the CLI accepting a second launch of such a session. If the CLI does not accept it, the second attempt fails with its own reason, just as a run without a retry would have failed.
- A drift that persists after the retry still stops the run: this is a deliberate limit, not endless retries.
