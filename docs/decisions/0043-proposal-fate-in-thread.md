# ADR 0043 — A proposal's fate lands in its thread, and system writes carry a kind label

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D43` |
| **Related** | ADR 0017 · ADR 0022 · ADR 0039 · ADR 0042 · ADR 0046 · `INV-023` · `INV-024` · `INV-107` · `GAP-31` |

## Context

A Notion thread is the canonical history of interaction: the App first puts the person's words from the channel into the thread and only then wakes the model (ADR 0022). The person's decision on a proposal and the way an approved action ended happen outside the thread — by a button press in the channel and by a step of the executor. A fate that lived only in `pending_actions` and in the editing of the Telegram message:

- would stay unknown to the next run: the Skill's status table would rely on data the model does not have, and a rejected change could be proposed a second time;
- would stay invisible to the person in Notion: the person would not see there that an approved change was not written.

Editing the message in the button-press handler would make the ack wait for a network call, and the first failed edit would stop the fates from appearing in the remaining messages.

Notion shows every system write under the integration's name, so without a distinction the person in a thread could not tell their own reply from the channel apart from a system comment. Notion does not let an internal integration show the person as the author of a comment (`display_name: user` is refused) and accepts an arbitrary display name (`custom`); the author (`created_by`) remains the bot; the Notion MCP returns such a comment to the model without the display name.

## Decision

**A proposal's fate is an event in its thread, written by the system; editing the message is part of the same reliable step, not of the button-press handler.**

- The proposal row remembers which fate has already been published. Publication is a separate App loop: it publishes each new status and marks it published; a failure is retried on the next tick.
- **The system writes to the proposal's thread** in its own name, in text from the catalog of the installation's language: the person's decision (“You approved: <field> → <value>”, “You rejected: …”) and the non-execution of what was approved (“The approved change was not written (…): <reason>”); the wording and the form of address follow the system's voice ([ADR 0046](0046-system-voice.md)). The wording of the change comes from the proposal contract, not from the model's line. Execution and expiry are not written to the thread: the change itself is visible, and an expiry is not an event. A proposal without a thread leaves its trail only in the message.
- **In the channel**, the system edits each message separately.
- The button-press handler only records the decision and answers at once (`INV-023`).

**System writes carry a kind label.** An App comment can have a display name from a fixed list in the catalog: “Reply from <channel>” for the person's words from the channel, “Your decision” and “Outcome of the change” for a proposal's trail. The rest of the system's comments have no label and appear under the integration's name. The label says what kind of write it is and never names the person. The author remains the bot, so the rule “an event is the system's own when its author is the bot” and the reconciliation of threads rest on the author, not on the label. The `Person's reply via` marker stays in the text next to the label: the model cannot see the display name.

**Rejected:**

- **Reading the fate from the App** (`get_pending_action` by thread or page). The fate would stay hidden from the person and from the chat, and the model would spend a call within a tight turn ceiling.
- **A decision trail in the person's name.** The person pressed a button and wrote no text: a text under their name would be written on their behalf.
- **The person's name in the label.** Notion does not let the person be shown as the author; the person's name next to the integration's avatar would pass a system write off as the person's own.
- **A marker in the label instead of in the text.** The model does not see the label and would read the person's words as its own.

## Consequences

- `pending_actions` contains the published fate; the approval service and the executor do not call the message port — the publication does.
- `NotionWriter.comment` accepts a label; the text catalog has the labels and the trail texts.
- The Skill reads the fate of its proposal from the thread: the status table rests on what the model reads.
- `INV-107`: a proposal's fate — the person's decision and the non-execution of what was approved — lands in the thread exactly once per transition.

## Cost

- A write to Notion for every decision of the person and every non-execution of what was approved.
- Between the decision and the editing of the message lies a publication tick, not an instant.
- A duplicate trail is possible in the window between the write to Notion and the mark that it is published — the same class as `GAP-31`.
