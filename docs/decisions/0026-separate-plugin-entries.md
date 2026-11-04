# ADR 0026 — Chat and the App run have separate Skill entries over a shared knowledge layer

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D26` |
| **Related** | ADR 0020 · ADR 0047 · `INV-037` · `INV-314` · `INV-315` |

## Context

Two surfaces read the Skill, and their situations differ. In Chat the person speaks, and the agent writes with its own Notion tools on the person's behalf. In a run the agent receives an envelope from the App, has no Notion write tools and returns a structured result. A single text for both situations would have to explain both — by comparing the surfaces and by branching for each, in every file. That would take the form of a description of the system, not an instruction: an agent that knows how it was launched has nothing to read about the other way, and the rule for one situation would be hidden among the rules for the other.

Knowledge of the domain — ontology, input clarification, detectors, the portfolio, memory, lessons, reviews, field states — is the same for both surfaces, and two copies of it would drift apart.

The run envelope reaches the model only through the body of `SKILL.md`: `$ARGUMENTS`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` are substituted only there, and the files the model reads with `Read` stay raw text.

## Decision

**Each surface has its own Skill entry, and the domain knowledge lives in a separate layer that both entries read.**

- `personal-management-system` is the Chat entry: `SKILL.md` (what to do when the person speaks; situation → files) and the conversation procedures (`conversation/`).
- `run` is the entry of an App run: `SKILL.md` with the envelope and the list of files for each `mode`, `frames/` (the procedure per mode), the files on how a run acts (`acting.md` and those next to it) and `result.md` (what the run returns).
- Where the knowledge layer lives and how each entry reaches it is decided by ADR 0047.
- Every mode the App dispatches has a frame ([`contracts/canonical.yaml`](../../contracts/canonical.yaml), key `run_frames`): a mode's procedure is written together with its producer.
- The Chat entry keeps to the spec keys of the frontmatter (`name`, `description`): a Claude Code key such as `disable-model-invocation` may be rejected by claude.ai along with the whole plugin. The description of the run entry is addressed to a machine: it refers to an envelope with `mode` and `trigger`, not to a conversation.
- `INV-037` applies to each entry: a situation loads only its own files, and the volume of the first read is limited. `INV-315` forbids an entry from speaking of the other surface and the knowledge layer from speaking of either.

## Consequences

- The agent does not read how it was launched and does not decide which branch is in force: the structure makes the choice.
- Domain knowledge is written once, without wrappers, and names no capabilities: the entry's procedure names them.
- The Skill text does not repeat what the tool descriptions and the code provide: a rule has one place (`INV-314`).
- A new mode with a producer adds a frame and a row to the router of the run entry; knowledge both surfaces need goes into the knowledge layer.

## Cost

- A run reads the files of its `mode` with several `Read` calls, in one batch; the number of calls is measured by the behavioral eval.
- Knowledge cannot refer to either surface: what differs between them must go into the procedures of both entries.
