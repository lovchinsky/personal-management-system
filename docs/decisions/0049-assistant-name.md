# ADR 0049 — Assistant name: an optional setting carried by the channel accounts

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D49` |
| **Related** | ADR 0017 · ADR 0019 · ADR 0042 · ADR 0043 · ADR 0046 · ADR 0047 · `INV-037` · `INV-314` · `GAP-35` |

## Context

The conversational interface of Personal Management System is a single assistant, the Personal AI Assistant: the person talks to it in a Claude chat, receives its messages in Telegram and reads its comments in Notion. Two authors write the texts — the model by the rules of the Skill and the App from the catalog of the installation's language (ADR 0042) — but they speak in one voice (ADR 0046).

The owner may want to address the assistant by name. The project is open and belongs to everyone who deploys it, so a name set by the project would be a character the owner did not choose. A name in code identifiers, contracts or data would become an architectural concept, and one written into data would go out of date with the first renaming.

Accounts show the sender in the channels. The chat with the Telegram bot and its notifications carry the bot's name; Notion shows the system's writes under the integration's name (ADR 0017) and a comment with a kind label under the label (ADR 0043). The owner sets both names in the service that owns the account: in BotFather and in the Notion developer portal. Logic does not depend on the names: the App recognizes its own writes by the bot's id, and the Notion MCP shows the model the author of an integration's comment as `bot`, without a name or an id (measured).

So the name the person sees in the channels is one the model does not see anywhere. Yet the person calls the assistant by it — “Alex, move it to Friday” — and among the people in the person's matters there may be someone with the same name.

## Decision

**The assistant name is an optional installation setting. The channel accounts carry it, and the model knows it in order to understand when it is addressed.**

- **Setting.** `APP_ASSISTANT_NAME`; empty means there is no name, and the system works the same. The grammatical gender the assistant uses when it speaks of itself is a separate voice setting (ADR 0046).
- **Carriers of the name.** The Telegram bot and the Notion integration: the owner gives them the assistant's name in their services, and the product name when the assistant has no name. The App does not rename accounts.
- **Model.** It receives the name and the gender from `runtime_read` (`assistant_name`, `assistant_gender`): one plugin serves all installations (ADR 0047), while each installation has its own name. The Skill mentions the field `assistant_name` next to `runtime_read`: when the assistant is addressed, this name means the assistant, and outside an address it may belong to another person as well. The chat reads it as soon as the person calls the assistant by name. Within the App, only `runtime_read` reads the name and the gender: their config namespace belongs to the App MCP server (ADR 0019).
- **The name is at the user-facing level.** It does not change behavior, authority or methodology. It does not appear in the names of the repository, packages, API, tools, modules, canonical Notion objects and contracts, in the memory schema, in logs, metrics and run identifiers. The App does not insert it into texts and does not store it, so a rename is a setting and the names of the accounts, not data.
- **There is one assistant.** The App's texts that concern interaction speak in the assistant's first person, and Claude in them is the place of conversation (“ask me in a Claude chat”), not a second interlocutor. The App's messages about failures and security say what happened to the system and do not present it as the assistant's conclusion.
- **The product name** appears at the technical points of identification: the repository, the image, the plugins, the consent pages, the bot description, the default name of the Notion MCP OAuth client.

**Rejected:**

- **An assistant name set by the project.** The owner of each installation names its assistant — or does not.
- **A persona with a character and a biography.** A name is a way of addressing the assistant; behavior is set by the Skill and the policy.
- **The name in texts: a message signature or the display name of the model's comment.** The account already shows the sender, so a name in the text would be repeated in every message, and one stored in a comment would go out of date with the first renaming.
- **The product name as a mark on system messages.** The account shows the sender, and a failure message already says what happened to the system: the product name in the text would become a signature.
- **The App renames the accounts itself** (Telegram's `setMyName`). The bot's name would have two owners — BotFather and the App — and the name of a Notion integration cannot be changed through the API, so the channels would diverge anyway.
- **A name read from the accounts** (`users.me`, `getMe`). The bot and the integration may spell it differently, and an account name cannot express the state “no name”: without a name it is the product name.
- **A line in the `instructions` of the App MCP server.** The name would reach the model by a second path next to `runtime_read`, and whether every client — the chat and the run — shows this field to the model has not been established.

## Consequences

- The assistant's name and gender form the config namespace in `mcp/server/assistant.config.ts`, not a namespace of the whole App.
- The entry of each Skill surface mentions `assistant_name` and the assistant's gender next to `runtime_read`; the first-read limit counts these words (`INV-037`).
- The App's catalogs name Claude as the place of conversation.
- RUNBOOK refers to the bot and the integration by the setting; changing the name involves the setting, the account names and a restart of the App.

## Cost

- The name lives in three places — the setting, the bot's name and the integration's name — and the owner keeps them in agreement. A mismatch breaks nothing, but the person calls the assistant by the name they see, and the model recognizes the one `runtime_read` gave it.
- In the chat the name costs a `runtime_read` call when the person calls the assistant by name; the model might not check a name used outside an address with such a call.
- Whether the model tells an address to the assistant apart from words about a person with the same name has not been verified live (`GAP-35`).
