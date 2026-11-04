# ADR 0007 — Delivery adapter — Telegram

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D7` |
| **Related** | ADR 0002 (implementation of the port) · ADR 0003 · `INV-021` · `INV-022` · `INV-023` · `INV-024` |

## Context

The `NotificationChannel` port (ADR 0002) needs an adapter that reaches the person outside Notion and lets them decide a proposal right from the message. The Telegram Bot API has inline buttons, editing of a sent message, and a webhook.

Its properties shape the adapter: Telegram does not sign the webhook; `callback_data` is limited to 64 bytes; the rate limit is ~1 message/s per chat; there is no idempotency key; a message is up to 4096 UTF-16 code units.

## Decision

**The adapter of the `NotificationChannel` port is Telegram, with `interactiveActions: true` and inbound through a webhook at `/webhooks/telegram`.**

The person approves or rejects a proposal with a button right in the message, and names the snooze time in words, as a reply to the message. Long polling is not used.

## Consequences

- Inbound authentication is two independent checks: the header `X-Telegram-Bot-Api-Secret-Token` equals `TELEGRAM_WEBHOOK_SECRET`, and `chat.id` equals `TELEGRAM_ALLOWED_CHAT_ID` (`INV-022`).
- Dedup works on the pair `(source, external_id)` in `webhook_receipts`: `telegram` and `update_id`. The handler answers 200 after the receipt is committed, because Telegram redelivers on a non-2xx.
- `callback_data` cannot hold the action's payload, so a button carries only the intent and `pending_action_id`. The id is a uuid, and `kind:id` fits into 64 bytes by construction. The executor reads the row again and revalidates the preconditions: exactly what was locked in when the proposal was made is executed, not what the button carries.
- `answerCallbackQuery` is called after the decision is recorded and before it is executed (`INV-023`); a failure of the call does not cancel the decision.
- Delivery on the wire is **at-least-once** by design: Telegram has no idempotency key, and the gap between `sendMessage` and recording `sent` cannot be closed atomically. A lost nudge is a silent abandonment of the system's purpose, while a duplicate costs only attention and is self-limiting (`INV-024`). Exactly-once remains with the **domain effect** and is enforced by `pending_actions`, not by the channel.
- `429` is a failed delivery attempt like any other: the attempt is recorded before the call to the provider. `retry_after` becomes the floor of the outbox's own backoff.
- A packet that does not fit into a message is not queued. `noticed`, `why_it_matters`, the proposals, the ask and the link arrive whole, and the render drops `context` and `prepared` when there is not enough room for them. A packet is never split into several messages: the buttons belong to one.
- App-owned env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`.

## Cost

- After a failure between `sendMessage` and recording `sent`, the person may receive the same message twice.
- The authenticity of an update rests on the header secret and the allowed chat, not on a provider signature.
- A button does not carry a snooze time: the person writes it in words.
- The webhook requires public HTTPS and a new `setWebhook` registration with every change of address (ADR 0003).
