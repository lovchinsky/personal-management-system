# ADR 0011 — App modules: capabilities over a neutral platform

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D11` |
| **Related** | `INV-078` |

## Context

The system changes through flows: “event → evaluation window”, “origin → run”, “button press → decision”. Each flow has an entry, a capability that does the work, and a shared mechanism beneath it: the database connection, the queue in Postgres, the background-work loop, the boundaries of the local day.

Code grouped by technical kind would cut every flow into several groups, and the shared mechanism would depend on the formats of the flows it serves. A package that everything depends on could not be started without the settings of individual flows, packages would form cycles, and a test could not import a module and would wire the providers by hand.

## Decision

**App code is grouped by capability — by what the system does — on top of a neutral platform. Dependencies go one way: from entries to capabilities, from capabilities to the platform.**

`platform/` holds what the capabilities share: the connection to `app_db`, the queue protocol in Postgres, the background-work loop, the boundaries of the local day. It depends on no capability: of the App's code it imports only itself and the generated Prisma client (`INV-078`).

The placement of each directory is set by the [module map](../2-system.md#module-map).

**Rejected:**

- **Grouping by technical kind.** It cuts every flow into several groups, and the shared mechanism pulls in the formats of the flows it serves.
- **Breaking a cycle with events or `forwardRef`.** An event bus would hide the dependency, not reverse it.

## Consequences

- A contract test checks `INV-078`: an import of an App module in `platform/` fails `npm test`.
- The module map is normative: it names every first- and second-level code directory and names no directory that does not exist; `app/test/contract/module-map.spec.ts` checks this.
- A cycle between modules is a structural flaw, and it is fixed by changing the direction of a dependency.
- There is deliberately no shared reader of physical Notion values: the SDK already describes the shape of the payload, and the policies for “empty” differ between the decoder and the preconditions; both readers live in `notion/`.

## Cost

- The map is normative, so a new or moved directory changes both the code and [`2-system.md`](../2-system.md#module-map); imports in tests have to be changed to follow the paths.
- The queue protocol knows the queue tables through a closed list: the table name goes into SQL raw, and the type of that list is the only place where that is safe. A new queue means an edit to `platform/queue/`.
