# ADR 0044 — An approved action has an attempt limit, and the system closes a proposal the person got ahead of

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D44` |
| **Related** | ADR 0039 · ADR 0040 · ADR 0043 · `INV-027` · `GAP-41` |

## Context

An approved action that Notion does not answer or refuses access to cannot be executed at the moment. The rule “if it could not be looked at, the person's decision stands” would repeat it endlessly. A temporary Notion failure does clear up, but lost access — the page has been closed to the integration, the token has been revoked — does not clear up on its own. A person who pressed “Approve” considers the matter done, but an action that is repeated endlessly never becomes `failed`: the App writes the fate of an unexecuted approved action to the proposal's thread and to its message (ADR 0043), and a stuck action stays invisible to the person.

A proposal that the person got ahead of — by changing the page so that the proposal's precondition no longer holds — would, without being closed, stay “awaiting a decision”: Daily Control would show it with buttons, and pressing one would yield `conflict`. The person would have to press in order to learn that the proposal no longer makes sense. What is shown in the channel is cleared by the fate mechanism (ADR 0039, ADR 0043), so closing such a proposal leaves nothing hanging.

## Decision

**An approved action has an attempt limit by kind of failure** (`contracts/canonical.yaml`, key `pending_action`):

- **temporary** (a rate limit, a server error, a timeout, the bot not yet known): retried every hour until a day (the limit) has passed since approval;
- **no access** (401, 403, a page without content): it does not clear up on its own, so three attempts an hour apart.

After the limit the action is `failed` with a non-execution kind, and the thread gets “The approved change was not written” with the reason (ADR 0043). If the change is still needed, the next run sees the trail and proposes again. The Notion failure classifier distinguishes “no access” from “temporary” for all readers.

**The system closes a proposal that the person got ahead of.** When intake sees a person's change on a page where a proposal is waiting, the App checks its preconditions with the same evaluator that execution uses: if a precondition is broken, the result is `conflict` at once and the buttons disappear. This is not a withdrawal by the system's judgment but the same mechanical check that the executor would make after the press anyway; such a `conflict` is not written to the thread, because the person made the change themselves.

**Rejected:**

- **No limit.** A stuck action is invisible, and the person considers it done.
- **`failed` immediately on an access refusal.** Access that the person restores within a few hours would cost them a new decision.
- **A periodic check of all open proposals.** A page-change event already provides the occasion, and a missed event is safe: the press will yield `conflict` anyway.

## Consequences

- `pending_actions` carries the time of approval, the count of access refusals and the kind of non-execution.
- Notion event intake asks the approval service whether a proposal is waiting on the page and requests a check.
- In the failure classifier, 401 and 403 mean “no access”; what the ingress of page-body edits does with such a refusal is decided by ADR 0040.

## Cost

- Access lost for longer than the window of attempts — `execution.no_access_max_attempts` attempts an hour apart, about two hours — costs the person a new proposal.
- A Notion failure longer than a day does too.
- A missed event leaves the proposal with its buttons until a press or Daily Control.
