# ADR 0048 — The physical Notion schema lives in the repository, and the App image's command and the gate build workspaces from it

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D48` |
| **Related** | ADR 0001 · ADR 0041 · `INV-081` |

## Context

The canonical model does not depend on a workspace: the binding says which database is `Task`, which property carries the status and which option id corresponds to `Next Action`. The databases, their properties, two-way relations, status options and formulas — the physical schema — belong to a particular workspace. A person with an empty Notion would have to recreate eleven databases with relations and formulas by hand and then fill in the binding by id, and nothing would check the recreated schema against the intended one.

The physical schema is the schema of the system's external store, just as the Prisma migrations are the schema of its database. The migrations are applied by the App image they ship with: the project's code runs only in images, so the installation machine needs neither Node nor the project's dependencies.

The gate needs its own workspace with a schema that matches the intended one (ADR 0041).

The system's databases sit at the top level of the workspace, and only a personal token creates them there: an internal integration cannot. A personal token has all the owner's rights on the workspace. REST creates properties, options and two-way relations. It rejects formulas that read a related database (“Type error with formula”). It does not grant an integration's access to a database or a webhook subscription at all: a person opens those.

## Decision

**The physical Notion schema lives in `contracts/notion-workspace.yaml`, and the `notion` command from the App image and the gate build workspaces from it.**

- The file has two blocks. `databases` holds eleven databases: name, icon, description and properties by name; a relation names its target database and its pair, a select and a status carry their own options, a formula its own expression. `binding` is the shape of the binding file with names instead of ids: a canonical type points to a database name, a field to a property, a value of a closed set to an option, a signal to a formula. There are no ids in the file: the workspace issues them. The file is written by hand.
- The `notion` command is a one-off action of the App image, the Compose service `notion`, which `up` does not start. The App image carries `contracts/notion-workspace.yaml` and `contracts/canonical.yaml` as it carries the migrations: the schema of the external store ships with the code that works with it. Subcommands:
  - `build`: the personal token creates the databases at the top level of the workspace, and the command reads them back, checks them against the file, verifies that the integration sees every database and writes the binding, in which the names are replaced with the ids of the live workspace. The ledger of built databases (database name → data source) is written right after each database is created, so a repeated launch completes what is unfinished and does not create a database a second time. The command changes only the databases in its ledger. It does not overwrite a binding that belongs to another workspace (the key `workspace`) or that exists without a ledger: such a binding describes databases that were not built here, and building would create a second set of them.
  - `check` only reads, with the integration token: the databases are taken from the existing binding, and discrepancies between the schema and the file, and formulas that differ, are reported. Exit code 1 means that the schema has diverged.
  - `template` yields a starter binding from the slots of `contracts/canonical.yaml` for a workspace of a different shape.
- The command's files are kept together in the directory `infra/notion/`: the binding `mapping.yaml`, the ledger `workspace.yaml` and `formulas.md`. The directory ships with the repository, the command mounts only it as writable, and the App reads the binding from it. The directory is moved between machines whole, so a binding never ends up without the ledger it was built from.
- The personal token lives only for the duration of the invocation: it is supplied to `notion build`, and Compose passes it only to the `notion` service. The App does not receive it.
- **A person enters the formulas.** REST does not accept formulas that read a relation, so one rule applies to all formulas: every formula column is created with an empty expression, and the text goes into `formulas.md`. The check compares the entered expression with the contract; whitespace outside string literals is insignificant and is not part of the comparison. Formulas are optional: a signal gets into the binding only from a formula that has an expression, and a repeated `build` after the formulas are pasted in adds the signals.
- The gate builds its workspace with the same engine from the same file; what the gate adds to that is decided by ADR 0041.
- The engine — reading the schema of a live workspace, building, checking, formulas for entering by hand, the binding from names into ids, the template — lives in `app/src/notion/workspace/` together with the command's entry point, one engine for the command and the gate. The running App does not load this directory (`INV-081`).

Not done automatically: the expressions of formulas, the integration's access to databases and the webhook subscription.

Growth of the schema is an edit to the contract under the criterion of ADR 0001.

**Rejected:**

- **Exporting the contract from a live workspace.** The workspace would be the source and the file its snapshot, which asserts nothing.
- **Writing formulas automatically.** Neither REST nor the Notion MCP accepts formulas that read a related database. The interface's internal API would write them, but it is unofficial and needs a browser session with access to the whole Notion account.
- **A Notion template to duplicate.** It lives in Notion, not in the repository: it is neither versioned with the code nor checked.
- **A command on the installation machine, outside the image.** It would require Node and the project's dependencies for a single installation step and would give the engine a second way of launching alongside the gate, whereas the schema of the external store belongs to the image that works with it.
- **A personal token in the environment file.** It grants all the owner's rights on the workspace and is needed only while building; in the environment file it would sit on the machine permanently.

## Consequences

- An empty workspace gets its databases from the repository with one command from the image, and the gate workspace is built without access to another workspace. Node and the project's dependencies are not needed on the installation machine; the tools it needs are listed in RUNBOOK §1.
- The contract is kept consistent with `contracts/canonical.yaml` by a check (`app/test/contract/notion-workspace.spec.ts`): a slot that the binding does not name, or a name that the schema does not have, is caught before building. The Compose service, the command's entry point and the image's files are checked by `app/test/contract/notion-command.spec.ts`.
- An installation sees where its workspace has fallen behind the contract with the `notion check` command.
- The App image carries two contract files; the running App does not read them.

## Cost

- A schema change is an edit to the contract. A repeated `notion build` brings the databases in its ledger up to the contract automatically, except for formula expressions; a workspace of a different shape, built without the command, is brought up to it by hand. `notion check` shows where a workspace has fallen behind but does not fix it.
- A person pastes the formulas in every workspace — a new or changed formula of the contract too.
- The personal token, the integration's access to databases and the webhook subscription are manual steps.
- A person maintains the contract. An edit made directly in Notion is visible only to `notion check`.
- The command removes an extra property from a database in its ledger: the target is exactly the contract.
- The App image is needed before the databases are built, and uid 1000 can write to `infra/notion/`.
