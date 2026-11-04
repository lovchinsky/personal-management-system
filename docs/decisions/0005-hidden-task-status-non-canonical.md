# ADR 0005 — `Task Status = Hidden` as a technical status outside the domain

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D5` |
| **Related** | ADR 0001 · ADR 0010 · `G15` · `INV-001` · `INV-004` · `INV-009` · `INV-041` |

## Context

The `Status` property of the `Tasks` database (`contracts/notion-workspace.yaml`) carries the option `Hidden`, which the canonical model does not define: the methodology gives it no meaning, and no canonical status covers it. Notion status groups carry no semantics, so the meaning of `Hidden` cannot be derived from the group it sits in.

On a value that is not in the canonical set, the adapter yields `schema_gap` (`INV-001`): that is how it says the binding is right and the model is incomplete. A Task in `Hidden` is a deliberate choice by the person in the workspace, not a flaw in the binding, and an error on every such record would be noise that calls for no fix.

## Decision

**`Hidden` is registered as a known non-canonical value: it is not mapped to a canonical status, raises no error, is outside the scope of detectors and is never written by the system.**

The `known_non_canonical` registry is keyed by field (`Task Status`), not by object type: an option id belongs to a specific property, and several non-canonical values on one field are told apart by construction. In the [degradation register](../3-policy.md#degradation-register) it appears as `G15`, explicitly marked “not a degradation”.

**Rejected:**

- **Map `Hidden` to a canonical status.** The system would assign the Task a meaning the person never named and act on it: detectors would judge a Task the person had removed from view.
- **Leave `Hidden` as an unknown value.** Every such Task would yield `schema_gap`, and a real gap in the model would be buried among errors that call for no action.

## Consequences

- Detectors do not react to Tasks in `Hidden`.
- The adapter tells an “unknown value” from a “known non-canonical” one.
- **The registry is the mechanism of this distinction.** `INV-001` and `INV-009` raise an error on a value that is in neither the canonical set nor the known non-canonical registry. `Hidden` is in the registry, so the absence of an error on it is the rule at work, not an exception to it. The status does not affect reading dates ([ADR 0010](0010-date-and-deadline.md)): a `Hidden` Task returns `Date` and `Deadline` like any other, and staying outside the scope of detectors remains governed by this ADR.

## Cost

- A Task in `Hidden` is outside the system's oversight: its `Deadline` yields no `deadline_risk`, and its dependencies yield no `dependency`.
- The registry is closed: the binding schema knows only `Hidden`. A new non-canonical value yields `schema_gap` until it is registered in the contract, the binding and the code together.
