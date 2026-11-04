# ADR 0019 — Configuration lives in owner modules and arrives typed

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D19` |
| **Related** | ADR 0011 · `INV-060` · `INV-078` · `INV-080` · `INV-081` · `INV-093` |

## Context

The App's settings — the numbers and switches of the modules, addresses, secrets — are read by the capability modules above the platform (ADR 0011). Each common way of reading them has its own drawback:

- a shared config namespace holds the numbers of modules that do not know one another side by side: a number that only delivery changes sits next to numbers it does not know, and the pace of several workers becomes one number by coincidence;
- a string key (`config.get<number>('<namespace>.<key>')`) is not checked by the compiler, and the type is only the reader's promise;
- an environment variable read where it is needed keeps its default in the consumer, and a missing value fails when the consumer is first called, not at startup.

## Decision

**Every setting has one owner — a config namespace in the module that reads it — and arrives at the consumer typed.**

- **The namespace lives in the owner module.** `registerAs` sits next to the code that reads the value, and the module registers the namespace itself (`ConfigModule.forFeature`). `AppModule` loads the namespaces of the whole application — the time zone, the language, the grammatical gender for addressing the owner and the port, the throttler's limits, the switch for background work.
- **The value arrives typed.** The consumer receives the namespace by injection: `@Inject(x.KEY) cfg: ConfigType<typeof x>`. There are no string keys for settings.
- **Only the namespace factory reads the environment.** The default value lives there too, and the environment validation (`config/env.validation.ts`) is responsible for the shape. A required variable that is missing stops startup. A variable needed only when the runner is enabled is optional in the namespace: it is required by the environment validation when the runner is enabled, and by whoever uses it.
- **The name of an environment variable is an agreement with the operator** (`infra/.env.example`, RUNBOOK), while a namespace field is a name for the code; the factory translates one into the other.

## Consequences

- A module that needs a value names its namespace in `imports`, and the dependency on settings is visible the same way as a dependency on a module.
- A contract test enforces the rule (`INV-093`): nobody imports `ConfigService` in App code, and only the config namespace factories and the entry point `app.module.ts` read `process.env` — it needs `NODE_ENV` before the settings exist. A gate run is a test: it sets the environment of its App instance before importing it.
- A namespace lives in the directory the variable belongs to: the Notion REST credential and the Notion MCP grant have different namespaces (`INV-060`), the binding is read by the namespace of `notion/binding/` (`INV-081`), the platform has its own namespaces (`INV-078`), and a capability module does not export its namespace (`INV-080`).
- A test gives a service a typed namespace, not a `ConfigService` with keys.

## Cost

- There are more namespaces: one per module that has settings.
- A value is read once, when the module is built, not on every call. The process environment does not change while the process runs, so the answer is the same; a test that needs a different value supplies a different namespace.
