# ADR 0015 — Capabilities own a run's writes; the write policy sits outside the transport

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D15` |
| **Related** | ADR 0014 · ADR 0011 · `INV-035` · `INV-303` |

## Context

A run's writes through the App MCP wait for a valid result (ADR 0014), while reads in that same run must see them. The chat writes immediately. The same kind of write thus has two points at which it is applied and two states in which it is shown — staged and applied.

Yet the rules of a kind are the same in both cases:

- what counts as the same continuation;
- how to show a staged proposal;
- where a delivery button may lead;
- how large a proposal may be.

If the transport session held the staged writes, it would answer reads as well, and these rules would be implemented a second time, in the App MCP, and every tool handler would have two branches: one for a run and one for the chat.

## Decision

**A run's write is owned by the capability it belongs to. When to apply the write is decided by a separate write policy, not by the transport.**

- **The capability owns the write completely.** It checks the request, applies it and shows it. An applied row and a row the run has recorded (`staged`) are shown in the same form and under the same identity rule.
- **A run's writes are a closed list of kinds.** Each kind has an owning capability.
- **The write policy (`effects/`) decides when to apply.** There are two policies, over the same table of owners. A run gets the staged one (`StagedWrites`): it holds what is staged, applies it after a valid result in the order of kinds, and binds temporary ids to real ones. Before the first write it checks everything staged once more, so a state that changed during the run stops the staged writes before the first one is applied. The chat gets the immediate one (`ImmediateWrites`): a write is checked and applied on the call, and the tool's response says `applied`, not `staged`.
- **One table collects the owners of the kinds.** For each kind it says which capability checks and applies it, and whether the write yields a reference that other writes of the same run may point to. The policy reaches the capabilities only through this table.
- **The App MCP is a table of tools and a protocol.** Each tool translates the wire shape of its input into a capability call and declares the bound of its response.

## Consequences

- A new kind of write consists of three parts: a capability (check, apply, show), the kind in the list of kinds together with its row in the table of owners, and a tool in the table of tools.
- The response bounds of the tools live in the table of tools; `INV-303` checks that table.
- Checking, applying and showing are the same for a run and for the chat; only what the tool tells the model about the write differs.
- The second check does not make applying atomic (ADR 0014): a refusal between it and a write stops the rest.

## Cost

- The capabilities' reads accept writes of the same run that have not been applied yet.
- Each capability has a separate path for showing what is staged.
