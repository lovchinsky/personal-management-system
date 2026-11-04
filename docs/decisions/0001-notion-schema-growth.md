# ADR 0001 — Growth criterion for the physical Notion schema

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D1` |
| **Related** | ADR 0005 · ADR 0010 · ADR 0048 · DEF-18 · `INV-008` · `INV-009` |

## Context

The methodology's canonical model is wider than the physical Notion schema: some of its semantics have no property to carry them. The physical schema (databases, properties, relations, options and formulas) lives in `contracts/notion-workspace.yaml`, and the workspace is built from it (ADR 0048).

The schema is not a draft that should be built out until it covers the whole model. But it is not frozen either: it grows where the lack of a property makes a specific, verifiable behavior impossible.

## Decision

**A canonical semantic gets a native property if and only if a detector must filter on it or detect its absence without reading page bodies. A prose semantic does not become a native property.**

The schema grows by an edit to `contracts/notion-workspace.yaml` under this criterion, as a separately agreed decision. A canonical semantic that is missing is declared in the binding as `absent`, not silently emulated.

The criterion is narrow on purpose. An empty choice field creates no obligation: a value is either chosen or not. An empty text field does: it asks every time whether it is worded well enough, and turns starting the system into an exercise in wording. The `core_rules` require detail to be expanded only to the level needed, so being useful does not depend on declaring detail in advance.

The rows of the vocabularies (`Context`, `Tags`, `Trigger`) are data, not schema, and the criterion does not apply to them.

## Consequences

Two states with a closed set of values and the deadline of a Task fall under the criterion:

| Semantic | Carrier | Consumer |
|---|---|---|
| `AreaOfFocus.mode` | `Mode` (Advance / Maintain / Minimum) | `area_of_focus_risk` picks its ground from it: motion of the linked work is required only under `Advance` |
| `BehaviorSystem.lifecycle` | `Lifecycle` (Designed / Installing / Stabilizing / Maintenance / Retired) | `area_of_focus_risk` reads from it whether a Behavior System of the Area of Focus is in motion |
| `Task.deadline` | `Deadline` | `deadline_risk`: the sweep selects Tasks by deadline without reading page bodies |

A change of `Mode` or `Lifecycle` is a relevant event for intake (`relevance_gate`).

Prose does not fall under the criterion, even when the canonical model mentions it:

- `Project.definition_of_done` is the boundary of a specific piece of work; it often follows from the name and the set of its Tasks. It lives in the body when it is needed; its absence is not a finding;
- `AreaOfFocus.standard`: the acceptable state of an Area of Focus accumulates in the GBrain anchor during review, drawing on derived graph signals, and is not declared in advance;
- the descriptive fields of a Behavior System, `Identity.meaning` / `principles` / `boundaries` and `Task.result_or_note` are the page body.

Two kinds of schema properties are outside the criterion:

- the `Text` of the Inbox database is a prose field bound natively (`captured_text`): an Inbox item that the system parks carries what the person said, and the App does not write the page body (`INV-008`);
- properties the binding does not name, for example `Priority`, `Effort points`, `Remind` and `Remind before`: they carry no canonical semantic, so the criterion does not apply to them.

The page body is read as a whole: there are no named sections, and a capability is determined by whether a body exists, not by whether a section exists (`INV-009`). Existing pages do not need to be filled in: an empty body yields `empty`, not an error.

The criterion is reviewed on specific events, not on a calendar: when a detector for the proactive mode needs a filter on a semantic that is prose, and when the structure of L2 defines the fields of a Key Result — the criterion then decides whether a measurable carrier of evidence is needed (`G13` in the [degradation register](../3-policy.md#degradation-register)).

## Cost

Prose semantics are not queryable: a sweep that needs their content reads page bodies instead of filtering by property, which is a direct token cost on every launch.

The acceptable state of an Area of Focus has no field: it is carried by the GBrain anchor and the derived graph signals. Derived signals catch a decline but not chronic absence: an Area of Focus that nobody has worked on for years gives no signal, because silence looks like calm. The mitigation: under `Advance`, the absence of motion in the linked work is itself evidence. Under `Maintain` and `Minimum`, silence is expected, so chronic absence shows there only as a deviation from the acceptable state, when what was read shows it; an Area of Focus with no accumulated state stays silent until the person reviews its `Mode` themselves.
