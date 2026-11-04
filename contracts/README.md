# contracts/

Three files, all **written by hand**, hold statements about how the system regards the domain and how it wants its Notion workspace to look.

| File | What it describes |
|---|---|
| `canonical.yaml` | Canonical types, fields, statuses, lifecycles and permissions — the model the system thinks in. It also holds the `conflicts:` block with discrepancies between sources. |
| `invariants.yaml` | The `INV-xxx` invariants and what checks each one. |
| `notion-workspace.yaml` | The physical schema of Notion (databases, properties, relations, options, formulas) and the binding of the canonical model to it by name. The `notion build` command builds the databases from it and writes the binding, and the gate builds its own workspace from it. |

## Statements, not measurements

This directory holds **statements**. At runtime the App needs the database id, the property id and the status option id, and all of them come from the binding, not from here. A measurement is needed to write a statement, but the measured file alone asserts nothing.

Checks live where the truth lives. A check runs against a live Notion and a live GBrain when a credential is available. For the runner, the check runs where the App reads the `init` of **its own** run. A check that cannot fail for a real reason is worse than none: it gives the impression of a guarantee.

`notion-workspace.yaml` is written by hand, and workspaces are built from it. It contains no ids, only names; the binding generator substitutes the ids from the live workspace.

## Binding to the physical workspace

The canonical model here is workspace-independent. The **binding** is the record of which database is `Task`, which property holds the status and which option ID corresponds to `Next Action`. It does not live in this directory: a machine sees a database called “Habits”, but only the owner knows what it means in this system, and the answer is different in every installation.

The binding lives in `infra/notion/mapping.yaml`, outside git. For a workspace that follows the schema of `notion-workspace.yaml`, `notion build` writes it; for a workspace with a different structure, it is filled in by hand from the template that `notion template` writes out (RUNBOOK §3). It is not a secret: it contains only identifiers.

The link between the binding and this directory is one-way and exists to detect discrepancies:

- `notion template` takes the slots from `field_contract` **here** and writes out an empty template;
- the binding schema `app/src/notion/binding/binding.schema.ts` is the implementation of the same contract in code;
- a canonical field that is here but not in the schema ends up in the template, and the App rejects it as an extra key; a field that is in the schema but not here is not in the template, and the App requires it as a missing key.

A discrepancy in either direction is flagged explicitly: the App rejects an extra key and requires a missing one, and `app/test/contract/model-agreement.spec.ts` fails as soon as the fields of the contract and of the schema diverge.

## Consumers

- **The App (TypeScript)** resolves property and option IDs from the binding, not from constants in the code. The running App does not read the contracts: it implements the contract with a schema and types instead of interpreting its file.
- **The `notion` command** from the App image builds the databases from `notion-workspace.yaml`, writes the binding from it and checks an existing workspace against it (`build`, `check`), and takes the binding template from `canonical.yaml` (`template`). The image contains both files.
- **The gate** builds its own workspace from `notion-workspace.yaml`.
- **Contract tests** are model-free checks that use no service other than the App's own database.
- **The Skill** contains the contract's numbers and lists in its own text: the model reads the Skill, not `canonical.yaml`. `app/test/contract/skill-canon.spec.ts` keeps the Skill in agreement with the contract.
- **Documents** refer to a key and do not copy values from here by hand.

## Composition of the contract test set

A contract test is a model-free check that uses no service other than the App's own database (the `ci-contract` lane in `invariants.yaml`). The set must consist of:

```text
every invariants.yaml entry with verifiable_by: ci-contract
the canonical model and the binding schema describe the same set of fields
notion-workspace.yaml is consistent with itself and with canonical.yaml
the App MCP exposes no forbidden names
app_db contains no domain tables
both execution surfaces read the same domain knowledge
the toolset of an App-triggered run contains no built-in tools except Read in the plugin directory
the adapter rejects unknown values instead of substituting a default
```

**This is the definition of the set, not a description of its current state.**

`invariants.yaml` keeps the location of the check in `test:`: either an existing file that names its invariant, or a reserved place for a check that is not in the tree. So “`verifiable_by: ci-contract`” cannot be read as “covered in CI”, only as “verifiable without the model”. `app/test/contract/registry.spec.ts` counts how many entries have an existing check: the count is in the title of its `describe`. The same spec enforces the rules of the `test:` field: the lane according to `verifiable_by`, the name of the planned place and agreement with the `SCEN-20-NN` rows. These numbers are not written by hand: a number duplicated in a document is already out of date.

A check is written when its subject exists: a `.spec.ts` for a subsystem that does not exist yet would test an intention, not the system.

## Origin of statements

In the `origin` field, `invariants.yaml` names a **live section** that states each invariant normatively, such as `docs/2-system.md § Tool surface boundaries`. The `INV-2xx` band has no `origin`: no document states these criteria, so the registry itself owns them.

`canonical.yaml` stores no origin: a value in it **is** the statement. The `decision` field names the decision that justifies the value. That decision is the home of the value's “why”, not the source the value comes from. The lifecycle rules (`rules:`) are also the home of their rationale: code refers to the key and does not restate the rationale. The reference forms are in [`docs/README.md`](../docs/README.md#reference-forms).

Discrepancies between opposing positions live in the `conflicts:` block, where each variant is labeled with **the position** it represents, not with where it comes from.

## Conflicts

`canonical.yaml` contains a `conflicts:` block of places where the sources state different things about the same fact, each with both versions.

A conflict is a discrepancy between the sources themselves, not an editorial error: both wordings exist in the source documents, and the choice between them is a decision for the project maintainer, not an editorial edit. Each entry has `resolve_in`, the milestone that must close it. A closed conflict disappears from the block, and its resolution becomes an ordinary statement of the model.
