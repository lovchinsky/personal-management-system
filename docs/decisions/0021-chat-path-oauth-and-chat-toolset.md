# ADR 0021 — The chat path: the App is itself the authorization server, and chat gets its own toolset

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D21` |
| **Related** | ADR 0003 · ADR 0014 · ADR 0015 · ADR 0017 · `INV-015` · `INV-310` · `INV-313` · `GAP-08` · `GAP-33` |

## Context

Claude Chat — claude.ai, Desktop, mobile, Claude Code — connects to the App MCP as to a remote MCP server and requires OAuth: a 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, resource metadata (RFC 9728) and authorization server metadata (RFC 8414), dynamic client registration (RFC 7591), PKCE S256, `resource` (RFC 8707), a token endpoint with `application/x-www-form-urlencoded` and refresh token rotation, the callbacks `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`, and Claude Code's loopback on an ephemeral port.

Runs have their own bearer, which the App issues and forgets, while the chat session is a different principal: the person speaking for themselves. So the chat path needs answers to four questions: who issues the token, how the owner proves on the consent page that they are the owner, which part of the App the chat sees, and how a chat write is applied when the chat has no run result.

## Decision

**The App is itself the installation owner's authorization server.**

- Endpoints: `/.well-known/oauth-protected-resource` (and the variant with the path `/mcp`), `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`. The issuer is the origin of `APP_MCP_URL`, and the `resource` is `APP_MCP_URL` itself.
- Clients are public: registration is open, but redirect URIs come only from an allowlist (the claude.ai and claude.com callbacks and loopback, ignoring the port). A registered client alone permits nothing.
- Tokens are random, and `app_db` holds only their SHA-256 digests; the access token lasts an hour, the refresh token ninety days and is rotated, and a refresh token presented a second time revokes the whole family. The audience is `APP_MCP_URL`.
- **The owner proves their identity with a passphrase from the environment** (`APP_OAUTH_OWNER_PASSPHRASE`, at least 32 characters). The comparison runs in constant time; after five consecutive failures the lock closes for half a minute, and the duration then doubles up to a quarter of an hour. A message in the channel, if the channel is configured, tells the owner about every consent: the client, the redirect host and a request to revoke the tokens if the owner was not the one who connected. This is detection, not a factor: a failure of the message does not cancel the consent.
- The server is off until both variables are set: its routes answer 404, and `/mcp` stays available only to runs.

**The principal on `/mcp`.** A bearer resolves either to a run session (process memory) or to an OAuth token (the database). A chat token opens the session of the person speaking for themselves — the `chat` actor.

**The chat writes immediately** — under the immediate write policy (ADR 0015). The chat has no run trace: it is not an App run, and its effects go to the structured log.

**The chat has its own App toolset.** `chat_toolset` in the contract names the capabilities the App shows to the chat: conversion, closing and parking of an Inbox item, continuation, delivery, reading proposals, deciding on a proposal, memory write, introspection. It does not show `comment_write` — the person's voice in the chat goes through the Notion MCP — or `approval_propose`: a proposal from the chat that is left unanswered in the same turn stays an Inbox item (`INV-015`). The person chooses the Notion and GBrain tools in the chat; what the App shows is determined by the App itself.

**Chat-only tools.** `park_inbox_item` parks an Inbox item in the system's name (the bot is the author, so the webhook filters it out and there is no second processing) with a comment giving the reasoning; `decide_pending_action` carries the person's decision on a proposal. The chat learns what awaits a decision from `list_pending_actions`.

**Rejected:**

- **An external identity provider.** It is a separate system that has to be run and secured to authorize the owner.
- **Confirming the consent in Telegram instead of a passphrase.** Connecting the chat would depend on a channel that may be unconfigured or unavailable, while the chat is the path that remains when the channel is down.
- **A passphrase plus confirmation in Telegram.** The strictest option, but with the most points of failure at the connection step.

## Consequences

- `approval_decide` and `capture_park` are withheld from runs because only the chat sees them.
- The tables `oauth_clients`, `oauth_codes` and `oauth_tokens` are technical authentication state, not domain memory.
- A new `APP_MCP_URL` invalidates the issued tokens: their audience is a different address, and the chat connects again, with fresh consent (ADR 0003).

## Cost

- The owner passphrase is a static secret. It is protected by its length, the lock that closes after failures, the allowlist of redirect URIs, PKCE, a single-use short-lived code and a message about every consent; none of these protects against theft of the passphrase itself. The second factor is an open gap, `GAP-33`.
- Open client registration accumulates rows: pruning deletes the clients that never got a token, and a ceiling keeps their number bounded.
- The App does not restrict the chat toolset for Notion and GBrain: that boundary is kept by the Skill and the `path-parity rate` metric.
