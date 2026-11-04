# Contributing

Personal Management System is maintained by its owner, the project maintainer ([Roles](docs/README.md#roles)), who decides what is merged. Propose a change as a pull request that says what it changes and which norm, contract or decision it touches.

## Set up

The App is a Node.js 22 project in `app/`. From that directory:

```bash
npm ci
npx prisma generate
```

[Dependencies](app/README.md#dependencies) in `app/README.md` explains the Prisma client.

## Run the checks

Before you propose a change, make these pass from `app/`:

```bash
npm test
npm run lint
npm run format:check
```

`npm test` type-checks the code and runs the unit tests, the contract tests (`app/test/contract/`) and the tests of the gate code. The contract tests keep the documents, the contracts, the Skill and the code in agreement: a dangling reference or a sentence that narrates change fails them just as a broken import fails the build.

A change that touches the database, a queue or the HTTP surface also passes the integration and e2e lanes. They need Docker: `infra/ops/test-db.sh` starts an ephemeral Postgres on loopback, and the lanes refuse to run against any other database.

```bash
npm run db:test -- up
npm run test:integration && npm run test:e2e
npm run db:test -- down
```

[Check lanes](app/README.md#check-lanes) and [Test database](app/README.md#test-database) in `app/README.md` say what each lane covers.

The gate runs the real Skill on real connectors in its own environment and spends Claude plan quota. The project maintainer runs it ([`infra/GATE.md`](infra/GATE.md)), and a change to the Skill is accepted on the gate's verdict.

## Conventions

A change keeps these; each is stated once, in the place linked.

- **Documents.** Start from [`docs/README.md`](docs/README.md). A fact has one home: values in `contracts/`, a rule and its rationale in the rule's home ([Where the “why” lives](docs/README.md#where-the-why-lives), which also says what to do when text and code diverge). Documents refer to each other in the [reference forms](docs/README.md#reference-forms) and in the [one-way direction](docs/README.md#reference-direction--one-way).
- **Markdown.** One source line per paragraph and per list item, with no hard wraps.
- **Final state.** Text and comments describe the system as it is and a decision in its final form. Change narration (“now”, “previously”, “used to”) fails `app/test/contract/final-state.spec.ts`; history lives in git.
- **Code comments.** English. A comment states the local invariant, the consequence of violating it in one sentence (“otherwise …”) and a pointer to the rule's home.
- **Invariants.** [`contracts/invariants.yaml`](contracts/invariants.yaml) is the only place `INV-xxx` IDs are assigned. An ID never moves, and each entry names the section that states it and the check that enforces it.
- **Contracts and the Skill.** A value changes in [`contracts/`](contracts/README.md). The Skill carries its own copy of the numbers and lists the model needs, and `app/test/contract/skill-canon.spec.ts` keeps the copy in agreement with the contract.
- **Migrations.** Written as [Migrations](app/README.md#migrations) describes. The file of an applied migration does not change.
- **Languages.** The repository is in English; the Ukrainian strings in tests, fixtures and gate scenarios are deliberate ([Languages](README.md#languages)).

## How a decision is recorded

A choice between options is an ADR in [`docs/decisions/`](docs/decisions/): a file `NNNN-<title>.md` with the Status, Decision key and Related table, then Context, Decision, Rejected options, Consequences and Cost, plus a row in the table of [recorded decisions](docs/5-plan.md#recorded-decisions). An ADR says why this option was chosen; the rule in force and its rationale live in a normative section.

An ADR describes a decision in effect. Adopting, changing or withdrawing a decision means writing, rewriting or deleting its ADR, and an ADR does not amend another one. When two norms contradict each other, the project maintainer decides.
