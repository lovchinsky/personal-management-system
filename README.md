# Personal Management System

An open-source personal management system with proactive AI assistance, long-term memory, and reliable follow-through. The person decides what matters to them, and the system helps them not lose sight of it: it runs the canonical methodology (Identities, Areas of Focus, Objectives & Key Results, Projects, Behavior Systems, Tasks), watches for changes in Notion, returns to unfinished business at the right time and remembers decisions and context. Its conversational interface is the Personal AI Assistant, whose cognitive runtime is Claude; Notion holds the operational state, GBrain holds the semantic memory and the App handles execution and control.

This is the monorepo of the system's code, the plugin, the documentation and the deployment infrastructure. `gbrain-repo` is a separate repository of GBrain knowledge that sits next to the clone.

Personal Management System is an independent project: it is not affiliated with Anthropic, Notion Labs, Telegram, Voyage AI or the authors of GBrain, and it is not endorsed or sponsored by them. Claude, Notion, Telegram, Voyage AI and other names are trademarks of their respective owners.

## Requirements

- Docker with Compose, git, `openssl` and `curl`; the `claude` CLI for the subscription token.
- A Notion workspace in which you are the Workspace Owner, an internal integration in it, and the binding of the canonical model to the databases. An empty workspace gets the databases from the repository with one command from the App image (`notion build`; the schema is in [`contracts/notion-workspace.yaml`](contracts/notion-workspace.yaml)); a workspace of a different shape is bound using a template ([RUNBOOK §3](infra/RUNBOOK.md#3-notion-workspace-and-binding)).
- A Claude subscription on the Pro, Max, Ultra, Team or Enterprise plan: App runs use the subscription token ([ADR 0009](docs/decisions/0009-agent-sdk-app-triggered-run.md)). The token belongs to the installation owner, and the instance serves only that owner: the token is not handed to anyone else, and the system is not deployed for anyone else. The App has no other way of authenticating.
- A Voyage AI key for GBrain's embeddings and reranker.
- A Telegram bot is required as the notification delivery channel; BotFather creates it ([RUNBOOK §2.3](infra/RUNBOOK.md#23-telegram-bot)).
- A public HTTPS address for the Notion and Telegram webhooks and the chat connectors: an HTTPS tunnel on the local machine, Caddy on the server.
- A server: Docker with Compose, TCP 80 and 443 and UDP 443 reachable from outside, and two DNS records, one for the App and one for GBrain, pointing to the server.
- The `gbrain-repo` knowledge repository, a git repository that uid 1000 can write to.
- For the chat plugin: a GitHub account with the project's public repository and the installation's private marketplace repository.

The App image is built from the repository or taken from a registry the owner has chosen. It contains the Claude Code CLI, a proprietary Anthropic program, so it is not published to a public registry.

The system's data passes through Anthropic (the model), the hosted Notion MCP and Voyage AI (GBrain's embeddings and rerank); what exactly the providers store on their side is not known (`GAP-16`).

## Getting started

The local machine and the server follow the same procedure; the environment file and the Compose wrapper differ (`./bin/dc` or `./bin/dcp`). Installation: [“Part I. Installation”](infra/RUNBOOK.md#part-i-installation), with the steps in numeric order. Backup and restore, upgrading the App and GBrain, changing the embedding model, the FTS language, the public address and the passwords: [“Part II. Operations”](infra/RUNBOOK.md#part-ii-operations). Observability and troubleshooting: [“Part III. Observability and troubleshooting”](infra/RUNBOOK.md#part-iii-observability-and-troubleshooting). The runner is switched on with `RUNNER_ENABLED=true` after the stack has been checked: [RUNBOOK §8](infra/RUNBOOK.md#8-runner-and-reviews).

## Status

Implemented M0–M9 of the [plan](docs/5-plan.md#milestones): an audit of external interfaces, the semantic adapter, runtime continuity, the App MCP and the runner on the Agent SDK, the Skill and the chat path with capture, canonical domain behavior and the dependency flow, proactive detectors, the GBrain knowledge lifecycle, scheduled reviews with the sweep and thread reconciliation, approvals by behavioral criteria, with a proposal's fate in its thread. Open milestones: M10 (evals and calibration) and M11 (production validation on a VPS). The production deployment is described (`infra/compose.prod.yaml`, Caddy, the [RUNBOOK](infra/RUNBOOK.md)); M11 covers its acceptance on a VPS. Open defects, gaps and risks are in the registers of the [plan](docs/5-plan.md#defect-register).

A milestone is accepted by its gate. Gates M3–M9 are commands from `app/test/gate/` that the project maintainer runs on the local machine ([`infra/GATE.md`](infra/GATE.md)). Gates M1 and M2 are proven by model-free tests: the adapter's conformance tests and integration tests against a live database; gate M0 is an interface audit and has no artifact in the repository. A gate verdict is the result of a run on a specific build and is not part of the repository: on your own build, the same command reproduces it.

## Layout

The full layout with explanations: [`docs/2-system.md`](docs/2-system.md#repository-and-filesystem-layout).

```text
personal-management-system/
├── app/        — NestJS + Prisma App source and the runner plugin
├── plugin/     — the chat plugin: Skill, knowledge and connectors
├── contracts/  — canonical lists and invariants (machine-readable; code, not documentation)
├── docs/       — canonical system documentation
└── infra/      — Docker Compose, Caddy, database initialization, runbook and gate

../gbrain-repo/  — canonical GBrain Markdown/frontmatter knowledge (a separate Git repo)
```

## Languages

The repository, the documentation and the code are in English. The App writes its own messages to the person (system messages, buttons, consent pages) in one of the languages that have a catalog, English (`en`, the default) or Ukrainian (`uk`), chosen by `APP_LANGUAGE` ([ADR 0042](docs/decisions/0042-app-texts-language.md)). The model talks to the person in the person's language, in the voice that [ADR 0046](docs/decisions/0046-system-voice.md) describes. The Ukrainian strings in tests, fixtures and gate scenarios are deliberate: they test the Ukrainian catalog and Ukrainian input.

## Documentation

See [`docs/README.md`](docs/README.md): it routes each question to the document that answers it, and its section [“Terms”](docs/README.md#terms) explains the words the project uses in a fixed sense.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md): how to run the checks, the conventions a change keeps and how a decision is recorded. The project is maintained by its owner, the project maintainer, who decides what is merged.

## Secrets

See [“Security”](docs/2-system.md#security).

## License

The code of this repository is licensed under [MIT](LICENSE). Dependencies have their own licenses: Claude Agent SDK and Claude Code, which the App image contains, are proprietary Anthropic programs under Anthropic's terms, so the App image is not published.
