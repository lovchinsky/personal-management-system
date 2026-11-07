# App

The NestJS application of Personal Management System: event intake, runs, capabilities and the App MCP. Its design is in [`docs/2-system.md`](../docs/2-system.md), its operation in [`infra/RUNBOOK.md`](../infra/RUNBOOK.md), and the acceptance of milestones through a gate in [`infra/GATE.md`](../infra/GATE.md).

## Dependencies

Node.js 22 is the major version of the App image. From this directory, run:

```bash
npm ci
```

The Prisma client is generated from the schema into `src/generated/` (outside git):

```bash
npx prisma generate
```

## Check lanes

Commands run from this directory.

| Command | What it checks |
|---|---|
| `npm test` | types, unit and contract tests, and the tests of the gate code: `src/**/*.spec.ts`, `test/contract/`, `test/gate/**/*.spec.ts` |
| `npm run test:integration` | repositories, queues and capabilities against a real Postgres, and the search dictionary of the database container: `test/integration/` |
| `npm run test:e2e` | the whole application over HTTP: `test/*.e2e-spec.ts` |
| `npm run lint` | code rules (check only; `npm run lint:fix` fixes them) |
| `npm run format:check` | formatting (`npm run format` fixes it) |
| `npm run build` | the build into `dist/` |

## Test database

The integration lane and the e2e lane work only with the ephemeral database `app_test` on `127.0.0.1:55432` and refuse to run if `DATABASE_URL` points elsewhere: the lanes write rows, and the integration lane also clears the tables before each test. The lane applies the migrations to the database automatically.

```bash
npm run db:test -- up
npm run test:integration && npm run test:e2e
npm run db:test -- down
```

The database container (`infra/ops/test-db.sh`) runs outside the stack, on loopback. Its password is in the repository and is not a secret: the container keeps no data and is deleted together with its volume.

`test/integration/postgres-dictionaries.spec.ts` starts one more container of its own, with the image, entry point and mounts of the stack's `postgres` service, and removes it together with its volume at the end ([ADR 0050](../docs/decisions/0050-search-language.md)).

The integration lane allows a test up to 30 seconds (`testTimeout` in `test/jest-integration.json`): its longest tests (a week of scheduler ticks, evaluation windows, the run budget) take up to two seconds, and an image build or a gate run alongside slows them down several-fold. Jest does not stop a test that has exceeded the limit: its unfinished work would land in the database that the next tests use.

## Migrations

The App image applies the migrations: its start command first runs `prisma migrate deploy`, so the database is brought up to the schema of the image at every start, and a failed migration stops the container. A backup is taken before an installation is upgraded (RUNBOOK §16).

**A new migration is written without a database.** Prisma does not describe partial unique indexes, so they live in the migration file as handwritten SQL, and `prisma migrate dev` would remove them as drift. Create the migration directory:

```bash
mkdir -p "prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<name>"
```

With the ephemeral test database running (`npm run db:test -- up`), write the difference between the migration history and the schema to a file in that directory:

```bash
SHADOW_DATABASE_URL="postgresql://app:app@127.0.0.1:55432/postgres" npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script > "prisma/migrations/<same directory>/migration.sql"
```

`SHADOW_DATABASE_URL` is required: to obtain “the state after the existing migrations”, Prisma replays them in a temporary database that it creates and resets. The value above points to the test database container; do not use the main database here, because Prisma would reset it. `prisma.config.ts` has no fallback value: a silent substitution would cost the contents of the database that `DATABASE_URL` points to.

Then add partial indexes, `CHECK` constraints, functions and triggers to the same file by hand: Prisma describes none of them. The integration lane checks, against the database, that none of them is forgotten: `test/integration/schema-shape.spec.ts` checks the required indexes; `test/integration/run-trace-fields.spec.ts` checks that the fields of the run trace are mandatory, together with the trigger constraint between its tables; `test/integration/inv-083.spec.ts` checks that every JSON column is a document from the `json_documents` list in `contracts/canonical.yaml`.

**An enum value and its use go in different migrations.** Postgres refuses to use a value in the same transaction in which `ALTER TYPE … ADD VALUE` added it (`New enum values must be committed before they can be used`), and Prisma wraps each migration in one transaction. A migration that adds a value and immediately fills something with it fails as a whole, and the rollback leaves `_prisma_migrations` with a failed entry, after which `migrate deploy` refuses until a person steps in.

**A migration that moves data is written in three steps** in one file: new tables or columns → the `INSERT … SELECT` transfer → removal of the old ones. The generated diff produces only the first and the last, so the transfer is inserted between them by hand, and a column rename is written as `RENAME COLUMN` instead of the generated `DROP` and `ADD`. A failed transfer does not leave a half-transferred schema: the migration is one transaction. Before a migration runs on the main database, it is run on a copy of that database: a dump of `app_db` (RUNBOOK §10) is restored into a separate database in the test container, the migration is applied there, and a query compares what was moved with what was there. A migration that drops or moves columns says so in a rationale comment at the top of the file: rolling back after it means restoring the database, not rolling back the image.

A deferred rule (`DEFERRABLE INITIALLY DEFERRED`) is checked at commit, and Prisma reports a failed commit as a closed transaction, losing the cause. So code that writes to a table with such a rule in several statements ends its transaction with `SET CONSTRAINTS ALL IMMEDIATE`: the violation then arrives as a statement error that carries the name of the rule.

The file of an applied migration does not change.

## Binding to Notion

The Notion databases and their binding are built by the operator command `notion` from the App image: its entry point is `src/notion/workspace/workspace-command.ts`, and the engine is next to it, in the same directory. The Compose service `notion` launches it (RUNBOOK §3); the engine's tests run in the `npm test` lane against an in-memory Notion.
