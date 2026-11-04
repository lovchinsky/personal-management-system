# ADR 0047 — The chat plugin and the runner plugin are separate, and domain knowledge lives once

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D47` |
| **Related** | ADR 0009 · ADR 0020 · ADR 0026 · `INV-043` · `INV-048` · `INV-075` · `INV-219` · `INV-311` · `GAP-08` |

## Context

The chat plugin reaches every device of the person: everything in it is visible in the chat. The run entry is an internal part of the server: only the App starts it, and it is of no use to the person in the chat. The addresses of the App and GBrain belong to the installation, so they have no place in the project, and without them the plugin cannot name its connectors.

A marketplace entry can carry `mcpServers` only when the plugin directory has no `plugin.json`: with a manifest in the directory these fields are not applied. Without a manifest the entry is itself the manifest, and a server from the entry overrides a server of `.mcp.json` with the same name. claude.ai reads an external plugin source only from a public repository, and accepts an entry without a manifest with `strict: false`. claude.ai refreshes the copy of the external source when the marketplace repository changes.

`anthropics/commerce-agents` keeps server-side skills next to the server and the distributed ones in their own plugin. Anthropic repositories contain no symbolic links, and the checklist of the plugin catalog requires committing regular files. The documentation describes the `plugins` option as a path to skills from a specific directory when `settingSources` is set explicitly. Almost all `git-subdir` entries of the official marketplace pin `ref` and `sha`.

Domain knowledge lives in the Chat entry: the entry directory is self-contained and works as a separately loaded skill directory. The run reads the same knowledge (ADR 0026). A model whose entry table gives it names from another directory gets the path wrong; when the names are all read from one directory, it reads them without errors. The `Read` rule allows reads only in the plugin directory.

## Decision

**Each surface has its own plugin, and the knowledge lives in one place.**

- `plugin/` is the chat plugin: `.mcp.json` and the entry `skills/personal-management-system/` with the knowledge. It has no manifest.
- The installation's marketplace is a separate private repository with one file following the template `infra/marketplace.example.json`. The entry points to `plugin/` through `git-subdir` with `ref` and `sha`, has `strict: false`, and carries a name, a description and the connectors of the App and GBrain with the installation's addresses. The project contains no marketplace.
- `app/plugin/` is the runner plugin `personal-management-system-runner`: the manifest and the entry `skills/run/`. It is not distributed.
- The image build puts the chat plugin's knowledge into the run entry directory (`skills/run/knowledge`). The run reads all the names in the table relative to its own directory, and the perimeter is the single `Read` rule (ADR 0020). The chat plugin does not go into the image.
- The run command is `/personal-management-system-runner:run` (ADR 0020). `init` must show exactly this plugin from the declared directory.
- The runner loads the plugin with the `plugins` option and `settingSources: []`: the run loads no user or project settings, and the plugin comes from exactly the declared directory. Project skills would need `settingSources: ['project']`.
- `.mcp.json` declares three connectors. Notion has a fixed address, while the App and GBrain take theirs from the variables `APP_MCP_URL` and `GBRAIN_MCP_URL` of the Claude Code environment. The marketplace entry overrides them by name.
- The chat version is set by the entry's `sha`, not by `version`: a set `version` holds back updates. The digest of the plugin's content in the `init` snapshot, the same one as in the gate verdict, tells which Skill a run used.

**Rejected:**

- **One plugin with both entries.** The run entry, its `frames/` and its procedures would reach every device of the person, and the description of the run entry would appear in the list of the chat's skills.
- **A symbolic link `knowledge` from the run entry to the chat knowledge.** The `Read` rule does not let through a link that leads outside the plugin directory, and the contents of `app/` go into the image without the `app/` directory, so a relative link between the plugins leads nowhere in the image. On Windows without `core.symlinks` the link becomes a text file, and an archive that does not preserve links contains a copy.

## Consequences

- The person sees one Skill and a plugin with connectors. The run entry, its `frames/` and its procedures stay on the server.
- The Skill lives in one place, and the installation's addresses are outside the project.
- A chat release is a new `sha` in the marketplace: the image goes first, so the chat does not get ahead of the App, and a chat rollback is the previous `sha`.
- A plugin enabled in the account reaches Claude Code automatically.
- The plugins do not depend on `core.symlinks` or on whether an archive preserves links.
- The gate's digest covers only what the run reads: a change to the chat procedures does not change it.

## Cost

- There is a build step between the source and what the run loads. In the repository the run entry has no `knowledge/`, so a real run is possible only in the image. The link between them is guaranteed by `INV-048` and the gate.
- Renaming or moving `knowledge/` affects both plugins and the image build.
- The project has to be a public repository, and the installation keeps a second, private one.
- A marketplace entry yields rows on the plugin's connectors tab, while the account's connectors supply the tools. GBrain without dynamic client registration needs its own connector with a Client ID.
- A chat release is manual: a new `sha`, then an update on claude.ai.
- Anthropic's marketplaces have no entries that combine `git-subdir` and `mcpServers`, and how claude.ai reads such an entry is not documented (`GAP-08`).
- Without a manifest `--plugin-dir` names the plugin after its directory, so launching the working copy means disabling the synchronized copy by hand.
- Claude Code gets an account's plugin only when signed in through claude.ai: a session with an API key will not receive it.
