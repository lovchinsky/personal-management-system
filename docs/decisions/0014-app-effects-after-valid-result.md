# ADR 0014 — App effects are applied after a valid result

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D14` |
| **Related** | `INV-035` · `INV-088` · `INV-100` · ADR 0011 · ADR 0015 · ADR 0017 · ADR 0035 · DEF-45 · `GAP-31` · [`3-policy.md` “Model or tool failure”](../3-policy.md#model-or-tool-failure) |

## Context

`INV-035` requires that an invalid run result leave no durable effects and not be executed partially. But a run writes as it works: a comment, a conversion or closure of an Inbox item, a continuation, a proposal, a delivery, a memory write. Whether the result is valid is known only at the end. If the writes were applied immediately, a failed run would leave its effects behind, and its retry would duplicate them. The system cannot take back a write in Notion or GBrain.

## Decision

**Every write of a run goes through the App MCP, is checked immediately, and is applied only when the run has ended with a valid result.**

- In a run the Notion MCP and GBrain only read (`INV-034`, `INV-100`). The system's writes to Notion (ADR 0017) and to GBrain memory (ADR 0035) are App writes, so they wait for the same conclusion as the rest (`INV-088`).
- A run's writes are held in that run's session, and the dispatcher applies them — only for a valid result that arrived before the run's deadline.
- The order follows the kinds of writes: memory → Inbox parking → conversion → closure → comment → continuation → proposal → delivery. A write is applied before the one that points to it, so a delivery never announces an effect that was not applied.
- A run that fails, is deferred or is aborted leaves no App effects.
- An App MCP read in the same run sees its staged writes.

**A retry is bounded by the origin row's attempt limit.** An invalid result is retried by the same mechanism as any run failure: with the effects staged, a retry is safe.

The chat path has no run result: the write policy (ADR 0015) decides when its writes are applied.

**Rejected:**

- **Applying immediately and compensating on failure.** A write in Notion or GBrain cannot be taken back, and a message that has already gone to the person even less so.

## Consequences

- `INV-035` covers all of a run's durable effects: a run has no write path other than the App.
- Memory and Notion carry writes only from valid runs.
- A retry rests on the idempotency of each capability: a continuation moves the same thread, a proposal folds into the open one by fingerprint, and a delivery by idempotency key. A comment has no key (`GAP-31`).

## Cost

- The model sees “accepted, will be applied at the end”, not “done”.
- The effect appears at the end of the run, not when the tool is called.
- A refusal to apply even one write fails the whole run: the message the run composed might have announced that very write.
- Applying is not atomic: the prefix applied before the refusal stays and goes into the run trace.
- A failure between applying and recording the conclusion leaves the effects applied, while the origin row is requeued, and a new run may apply the writes a second time (DEF-45).
