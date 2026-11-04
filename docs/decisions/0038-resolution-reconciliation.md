# ADR 0038 — A resolved thread is found by time-based reconciliation

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D38` |
| **Related** | ADR 0017 · ADR 0028 · ADR 0037 · `INV-089` · `INV-095` · `INV-096` · `INV-102` · `INV-212` |

## Context

Thread closure is a continuation queue row with the reason `resolution_reconciliation`, and `ContinuationsService.requestClosure` requests it (ADR 0028). Someone has to find out that the thread has been resolved.

Notion sends no event for this: a webhook arrives when a page title changes, but resolving a page thread, resolving a thread on a block and reopening a thread produce no request at all. REST returns only unresolved comments; a listing by page id does not see threads on blocks, and a listing by block id returns them; by id, Notion returns both a comment of a resolved thread (it carries no status) and a deleted one, marked `original_content_deleted`. The Notion MCP shows a thread's state (`resolved`, `context`), but only a model run can read it.

A thread that the system opened with a question and in which it waits only for the person's reply has no continuation: the person's reply itself wakes a run. If the person resolves the thread instead of replying, neither a continuation nor a proposal keeps hold of it — only the system's registry of discussions does.

## Decision

**A resolved thread is found by the App's periodic reconciliation: when a thread it saw open is not among the unresolved and the system's comment in it has not been deleted, the App requests closure.**

- **The scope of the reconciliation** is the registry's threads in which the system has written: those it wrote in within the last `horizon_days` days, and those on which a continuation or a proposal is open. The first group is included because, by rule, a thread that waits only for a reply has no continuation.
- **The thread anchor.** The registry of discussions stores the block the thread is attached to, when the system's comment landed on a block, and the id of the system's last comment in it. The reconciliation asks for the list of unresolved threads by anchor, a block or a page.
- **The conclusion for a thread:**
  - it is among the unresolved: it is marked open (`seen_open_at`);
  - it is not among them, and the system's comment is in place: the thread is resolved. The App requests closure only if the thread has been seen open again since the last conclusion (this is how “opened again and resolved” is caught, and the reconciliation does not repeat a failed closure on every tick). The thread is also seen open when the system writes in it: a thread resolved before the first tick after the write is closed too;
  - it is not among them, and the system's comment has been deleted (Notion marks it deleted or does not find it): the thread is deleted, and there is no closure;
  - the anchor was not read: the tick skips this thread but counts the query about the anchor, so an anchor on which reading fails does not become first again and does not block the rest.
- **A thread with no known anchor** — one that a continuation or a proposal refers to although the system has not written in it — does not enter the reconciliation: absence from the page does not tell a resolved thread from a thread on a block.
- **Memory** is `discussion_reconciliations`: when the thread was seen open, when closure was requested, when it was found deleted and when its anchor was queried; rows outside the scope are pruned.
- **Limits:** the tick and the ceiling of anchors per tick are set by the contract (`contracts/canonical.yaml`, key `sweep`, field `reconciliation`); anchors are visited starting from the one the reconciliation queried least recently. Every closure run is budgeted: `resolution_reconciliation` is an autonomous reason.
- The request is the same `requestClosure` as in the gate; only the App names the reason `resolution_reconciliation` (`INV-095`). The closure run itself checks that the thread has been resolved and not deleted, by reading the thread together with the resolved comments.

**Rejected:**

- **A Notion event.** There is none.
- **Reconciliation through the Notion MCP.** The MCP is an interface for a run and for the person; the App's deterministic steps go through REST (`docs/2-system.md` § “Integration contract Notion”).
- **The whole registry.** The registry keeps a thread for half a year; polling old threads on every tick is a query per page for no benefit: a thread that has long been silent holds nothing that needs to be closed.
- **Closure for every thread that is not among the unresolved.** A thread on a block, a deleted thread and a thread with an unknown anchor would give false closures.

## Consequences

- The `sweeps/` module: the reconciliation, its memory, and the service entries of attention, continuations and approvals for listing the threads in scope.
- `system_discussions` carries the thread's block and the id of the system's last comment; `NotionWriter` returns the block on which the comment landed.
- `docs/3-policy.md` § “Resolution” names the scope of the reconciliation, and § “Missed event” names it as a mechanism.
- `INV-102`: closure is requested only for a thread whose anchor is known, that is not among the unresolved and whose comment has not been deleted, and a repeat request is made only after the thread has been seen open again. Together with the sweep (ADR 0037), the reconciliation is the path of `INV-212` for a missed event.

## Cost

- Closure arrives at a reconciliation tick after the thread is resolved, not at once.
- The reconciliation does not see a thread with an unknown anchor being resolved.
- A thread in which the system has been silent for longer than the horizon and that has no continuation or proposal gets no closure when it is resolved.
- Each tick is one query per anchor, within the workspace's shared limit.
