# ADR 0051 — A notice about the system carries no link

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D51` |
| **Related** | ADR 0002 · ADR 0007 · ADR 0046 · `INV-024` · `INV-106` |

## Context

`INV-024`: a channel message is not a source of state. The full content lives in Notion, and the link to the object is where two copies of one nudge meet.

Three notices of the App are about no Notion object: a client has connected to the App MCP, a review did not take place, and the breaker opened on a run that named no page. A stand-in link, the address of the Notion home page, leads the person nowhere, and the caption “Open in Notion” under the ask promises a destination that does not exist.

The connection notice asks one question: was this you. The actions for the other answer, changing the owner passphrase and revoking the tokens, are server operations (RUNBOOK § “App MCP and chat”). They have no page to open, so the ask itself carries them.

## Decision

**A message has a link when it is about a Notion object; a notice about the system has none, and its ask names what to do.**

- **Port schema.** `link` is optional in `outboundMessageSchema`. When present, it is an `https` URL of at most 300 units.
- **Wire.** `queue_notification` requires `link`. Everything the model queues is about Notion content, so `INV-024` binds the model's packets exactly.
- **Render.** The Telegram message ends with the bold ask; the caption and the anchor appear only with a link. A message without a link has a shorter tail than the worst case in the length proof of `telegram.renderer`, so the proof covers it.
- **Delivery key.** The canonical form of a chat key holds the link, or `null` when there is none.
- **The three notices.** The connection notice, the notice about a review that did not take place and the breaker notice without a page carry no link.
- **The connection notice.** Its ask says what to do in both cases: “If this was you, do nothing. If not, someone knows the owner passphrase: change it and revoke the tokens (`infra/RUNBOOK.md` § “App MCP and chat”).” The actions are server operations with no page to open, so the ask names them and the RUNBOOK section.

**Rejected:**

- **A link to the Notion home page as a stand-in.** It satisfies the schema and helps no one.
- **An optional link on the wire as well.** The model would be able to skip the link in a packet about a page, and `INV-024` would rest on the model's habit.
- **A link to the RUNBOOK on the project's repository.** The installation owns its RUNBOOK copy and its own domain; the App knows no address of the repository.
- **A separate message type for system notices.** Two types would repeat the five slots, the limits and the render for the sake of one absent field.

## Consequences

- `INV-024` reads: a message about a Notion object contains a link to it. Its contract test checks the wire requirement, the optional link in the port schema and the render without a caption.
- A queue row without a link passes the port schema and renders as the ask alone.
- The gate's evidence of a notification treats `link` as optional.

## Cost

- The port schema alone does not prove that a queued message has a link; that proof rests on the wire schema, where the model's packets enter.
