# ADR 0024 — Precondition `property_reads_as`: a filled property changes under a condition on its value

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D24` |
| **Related** | ADR 0032 · `INV-027` · `GAP-24` |

## Context

A condition that **sees this write** is what keeps a domain effect once-only (`contracts/canonical.yaml`, key `pending_action`): an executor that wrote and crashed before it managed to mark the row reads the preconditions again on the retry, and a condition tied to the property being changed no longer holds — `conflict` instead of a second write.

The conditions `property_equals` and `property_empty` see a narrow range of writes: the first compares option ids, the second sees a value being written into an empty property. Neither sees a change to a **filled** date, text or relations: such a proposal would have no condition that sees its own write, and a proposal without one is unacceptable. The person would be left to change a filled date by hand.

## Decision

**The condition `property_reads_as { pageId, propertyId, value }`** means that the property reads as `value` in its canonical form.

- **The read is the adapter's.** The condition is checked by the same `readBack` that checks every write of the system: text, option, instant, set of relations, clearing. The condition knows nothing of the physical payload. An instant is compared as an instant, relations as a set.
- **It sees a write of any kind, but only one that changes what the condition names.** The validity rule: a condition observes an effect when both concern the same page and the same property, and the condition's value **differs** from the value being written. An effect that writes the same value would leave the condition true, and the retry would pass — such a proposal is rejected before it reaches the person.
- **Answers to an authoring defect.** A property that carries no canonical field, or a binding that has diverged from the workspace, is `undecidable`: a retry would change nothing. A different value or an empty property is `broken` (`conflict`). What Notion did not return is `degraded`, as for the other conditions.

## Consequences

- The description of `create_pending_action` names the condition and the rule that the values must differ.
- The fingerprint of the effects is computed from the effects, not from the conditions: a condition does not affect it.
- `property_equals` and `property_empty` apply to options and empty properties: there they are cheaper and do not depend on the adapter.
- The time zone of a date in the condition annotates the instant and is not a difference: it is the state of the page, not the system's own write ([ADR 0032](0032-next-action-no-date.md)).

## Cost

- The model composes the condition, and it must name what it read itself: the value in the condition is its claim about the state, not an App snapshot. A wrongly stated value yields `conflict` at the very first check, before the person is involved.
- The condition depends on the binding: a property with no canonical field is not covered by this condition.
