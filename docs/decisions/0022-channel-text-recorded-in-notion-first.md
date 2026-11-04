# ADR 0022 — The person's reply in a dialogue the system started lands in Notion first, and only then does the model take it up

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D22` |
| **Related** | ADR 0007 · ADR 0017 · ADR 0043 · ADR 0045 · `INV-024` · `INV-030` · `INV-312` |

## Context

The external channel (the adapter is Telegram, ADR 0007) is the place where the system itself addresses the person: it sends a message, and the person can reply to it. Four rules keep this reply from simply going to the model:

- **The envelope carries no content** (`INV-030`): the model reads the state again instead of trusting the App's snapshot.
- **The channel is not a source of state** (`INV-024`): the full content lives in Notion, and the message is only a carrier.
- **Only the integration bot writes to Notion** (ADR 0017): the App does not write the person's words in the person's name, but it does write in its own name.
- **A webhook for the App's own write is filtered out by its author**: the bot that wrote to Notion does not trigger processing a second time.

## Decision

**The channel is only for proactive communication that the system initiates.** It is a dialogue the system starts, not just a pipe for notifications: the system sends a message, and the person replies **to it** — with a button or in words. The person starts nothing through the channel: no new thoughts, no commands, no new topics. What the person initiates goes to Notion (the Inbox, discussion threads) or to Claude Chat. There is no capture through the channel.

**The App itself writes a reply in words to Notion first, and only then opens the evaluation window.**

- Telegram names the message that was replied to; the delivery with that `external_id` in the queue identifies the thread the message was about. The words go as **a comment by the bot in that thread**, marked `Person's reply via <channel>:` and carrying the kind label “Reply from <channel>” (ADR 0043). The Skill treats such a comment as the person's words because of the run's **origin** (`channel_inbound`), not because of its text. The thread registry does not change: the thread keeps the mode in which the system opened it. A reply that is too long for one comment is split into several consecutive comments — what the person said must not be shortened.
- **What is not a reply is not accepted.** Text that is not a reply to a system message, and also a reply to a message that is unknown or not linked to a thread, is written nowhere: the receipt is recorded as discarded, with the reason named, and the content is not stored. Such text produces neither an Inbox item nor a comment.
- **The channel consumer opens the window.** The window fact `channel_inbound` always goes together with `person_replied` and the thread's `discussion_id`; the origin `channel_inbound` ranks above a reply in a thread (they share one run-priority class and one budget exemption: the person is speaking for themselves). The envelope is `type: channel.message`, `event_id: telegram:<update_id>`, the page and thread identifiers, with no content.
- **A redelivery creates no duplicate.** The thread's page is written into the receipt at once, and a redelivery takes it from there, writing no second comment. A narrow gap remains between the comment in Notion and the write to the receipt: a failure inside it produces a second comment — the same class as a system comment without an idempotency key — and the applied comment is visible in the thread.
- **The channel consumer does not depend on the model.** It imports neither the runner nor the App MCP: a runner that is disabled or unavailable does not lose the reply — the words are already in the thread, and the window will wait for a run. When Notion does not accept the write because of a transient failure, the window is not opened: the App answers at once in the channel that the words are worth sending again a bit later (ADR 0045).
- **Buttons are replies too.** `approve`, `reject`, `snooze` and `dismiss` are replies to a system message; the decision on a proposal is recorded before it is executed, and editing the message to show the result is outbound too: the system shows the person how their decision ended.

## Consequences

- The `evaluation_windows` table has the column `channel_inbound`; `notification_outbox` has `external_id` (the id of the message, as the channel reported it when the message was delivered). Both the reply and the editing of the message when a proposal is closed rely on it.
- The person decides on a proposal with a channel button or in the chat: the text of a reply records no decision, and a run that carries it decides nothing (`contracts/canonical.yaml`, key `pending_action`). A snooze in words is a reply to a system message, a comment in a thread or the chat; the button carries no time.
- Receipts and windows do not store the person's words: there is no column for the text and no diagnostic field (`INV-312`).

## Cost

- The bot writes the person's words to Notion: Notion shows the integration, not the person, as the author of the comment. The kind label tells the person whose words they are; the marker in the text tells the model, which does not see the label; only the Skill, which knows the marker, reads it correctly.
- A new text written to the channel, and a reply to a message that leads to no thread (for example, one about an open circuit breaker), are not stored by the system: the bot tells the person at once that the words will not land anywhere and that they must be said in Notion or in Claude Chat, and the receipt records it.
- Text longer than the comment limit becomes several comments.
