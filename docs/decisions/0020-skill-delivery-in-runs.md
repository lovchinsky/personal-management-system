# ADR 0020 — Skill in an App run: dispatch by name and `Read` only in the plugin directory

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D20` |
| **Related** | ADR 0009 · ADR 0026 · ADR 0047 · `INV-049` · `INV-302` · `INV-307` · `INV-308` · `INV-311` · `GAP-13` |

## Context

The perimeter of an App-triggered run is closed: built-in tools are off, the allow-set names only the tools of the mode's row, and `systemPrompt` is empty — the run's behavior comes from the Skill in the runner plugin's directory. The Skill must reach the model deterministically, and the files it names must be reachable without access to the rest of the file system.

The pinned CLI behaves as follows:

- **Dispatch by name.** The prompt `/<plugin>:<skill> <JSON>` loads `SKILL.md` in the first turn without a call by the model, and `$ARGUMENTS` is substituted with multi-line JSON. Dispatch depends neither on `Skill` being in `tools` nor on the `skills` option.
- **Without `Read`, the files named in `SKILL.md` are unreachable.** The model says it has no such tool: progressive disclosure is impossible without it.
- **The rule `Read(//<absolute path>/**)` under `dontAsk`** lets reads in the plugin directory through and rejects everything else: a file outside the directory, `..` inside the allowed prefix and a symlink in the directory that points outside it. A single `/` at the start is not an absolute path but a path relative to the run's cwd: with it the rule allows nothing.
- **The contents of `init.tools`** with `tools: ['Read']` and `outputFormat` are exactly `Read` and `StructuredOutput`.
- **The `Skill` tool with the `skills` option** rejects a skill outside the list, but `init.skills` lists all of the account's built-in skills regardless of the list.

## Decision

**The Skill reaches the run by a command, and the files it names are read with `Read`, limited to the plugin directory.**

- The run's prompt is `/personal-management-system-runner:run` — the runner plugin and its entry (ADR 0047, [`contracts/canonical.yaml`](../../contracts/canonical.yaml), key `plugin_entries`) — followed by the envelope. The Skill is loaded deterministically, not at the model's discretion.
- The only built-in tool of a run is `Read`; the rule `Read(//<plugin directory>/**)` allows it. `Skill` is not in `tools` and the `skills` option is not set: the model has no way to call any other skill.
- A run with its own instructions — the gate command — is not a Skill run: its prompt is the envelope itself, and the instructions go in `systemPrompt`.
- The `init` of a Skill run must name `personal-management-system-runner:run` among `skills`: otherwise the CLI would read the command as plain text, and the run would proceed without instructions, with no sign of failure.
- The stream observer also enforces the perimeter itself: a successful `Read` outside the plugin directory is a run failure, whatever allow entry the CLI gave (managed organization policies, `GAP-13`; `INV-311`). An attempt the CLI denied is not a failure — it is the perimeter at work.

## Consequences

- A run's `init.tools` is the row's allow-set, `StructuredOutput` and `Read`.
- The list of built-in tools for `disallowedTools` does not contain `Read`: deny takes precedence over allow, and a denied `Read` would not read even the plugin directory. `Skill` is in the list.
- The contract names `Read` under its own key, `plugin_tools`, with the read boundary `plugin_dir`, while `harness_tools` names what the harness itself adds.
- The chat loads its entry through the `Skill` tool by `description`, and a run loads its own with a command (ADR 0026); both read the same knowledge about the domain.

## Cost

- A run reads any file of the plugin, so the plugin carries nothing that must not be read: no secrets and no physical IDs (`INV-038`, `INV-044`).
- The syntax of the rule is a property of the CLI; an SDK bump is checked by `init`, the gate and the test for a `Read` outside the directory.
- Dispatch by name is a behavior of the pinned CLI. A CLI that does not recognize the command is caught by the `init.skills` check.
