# ADR 0002 — Delivery through a pluggable `NotificationChannel` port

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D2` |
| **Related** | ADR 0007 · `INV-021` · `INV-024` |

## Context

The system talks to the person outside Notion through an external channel, and several channel providers are possible: Telegram, Slack, email. They differ in rendering, text limit, support for buttons and for editing a sent message, and delivery guarantees. The delivery queue, retries, idempotency and the intake of the person's intents do not depend on the provider. A queue that knew the provider would change along with it.

## Decision

**Delivery is structured as a pluggable port, `NotificationChannel`: the provider is configuration, not architecture.**

The outbox, retries, idempotency and inbound intents live **above** the port.

- A channel is responsible only for rendering and delivery: measuring a packet (`excess`), sending (`send`) and, optionally, rewriting what was sent (`edit`). What it can do, it declares as capabilities (`interactiveActions`).
- The queue keeps the channel name as a string, and the channel registry finds the adapter by name. The queue retires a delivery for a channel the installation does not have, with a named reason.
- The inbound side of a channel, `ChannelInbound`, belongs to intake (`intake/channel/`): the adapter parses an update into an intent, and the router hands the intent to the owner of what it changes.

## Consequences

- Changing or adding a provider does not touch the outbox, retries, idempotency or the recorded queue rows.
- A channel without buttons (`interactiveActions: false`) degrades gracefully: the packet carries the proposal lines, the question and the link, and the sender adds no buttons (`INV-021`). The App accepts a decision on a proposal only from a channel button and from the chat, so without buttons the person decides in Claude Chat.
- A channel message is not a source of state; the full content lives in Notion (`INV-024`).
- Delivery guarantees are set by the implementation of the port, not by the port: for Telegram, ADR 0007 states them.

## Cost

A capability that not every provider has is optional in the port (`edit`, `interactiveActions`), and the code above the port must have a path for a channel without it: without editing, the message stays as it is; without buttons, the decision goes to the chat.
