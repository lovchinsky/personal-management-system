# ADR 0039 — Daily Control shows open proposals, and only what it showed expires

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D39` |
| **Related** | ADR 0002 · ADR 0007 · ADR 0022 · ADR 0025 · ADR 0036 · ADR 0043 · `INV-023` · `INV-024` · `INV-026` · `INV-027` · `INV-104` |

## Context

A proposal of an autonomous run lives as a `pending_actions` row until the person decides on it. There is no expiry in hours: a proposal expires through a review — “lives until the end of the first Daily Control that showed it” (`contracts/canonical.yaml`, key `pending_action`). The rule is fair only when the Daily Control shows the open proposals and what expires is what was shown: a proposal the person has not seen is not one they have passed by.

A notification packet is one message, and an `approve` or `reject` button carries only the proposal's id. Several proposals in one packet need buttons the person can tell apart, and a decision about one proposal must not take away the buttons of the rest. Rendering that fits the packet into the channel's limit cuts `context` and `prepared` first: a proposal described only there might not reach the person, while its button would remain. Expiry is also a fate, and the message must show it.

## Decision

**The Daily Control reads open proposals and carries buttons for them in its packet; a proposal expires when a delivered Daily Control packet showed it and the person passed it by until the next Daily Control.**

- **The matrix:** the `daily_control` row has a bundle that contains only the reading of proposals (`approval_view`: `approval_read`). The Daily Control cannot make proposals.
- **The proposals are a separate field of the packet** (`proposals`: the id and the description line of each), and the buttons derive from it. The App numbers the lines and the buttons, rendering does not shorten this field, and the schema admits no more proposals than `contracts/canonical.yaml`, key `notification_packet`, allows; for the rest, the packet says how many are still waiting, and the App counts that number. The guarantee comes from the structure of the packet, not from an instruction to the model.
- **What was shown** is a proposal from the `proposals` field of a **delivered** (`sent`) Daily Control packet.
- **Expiry:** when the producer places a daily occurrence (ADR 0036), the App expires (`expired`) every proposal that is still `proposed` and for which any delivered Daily Control packet queued before this occurrence carried buttons. A packet that has not been delivered expires nothing: the review did not take place, so the proposal waits. A skipped day does not let a shown proposal live forever: any earlier packet counts, not only yesterday's.
- **A decision about one proposal** removes only that proposal's buttons and appends a line about its fate (ADR 0043); the buttons of the rest stay.
- **The fate `expired`** is among those the message shows: an expired proposal loses its buttons, and pressing a button on an expired proposal answers that it has expired.
- The Weekly Control Review and the Strategic Review may carry proposals but do not expire them: only the Daily Control measures expiry.

**Rejected:**

- **Expiring everything `proposed` before a review begins.** It would expire what was not shown, which is exactly what the expiry rule must protect against.
- **A review that only reminds the person that a queue exists.** The expiry rule would lose its basis, and proposals without a decision would live indefinitely.
- **A separate message for each proposal.** A review is one packet; ten messages in the morning are noise, and the delivery key gives each cause a single delivery (ADR 0025).

## Consequences

- `mode_toolsets.daily_control`, the `approval_view` bundle, the table in `docs/2-system.md` and `runs/toolsets.ts` stay in agreement.
- The `pending_action` contract and `docs/2-system.md` § “Approval differs by who performs the write” say that what a delivered packet showed expires, and that the end of a review is the start of the next Daily Control.
- `ApprovalsService` expires by the list of shown ids; delivery finds them by the key of the Daily Control packet.
- The notification packet carries proposals in the `proposals` field; Telegram rendering and editing number the lines, leave the field unshortened and drop the decided proposal from the keyboard; `ProposalNotice` knows `expired`. Evaluation runs and the Weekly Control Review put proposals in the same field.
- `INV-104`: only a proposal shown by a delivered Daily Control packet expires.

## Cost

- Without a delivery channel proposals never expire; decisions about them are made in the chat.
- A proposal created after the morning review lives at least until the next morning.
- The person sees proposals beyond the packet limit as buttons in several consecutive reviews.
