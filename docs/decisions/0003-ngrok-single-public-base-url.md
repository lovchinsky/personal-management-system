# ADR 0003 — Public HTTPS on the local machine is a tunnel; webhook addresses derive from one operator-set value

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D3` |
| **Related** | ADR 0007 · ADR 0021 · `S6` |

## Context

Three parties reach the App from outside, and each requires public HTTPS: Notion and Telegram deliver webhooks, and Claude Chat connects to the App MCP and to GBrain. On a server, Caddy with a domain provides the public name and the certificate. The local machine has no public name: the App and GBrain listen there on `127.0.0.1:3000` and `127.0.0.1:3131`.

Each provider keeps the webhook address in its own registration (Telegram's `setWebhook`, Notion's webhook subscription), so changing the address requires repeating each of them (`S6`).

## Decision

**The local machine gets public HTTPS through a tunnel (the RUNBOOK gives ngrok as its example), and the App's public base address is one operator-set value, `APP_PUBLIC_BASE_URL` in `infra/.env.example`, from which the RUNBOOK derives the webhook registration addresses. The App does not read it.**

- There are two tunnels, one to the App and one to GBrain, because GBrain has its own host.
- The Notion webhook callback (`/webhooks/notion`) and the Telegram webhook (`/webhooks/telegram`) derive from `APP_PUBLIC_BASE_URL`.
- The MCP addresses for chat are separate variables: `APP_MCP_URL` for the App (the resource and the issuer of its authorization server) and `GBRAIN_PUBLIC_URL` and `GBRAIN_MCP_URL` for GBrain.
- On a server, the public names are `APP_DOMAIN` and `GBRAIN_DOMAIN`: Caddy obtains certificates for them (`infra/caddy/Caddyfile`), and `compose.prod.yaml` derives the address `GBRAIN_PUBLIC_URL` from `GBRAIN_DOMAIN`. So `GBRAIN_PUBLIC_URL` and `GBRAIN_MCP_URL` are empty in the server's environment file.

## Consequences

- A new base address means a new registration of every derived endpoint: the Telegram webhook and the Notion subscription, and a new subscription changes the signing secret too. New MCP addresses mean new chat connectors and a marketplace entry; the App does not accept tokens issued for a different `APP_MCP_URL` ([`infra/RUNBOOK.md`](../../infra/RUNBOOK.md#20-changing-the-public-address)).
- The inbound side of a channel and the Notion webhook share the base URL and the lifecycle of the receipt; each has its own authentication, and the source (`source`) keeps their deduplication keys apart.
- The App's runs do not go through the public addresses: they reach the App MCP over their container's loopback and GBrain over the Compose network. The tunnel is needed only for ingress from outside.

## Cost

- A tunnel that gets a new address on every restart needs all the registrations redone after each restart.
- On the local machine, ingress from outside works only while the tunnel is running: without it, the Notion and Telegram webhooks and the chat's connection to the App do not get through.
