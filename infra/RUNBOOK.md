# Personal Management System — operational runbook

Installation, operations and troubleshooting of Personal Management System: *what to run and in what order*. The design of the system and the reasons for it are not described here, only what follows from them for the installation owner.

One procedure serves both environments:

| Environment | Environment file | Wrapper | Compose overlay | Public address |
|---|---|---|---|---|
| local machine | `infra/.env.local` | `./bin/dc` | `compose.local.yaml`: the App on `127.0.0.1:3000`, GBrain on `127.0.0.1:3131` | an HTTPS tunnel to these two ports |
| server | `infra/.env.prod` | `./bin/dcp` | `compose.prod.yaml`: Caddy on ports 80 and 443, two domains | `https://<APP_DOMAIN>`, `https://<GBRAIN_DOMAIN>` |

The wrapper is `docker compose` with the environment file and the overlay for its environment. Run the commands from the `infra/` directory of the clone. They are written here with `./bin/dc`; on the server, run the same command with `./bin/dcp`.

The configuration lives in these files, not in the text of the runbook:

| File | Role |
|---|---|
| [`compose.yaml`](./compose.yaml) | the base Compose file: `postgres`, `app`, `notion`, `gbrain`, `gbrain-maintenance`, `gate`, networks and volumes |
| [`compose.local.yaml`](./compose.local.yaml) | the local machine's overlay: ports on loopback |
| [`compose.prod.yaml`](./compose.prod.yaml) | the server's overlay: Caddy, GBrain's trust-proxy setting and GBrain's address taken from `GBRAIN_DOMAIN` |
| [`postgres/init.sql`](./postgres/init.sql) | roles, databases, extensions, the RLS trigger and GBrain's search configuration |
| [`postgres/install-dictionaries.sh`](./postgres/install-dictionaries.sh) | the installation of the search dictionary into Postgres on every start |
| [`postgres/dictionaries/`](./postgres/dictionaries) | the installation's search dictionary, when the search language needs one ([§1](#search-dictionary)) |
| [`notion/`](./notion) | the installation's Notion files: the binding, the ledger of built databases, formulas ([§3](#3-notion-workspace-and-binding)) |
| [`docker/gbrain/Dockerfile`](./docker/gbrain/Dockerfile) | the GBrain build from the pinned `GBRAIN_REF` |
| [`caddy/Caddyfile`](./caddy/Caddyfile) | HTTPS for `APP_DOMAIN` and `GBRAIN_DOMAIN` |
| [`.env.example`](./.env.example) | the template for both environment files |
| [`marketplace.example.json`](./marketplace.example.json) | the template for the chat plugin's marketplace |
| [`bin/dc`](./bin/dc), [`bin/dcp`](./bin/dcp) | the wrappers for the two environments |
| [`bin/gate`](./bin/gate) | the gate, the milestone acceptance test on the local machine ([`GATE.md`](GATE.md)) |
| [`ops/test-db.sh`](./ops/test-db.sh) | the ephemeral test database, outside the stack |

Steps are numbered consecutively, and the number is part of the heading: `§6.2` is `### 6.2. Notion webhook subscription`. Work through Part I by ascending step number.

An irreversible step of a procedure comes **after** the check that justifies it. Where the check cannot be made beforehand, irreversibility is postponed: the new artifact is created alongside the one in force and replaces it only after it has been read back.

---

## Part I. Installation

### 1. Requirements

#### Accounts

| Service | What you need | Used for |
|---|---|---|
| Claude | your own Pro, Max, Ultra, Team or Enterprise subscription and the `claude` CLI ([installation](https://code.claude.com/docs/en/setup#install-claude-code)), logged in to that account | App runs ([§2.1](#21-claude-subscription-token)) and the chat |
| Notion | a workspace in which you are the Workspace Owner: only the workspace owner creates the integration ([§2.2](#22-notion-integration)) | the state of management and execution |
| Telegram | an account to create the bot with ([§2.3](#23-telegram-bot)) | the delivery channel; required |
| Voyage AI | an API key: [dashboard.voyageai.com](https://dashboard.voyageai.com/organization/api-keys) → API keys → Create new secret key | GBrain's embeddings and reranker (`VOYAGE_API_KEY`) |
| GitHub | the account `<OWNER>`: the project's public repository and the private marketplace repository | the chat plugin ([§6.4](#64-app-mcp-and-chat)) |

The marketplace pins a commit of the project repository, and claude.ai does not read a private external source, so the project repository on GitHub is public. The clone the installation is deployed from is a clone of this repository.

**Notion MCP query allowance.** On the Free plan, queries to databases in the `sql` and `rows` modes share one workspace allowance: 10 per hour. App runs and the owner's chat share it.

#### Tools

- Docker with Compose v2;
- git;
- `openssl` and `curl`;
- the `claude` CLI, for the subscription token.

Everything else comes from the images: the App, GBrain and the `notion` command that builds the Notion databases ([§3](#3-notion-workspace-and-binding)) run in Docker.

#### Server

- Docker with Compose v2;
- TCP 80 and 443 and UDP 443 (Caddy's HTTP/3) are reachable from outside; the stack does not publish ports `3000`, `3131` and `5432` externally;
- two DNS records (`<APP_DOMAIN>` for the App and `<GBRAIN_DOMAIN>` for GBrain) point to the server before the first start: Caddy obtains certificates for these names. There is no proxy between DNS and Caddy: the App (`trust proxy 1` in the code) and GBrain (`GBRAIN_HTTP_TRUST_PROXY=1` in `compose.prod.yaml`) trust exactly one proxy, Caddy, so with a CDN or another proxy in front of Caddy, both would get the client address wrong;
- a clone of this repository at the commit being deployed.

A model run is a separate process that takes about 1 GiB of memory; one run is active at a time. The owner chooses the size of the server; `free -h` and `docker system df` show whether it is enough.

#### Knowledge repository

`gbrain-repo` is a separate git repository with GBrain's knowledge in Markdown. GBrain mounts it as `/brain` and works in it as the user with uid 1000, so the directory is a git repository that uid 1000 can write to. GBrain accepts a repository without committed files (empty, or with nothing but an empty commit) as a source only with `--force` ([§5](#5-gbrain-initial-import)). A remote repository that the owner chooses provides the copy of the knowledge off the machine ([§12](#12-backup-gbrain-repo)); the knowledge belongs to the owner, so that repository is private.

#### Search dictionary

GBrain's keyword search works in the language that `GBRAIN_FTS_LANGUAGE` names ([§2](#2-environment)). Postgres supports arabic, armenian, basque, catalan, danish, dutch, english, finnish, french, german, greek, hindi, hungarian, indonesian, irish, italian, lithuanian, nepali, norwegian, portuguese, romanian, russian, serbian, spanish, swedish, tamil, turkish and yiddish, and such a language needs nothing else.

Another language, such as Ukrainian, Polish or Czech, needs a hunspell dictionary of that language: the files `<name>.dic` and `<name>.aff` as the dictionary comes, and optionally a stop-word list `<name>.stop`, one word per line. They go into [`postgres/dictionaries/`](./postgres/dictionaries), and `GBRAIN_FTS_LANGUAGE` is their name in lowercase: `uk_UA.dic` and `uk_UA.aff` give `uk_ua`. Git does not carry the dictionary. A dictionary comes under its own license, which may limit its use: check it before you install the dictionary. Other files in the directory, such as that license, stay where they are.

### 2. Environment

The environment file is a copy of the template with permissions `0600`; it is kept out of git. On the local machine it is `.env.local`, on the server `.env.prod` (the commands below use `.env.local`):

```bash
cp .env.example .env.local
```

```bash
chmod 600 .env.local
```

Enter the values in an editor: a secret on the command line would end up in the shell history.

**Random secrets.** Each one is a separate output of this command:

```bash
openssl rand -hex 32
```

- `POSTGRES_PASSWORD` is the password of the Postgres superuser; it applies only on the first start with an empty volume;
- `APP_DB_PASSWORD` and `GBRAIN_DB_PASSWORD` are the passwords of the App and GBrain roles. Each is exactly 64 hexadecimal characters: the passwords appear in the database URLs, and `postgres/init.sql` accepts no others;
- `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` is the permanent credential of the GBrain admin UI: sessions for `/admin` are issued with it;
- `APP_ENCRYPTION_KEY` is the encryption key of `connector_credentials`. It is not stored in the table, and losing it means authorizing the connectors again ([§6.3](#63-notion-mcp-grant)); do not change the key after the first grant;
- `TELEGRAM_WEBHOOK_SECRET` is the secret in the Telegram webhook header ([§6.1](#61-telegram-webhook));
- `NOTION_WEBHOOK_SECRET` is a temporary value: the real one comes from the Notion webhook subscription ([§6.2](#62-notion-webhook-subscription)), and the subscription needs a running App, which does not start without this variable.

`APP_OAUTH_OWNER_PASSPHRASE` is the owner passphrase on the chat consent page ([§6.4](#64-app-mcp-and-chat)), at least 32 characters long:

```bash
openssl rand -base64 32
```

**Values from other steps:** `CLAUDE_CODE_OAUTH_TOKEN` ([§2.1](#21-claude-subscription-token)), `NOTION_API_TOKEN` ([§2.2](#22-notion-integration)), `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_ID` ([§2.3](#23-telegram-bot)), `VOYAGE_API_KEY` ([§1](#1-requirements)), `APP_IMAGE` ([§2.4](#24-app-image)), `GBRAIN_CLIENT_ID` and `GBRAIN_CLIENT_SECRET` ([§5](#5-gbrain-initial-import)). Put `VOYAGE_API_KEY` in the file before the first GBrain start: without it the first start turns the reranker off, and `gbrain sync` stops ([§25](#25-troubleshooting)).

**The path to the knowledge repository** is `GBRAIN_REPO_PATH`, absolute or relative. Compose resolves a relative path from `infra/`: `../../gbrain-repo` is the `gbrain-repo` directory next to the clone.

**The search language** is `GBRAIN_FTS_LANGUAGE`: a language Postgres supports or the name of the installation's dictionary ([§1](#search-dictionary)); the template has `english`. Choose it before the first start: it is the configuration of the stored data, and a change afterwards means reindexing ([§19](#19-changing-the-fts-language)).

**What stays as in the template.** `GBRAIN_REF` and `GBRAIN_IMAGE_TAG` are the pinned GBrain baseline, the same for both environments. `REVIEW_*=off`: reviews are turned on one at a time after the first deployment ([§8](#8-runner-and-reviews)). `RUNNER_ENABLED=false` until [§8](#8-runner-and-reviews). The owner's settings (`APP_TIMEZONE`, `APP_LANGUAGE`, `APP_OWNER_GENDER`, `APP_ASSISTANT_NAME`, `APP_ASSISTANT_GENDER`) are described in the template itself. The App picks up a changed value after `./bin/dc up -d app`; change the assistant name together with the names of the integration ([§2.2](#22-notion-integration)) and the bot ([§2.3](#23-telegram-bot)).

#### Addresses

| Variable | Local machine | Server |
|---|---|---|
| `APP_PUBLIC_BASE_URL` | `https://<APP_TUNNEL>` | `https://<APP_DOMAIN>` |
| `APP_MCP_URL` | `https://<APP_TUNNEL>/mcp` | `https://<APP_DOMAIN>/mcp` |
| `GBRAIN_PUBLIC_URL` | `https://<GBRAIN_TUNNEL>`; when empty, `http://localhost:3131` | empty |
| `GBRAIN_MCP_URL` | `https://<GBRAIN_TUNNEL>/mcp` | empty |
| `APP_DOMAIN`, `GBRAIN_DOMAIN`, `ACME_EMAIL` | empty | the names of the App and GBrain and the ACME contact e-mail for Caddy |

- `APP_PUBLIC_BASE_URL` is the URL from which the Telegram and Notion webhook URLs are derived;
- `APP_MCP_URL` is the URL of the App MCP for the chat; the App reads it as the resource and the issuer of its own authorization server;
- `GBRAIN_PUBLIC_URL` is the URL at which an MCP client sees GBrain; GBrain builds its OAuth URLs from it. On the server, `compose.prod.yaml` sets it from `GBRAIN_DOMAIN`;
- `GBRAIN_MCP_URL` is read only by `plugin/.mcp.json` in Claude Code on the local machine.

App runs do not use these URLs: they reach the App MCP over their own container's loopback and GBrain over the Compose network.

On the local machine, two HTTPS tunnels provide the public addresses: one to `127.0.0.1:3000` (the App) and one to `127.0.0.1:3131` (GBrain). `<APP_TUNNEL>` and `<GBRAIN_TUNNEL>` are their host names. With ngrok, each tunnel is a separate command in a separate terminal:

```bash
ngrok http 3000
```

```bash
ngrok http 3131
```

A tunnel that gets a new address on every restart needs [§20](#20-changing-the-public-address) after each restart.

### 2.1. Claude subscription token

An App run authenticates with the owner's own subscription: the token is issued on a machine where `claude` is logged in to the owner's account. The App has no other way to authenticate. The token belongs to the installation owner and is not passed on to others.

```bash
claude setup-token
```

The command opens the browser authorization flow, like `/login`, and prints the token to the terminal without storing it anywhere. The token requires a Pro, Max, Ultra, Team or Enterprise subscription and can only make requests to the model. The token is the value of `CLAUDE_CODE_OAUTH_TOKEN` in the environment file. The token expires after one year ([§22](#22-token-renewal)).

No source confirms that a subscription token is suitable for unattended server runs: the token is documented for Claude Code in CI, while the subscription's terms of use describe ordinary individual use. This is a known risk of the installation, and it is stated before deployment.

### 2.2. Notion integration

The App writes to Notion on behalf of its own internal integration: comments, Tasks created from Inbox items, approved property changes and moves of items to the trash. Notion attributes these writes to the integration bot, and it is by this attribution that the App tells its own writes from the person's edits. The Notion interface calls such an integration a connection.

The Workspace Owner creates it:

1. Developer portal: `https://app.notion.com/developers/connections`.
2. In the sidebar, under Build, open Internal connections.
3. Create a new connection: give it a name and choose a workspace. The name is the assistant name (`APP_ASSISTANT_NAME`) or, when the assistant has no name, “Personal Management System”: Notion shows the system's writes under it, except for comments, which appear under a kind label. Change the name in the integration settings, in the same developer portal.
4. Open the Configuration tab. The Internal Integration Secret is the value of `NOTION_API_TOKEN`. Capabilities are on the same tab:

   - Read content, Update content, Insert content;
   - Read comments, Insert comments;
   - User information without email addresses.

Building the databases ([§3](#3-notion-workspace-and-binding)) also needs a Personal access token for the same workspace: the command uses it to create databases at the top level, which an internal integration cannot do. Developer portal: `https://www.notion.so/developers/tokens` → New token → a name, capability Notion API → Create token. The value is shown once. On the Business and Enterprise plans, creating such tokens is restricted by default: the workspace owner turns it on in Settings → Connections. The token has all of the owner's rights over the workspace, so it exists only while the databases are being built: pass it to the command in the invocation; the App does not receive it.

A new integration has no access to any page. It needs access to each of the eleven databases of the schema, including the reference databases Context, Tags and Trigger; for a workspace of a different shape, to each database that the binding names and to each one its relations point to. There is no programmatic way to do this:

- Developer portal → the integration → the Content access tab → Edit access → select the databases → save; or
- in the database itself: `•••` → Connections → + Add connection → the integration.

The databases appear after the build, so access is opened in [§3](#3-notion-workspace-and-binding).

### 2.3. Telegram bot

Telegram is the delivery channel for notifications, system messages and the person's replies. Without it, reviews are not scheduled, and notifications go to `failed` with the reason “channel telegram is not configured”.

1. In Telegram, open @BotFather and send `/newbot`. BotFather asks for the bot's name and username (5–32 characters: Latin letters, digits, `_`; ends with `bot`; cannot be changed afterwards) and replies with a token; this token is the value of `TELEGRAM_BOT_TOKEN`. The token gives full control of the bot. The `/token` command in BotFather replaces a lost or compromised token.

   The bot's name is the assistant name (`APP_ASSISTANT_NAME`) or, when the assistant has no name, “Personal Management System”: the chat with the bot and its notifications show that name, and `/setname` changes it. The username stays forever, so the assistant name is not needed in it. The profile description (`/setabouttext`, `/setdescription`) should mention Personal Management System: the profile shows whose bot this is.
2. Send your bot any message, for example `/start`: this creates the chat between you and the bot.
3. `getUpdates` returns the id of this chat. Enter the token without echo; it goes to `curl` through stdin, so it lands in neither the shell history nor the process list:

   ```bash
   printf 'Bot token: '; stty -echo; read -r TELEGRAM_TOKEN; stty echo; echo
   ```

   ```bash
   printf 'url = "https://api.telegram.org/bot%s/getUpdates"\n' "$TELEGRAM_TOKEN" | curl -sS --config -
   ```

   The response contains `"chat":{"id":…`; this id is `TELEGRAM_ALLOWED_CHAT_ID` (a personal chat's id is a positive number). `getUpdates` does not work while a webhook is set for the bot; a fresh bot has none. Remove the token from the shell:

   ```bash
   unset TELEGRAM_TOKEN
   ```

`TELEGRAM_WEBHOOK_SECRET` comes from [§2](#2-environment): Telegram accepts a secret of 1–256 characters made up of `A-Z`, `a-z`, `0-9`, `_` and `-`, and a hex string meets this requirement. The webhook is registered in [§6.1](#61-telegram-webhook). A bot has one webhook, and `setWebhook` replaces the existing one, so the local machine and the server use different bots.

Two independent checks guard inbound Telegram: the header secret passed to `setWebhook` and the chat id allowed by `TELEGRAM_ALLOWED_CHAT_ID`. An update from another chat is dropped without a reply.

### 2.4. App image

The App image carries both the App itself and the `notion` command that builds the Notion databases ([§3](#3-notion-workspace-and-binding)), so it is needed before them. Render the Compose config:

```bash
./bin/dc config --quiet
```

The command is silent when the config renders; an error names the variable or file that is missing.

The image comes either from a build from this clone (`personal-management-system-app:local`, when `APP_IMAGE` is empty):

```bash
./bin/dc build app
```

— or from a registry that the owner chooses: `APP_IMAGE` is the full name of the image with a commit tag, and the command pulls the image (after logging in to that registry):

```bash
./bin/dc pull app
```

The image carries the Claude Code CLI, a proprietary Anthropic program, so it is never pushed to a public registry. The image assembles the runner plugin from `app/plugin/` and the knowledge in `plugin/` at its commit, and the Notion workspace schema and the canonical model from `contracts/`, so all of this ships in one release with the App.

### 3. Notion workspace and binding

The App does not know which Notion database is `Task`, which property carries the status and which option id corresponds to `Next Action`. That is the decision of the workspace owner, and the binding records it: the file `infra/notion/mapping.yaml`. It is kept out of git. It is not a secret: it contains only identifiers. Without it, Compose does not start the App.

The `notion` command from the App image writes the binding ([§2.4](#24-app-image)). It works only with the `infra/notion/` directory: `workspace.yaml`, the ledger of built databases (name → data source), and `formulas.md` are written next to the binding. The directory ships with the repository, and uid 1000 can write to it, as to the knowledge repository ([§1](#1-requirements)). The exit code of the command: 0 means done, 1 means the check found discrepancies with the contract, 2 means the command did not complete, and the message says why.

#### Empty workspace

The schema of the system is in [`contracts/notion-workspace.yaml`](../contracts/notion-workspace.yaml): eleven databases with their properties, relations, options and formulas.

1. Make sure `NOTION_API_TOKEN`, the integration token ([§2.2](#22-notion-integration)), is in the environment file.
2. Enter the Personal access token ([§2.2](#22-notion-integration)) into a shell variable without echo:

   ```bash
   printf 'Notion personal token: '; stty -echo; read -r NOTION_PERSONAL_TOKEN; stty echo; echo
   ```

3. The command creates the databases at the top level of the workspace, reads them back, checks them against the contract and writes the binding. The prefix passes the token to this command only:

   ```bash
   NOTION_PERSONAL_TOKEN="$NOTION_PERSONAL_TOKEN" ./bin/dc run --rm notion build
   ```

   The first launch stops here, and that is expected: the databases have just been created, and the integration cannot see them yet. The command lists them and the path Notion → Settings → Connections → the integration → Access ([§2.2](#22-notion-integration)); open these databases to the integration and repeat the command. An interrupted launch resumes when the same command is repeated and does not duplicate databases; the command changes only the databases in its own ledger. The command does not overwrite a binding that belongs to another workspace (key `workspace`) or exists without a ledger: such a file needs to be moved aside.
4. Formulas are optional. REST does not accept formulas that read a related database, so the formula columns are created empty, and their text is in `infra/notion/formulas.md`. The system works without them: formulas give only signals, shortcuts to facts that the model also reads by a longer route. To add them: database → column → Edit property → Formula → paste the text → Save, then repeat the command from step 3: it adds the signals whose formulas have been entered to the binding.
5. Remove the token from the shell:

   ```bash
   unset NOTION_PERSONAL_TOKEN
   ```

#### Check against the contract

```bash
./bin/dc run --rm notion check
```

It only reads, with the integration token. It takes the databases from the existing binding and prints how their schema differs from the contract and which formulas have a different expression; exit code 1 reports that the schema has diverged. Changing the schema means editing the contract, and an existing workspace is brought up to it by hand.

#### Workspace of a different shape

When the databases already exist in a different shape, compose the binding from a template with all the slots of the canonical model:

```bash
./bin/dc run --rm notion template
```

The file appears as `infra/notion/mapping.yaml`; the command does not overwrite an existing binding. Each canonical field gets one of the representation kinds from [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `representation_kinds`:

```yaml
    status:         { kind: native,   propertyId: aGCp }
    project:        { kind: relation, propertyId: o%7B%40c, dataSourceId: 4ab7da3f-...,
                      twoWay: true,   syncedPropertyId: C%5CFR }
    deadline:       { kind: native,   propertyId: PSiv }
    result_or_note: { kind: page_body }
    why_now:        { kind: absent,   reason: no such property }
```

`null` means “not filled in yet” and differs from `absent`: the App treats the first as unfinished work and the second as a declared decision. Sets of option ids are needed only for fields bound as `native`; a sample of the blocks is at the end of the template. `relation` keeps the direction: a write to a one-way link does not create the reverse side, so `twoWay` matches what Notion shows.

The identifiers come from the Notion API: the id of a database's data source is in the `data_sources` array of the response to `GET /v1/databases/<database id>` (the database id is in its URL), and the properties of a data source with their `id` values come from `GET /v1/data_sources/<id>`. Enter the token without echo:

```bash
printf 'Notion token: '; stty -echo; read -r NOTION_TOKEN; stty echo; echo
```

```bash
printf 'url = "https://api.notion.com/v1/data_sources/%s"\nheader = "Authorization: Bearer %s"\nheader = "Notion-Version: %s"\n' "<DATA_SOURCE_ID>" "$NOTION_TOKEN" "$(grep '^NOTION_API_VERSION=' .env.local | cut -d= -f2)" | curl -sS --config -
```

After the last request, remove the token from the shell:

```bash
unset NOTION_TOKEN
```

The App reads the binding once at start and does not start while even one `null` remains; the list of problems is printed in full, with the path to each. To check a filled-in binding, start the App ([§4](#4-startup)).

#### Second machine

The databases of a workspace are built once. A second machine that points at the same workspace (for example, the server after the local machine) receives the `infra/notion/` directory whole: the binding together with the ledger of databases. `notion build` does not overwrite a binding that has no ledger, because otherwise it would create a second set of databases; `notion check` also works with a binding alone.

After the schema changes in Notion, check the binding again: starting the App catches an unfilled slot, but only a check against the live workspace catches a dead id.

### 4. Startup

Before the first start, these must be in place: the environment file ([§2](#2-environment)) with `VOYAGE_API_KEY`, the App image ([§2.4](#24-app-image)), the binding ([§3](#3-notion-workspace-and-binding)), the knowledge repository ([§1](#1-requirements)) and, for a language Postgres does not support, its dictionary ([§1](#search-dictionary)). On the server, the Caddy config must be in place too:

```bash
./bin/dcp run --rm -T --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

**The GBrain image** is built from the pinned `GBRAIN_REF`; `up` builds it automatically when it does not exist yet:

```bash
./bin/dc build gbrain
```

**Start:**

```bash
./bin/dc up -d
```

What happens at the start:

- **Postgres** installs the dictionary from `postgres/dictionaries/` on every start, and on an empty volume runs `postgres/init.sql`: the roles `app_user` and `gbrain_user`, the databases `app_db` and `gbrain_db`, the extensions, the RLS trigger and, for a dictionary language, its search configuration. A language without its dictionary stops `init.sql` before it creates anything ([§25](#gbrain-search-language)). The file is run again by hand ([§13](#13-restore-app_db), [§19](#19-changing-the-fts-language), [§21](#21-changing-database-passwords));
- The **App** applies its migrations (`prisma migrate deploy`) and then starts. Migrations run on every start, so the database is brought up to the image's schema; a failed migration stops the container;
- **GBrain** runs `gbrain init --non-interactive --schema-pack gbrain-base-v2` and then starts the server. `init` is safe to repeat: it creates only what is missing and leaves choices already made untouched. The embedding model and the vector width for every GBrain process are set by `GBRAIN_EMBEDDING_MODEL` and `GBRAIN_EMBEDDING_DIMENSIONS` (by default `voyage:voyage-4` and 1024); the reranker is `voyage:rerank-2.5` by default, on the same Voyage key;
- **`gbrain-maintenance`** runs the `purge` phase once every six hours: it permanently deletes what was soft-deleted and whose recovery window (72 hours) has passed, and removes stale service records. It calls no models and synthesizes nothing;
- **Caddy** (server only) obtains certificates for both names.

`up` does not start the `gate` service: `bin/gate` starts it ([`GATE.md`](GATE.md)).

Status:

```bash
./bin/dc ps
```

In the output, `postgres`, `app` and `gbrain` are `healthy`. If the App did not come up, its log names every environment variable that failed validation, in one list, and a failed migration appears in the log as well ([§25](#25-troubleshooting)):

```bash
./bin/dc logs app
```

The Notion webhook subscription ([§6.2](#62-notion-webhook-subscription)) needs a provisioning window; the first start can already open it, with `NOTION_WEBHOOK_AWAITING_VERIFICATION=true` in the environment file.

### 5. GBrain initial import

Three one-time commands after the first `up`; they run again only after a rebuild ([§15](#15-full-gbrain-rebuild-from-markdown)).

First, check that the knowledge repository is mounted for reading and writing:

```bash
./bin/dc exec gbrain sh -c 'id && test -r /brain && test -w /brain && echo "brain mount: rw OK"'
```

Expected: uid 1000 and `brain mount: rw OK`.

1. Register the mounted `/brain` as the source `default`:

   ```bash
   ./bin/dc exec gbrain gbrain sources add default --path /brain
   ```

   The command accepts a repository without committed files (empty, or with nothing but an empty commit) only with `--force` at the end; without it, the command refuses with `is not a git repository with committed, tracked files`. GBrain does not see files that are in the directory but not committed: commit them first. A second `sources add` refuses: the source is already registered.
2. Import the knowledge. Without `VOYAGE_API_KEY`, the command stops with `requires VOYAGE_API_KEY`:

   ```bash
   ./bin/dc exec gbrain gbrain sync
   ```

3. Register the App's client in GBrain:

   ```bash
   ./bin/dc exec gbrain gbrain auth register-client app --grant-types client_credentials --scopes "read write" --source default --federated-read default
   ```

   The command prints the lines `Client ID:` and `Client Secret:`; the secret is shown only once. These are the `GBRAIN_CLIENT_ID` and `GBRAIN_CLIENT_SECRET` values in the environment file. Each launch issues a **new** client. Recreate the container for the App to pick the values up:

   ```bash
   ./bin/dc up -d app
   ```

Optionally, check GBrain's models and reranker:

```bash
./bin/dc exec gbrain gbrain models doctor
```

### 6. External registrations

Providers tie registrations to an address: each of them is repeated when the address changes ([§20](#20-changing-the-public-address)).

### 6.1. Telegram webhook

`<TELEGRAM_BOT_TOKEN>`, `<APP_PUBLIC_BASE_URL>` and `<TELEGRAM_WEBHOOK_SECRET>` are values from the environment file:

```bash
curl -sS "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" -H 'content-type: application/json' -d '{"url":"<APP_PUBLIC_BASE_URL>/webhooks/telegram","secret_token":"<TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message","callback_query"]}'
```

Check that `url` in the response equals `<APP_PUBLIC_BASE_URL>/webhooks/telegram`. An empty `url` deletes the webhook, and Telegram still answers `ok`, so only this response verifies it:

```bash
curl -sS "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Check that a message gets through: send the bot any text. The bot answers with a system message that these words will not land anywhere (in the language of `APP_LANGUAGE`), and a delivery appears in the intake log:

```bash
./bin/dc exec -T postgres psql -U postgres -d app_db -c "SELECT source, event_type, status, received_at FROM webhook_receipts WHERE source = 'telegram' ORDER BY received_at DESC LIMIT 5"
```

If the bot is silent, look at `./bin/dc logs app` and check whether `TELEGRAM_ALLOWED_CHAT_ID` matches the chat the message was sent from.

### 6.2. Notion webhook subscription

A webhook subscription is created only in the integration's interface; there is no API for it. The real `NOTION_WEBHOOK_SECRET` is the `verification_token` that Notion sends when the subscription is created; until then, Notion deliveries are rejected with `401`. Outside the provisioning window the endpoint accepts nothing unsigned, so the handshake would not get through — the window opens before the address is set in Notion.

1. Set this in the environment file:

   ```dotenv
   NOTION_WEBHOOK_AWAITING_VERIFICATION=true
   ```

   Then restart the App:

   ```bash
   ./bin/dc up -d app
   ```

2. Developer portal (`https://app.notion.com/developers/connections`) → Internal connections → the integration ([§2.2](#22-notion-integration)) → the Webhooks tab → + Create a subscription. The Webhook URL is `<APP_PUBLIC_BASE_URL>/webhooks/notion`. The event types are exactly the ones the App handles:

   ```text
   page.created
   page.content_updated
   page.properties_updated
   page.deleted
   comment.created
   comment.updated
   ```

   The `comment.*` events require the Read comments permission. Then Create subscription.
3. Notion sends the `verification_token` to the endpoint. The App writes it to tmpfs and logs only the path. Read the value:

   ```bash
   ./bin/dc exec app cat /run/app/verification_token
   ```

   On the Webhooks tab, choose Verify, paste the value and choose Verify subscription. If the token has not arrived, use Resend token in the verification window.
4. Put the same value into `NOTION_WEBHOOK_SECRET` in the environment file and close the window:

   ```dotenv
   NOTION_WEBHOOK_AWAITING_VERIFICATION=false
   ```

   Restart the App; the restart also erases the file with the token:

   ```bash
   ./bin/dc up -d app
   ```

The check: change a property of a page in a database that is open to the integration, and a delivery appears in the intake log (Notion combines events of the same type, so it appears with a delay):

```bash
./bin/dc exec -T postgres psql -U postgres -d app_db -c "SELECT source, event_type, status, received_at FROM webhook_receipts ORDER BY received_at DESC LIMIT 5"
```

The subscription is needed once, and again after `APP_PUBLIC_BASE_URL` changes. A new subscription changes the signing secret.

### 6.3. Notion MCP grant

App runs reach the Notion MCP with an OAuth grant, separate from the REST integration. The grant is stored in `app_db`, encrypted with `APP_ENCRYPTION_KEY`, and lives as long as it is refreshed: it expires after thirty days without a refresh or one hundred and eighty days after authorization. The App refreshes it itself, in runs and in the keepalive. Each environment has its own grant: the very first refresh in one database would revoke the refresh token of the other.

Authorization is a command in the App image. It registers a client, prints a link to the Notion consent page and waits for the address the browser returns to. On the server, it runs in an ssh session with a terminal.

```bash
./bin/dc run --rm app node dist/src/credentials/notion-mcp/authorize-notion-mcp.js
```

1. Open the link in a browser where you are logged in to Notion (on any machine) and consent. The client is named per installation (`NOTION_MCP_CLIENT_NAME`, by default “Personal Management System”): this name is visible on the consent page and among the workspace's connections.
2. The browser goes to `http://localhost:8765/callback?code=…&state=…` and shows a connection error. That is expected: nothing is listening there, and no public address is needed for this.
3. Copy the full address from the browser's address bar and paste it into the terminal.

The command checks `state`, exchanges the code for tokens with the PKCE verifier, which it kept only in memory, and writes the grant. A ceiling of 180 days counts from the time of authorization; reauthorization is the same command, and two weeks before the ceiling the App warns about it in the log.

Show the status without secrets: when the grant was authorized, when it was last refreshed and how much time remains until each limit:

```bash
./bin/dc run --rm app node dist/src/credentials/notion-mcp/authorize-notion-mcp.js --status
```

To check that refreshing works, refresh immediately, the same way the App does it, under a row lock; the command prints the new expiry, without the token:

```bash
./bin/dc run --rm app node dist/src/credentials/notion-mcp/authorize-notion-mcp.js --refresh
```

A refresh rotates the refresh token, so do not repeat it needlessly. A working REST integration does not prove a live Notion MCP grant. No Notion MCP secret goes into `gbrain-repo`.

### 6.4. App MCP and chat

**App runs** need no configuration: the App itself issues a bearer for each run and forgets it along with the run. A request without a valid bearer gets `401`. With OAuth for chat configured (below), the `WWW-Authenticate` header carries `resource_metadata`, the address `/.well-known/oauth-protected-resource/mcp` at the origin of `APP_MCP_URL`; without it the header is a bare `Bearer`:

```bash
curl -s -i -X POST <APP_PUBLIC_BASE_URL>/mcp
```

**Chat** connects through OAuth, which the App itself issues to the installation owner. Both variables are required: `APP_OAUTH_OWNER_PASSPHRASE` and `APP_MCP_URL` ([§2](#2-environment)). Without the passphrase the OAuth routes answer `404` and `/mcp` stays available to runs only; with the passphrase but without `APP_MCP_URL`, the App does not start. A non-loopback address must be `https`. Fetch the metadata:

```bash
curl -fsS <APP_PUBLIC_BASE_URL>/.well-known/oauth-protected-resource/mcp
```

```bash
curl -fsS <APP_PUBLIC_BASE_URL>/.well-known/oauth-authorization-server
```

The first response has `resource` set to exactly `APP_MCP_URL`; the second has `registration_endpoint`, `authorization_endpoint`, `token_endpoint` and `code_challenge_methods_supported: ["S256"]`.

The client (Claude Code, claude.ai, Desktop) registers itself, opens the App's consent page and asks for the owner passphrase:

- return addresses are accepted only from an allowlist: the claude.ai and claude.com callbacks and the loopback addresses of clients such as Claude Code;
- after five wrong passphrases in a row the page locks for half a minute, and the lockout duration then doubles, up to a quarter of an hour;
- a Telegram message tells the owner about each consent (the client and the return host). If it was not you who connected, change the passphrase and revoke the tokens;
- the access token lives for an hour, the refresh token for ninety days, and it is rotated; a refresh token presented a second time revokes the whole family of tokens. Tokens are stored in `app_db` only as digests;
- the token's audience is `APP_MCP_URL`: the endpoint does not accept a token issued for another address;
- changing the passphrase does not revoke tokens already issued. Revoke them all:

```bash
./bin/dc exec postgres psql -U postgres -d app_db -c "UPDATE oauth_tokens SET revoked_at = now() WHERE revoked_at IS NULL"
```

**Connectors and the plugin** are connected once per Claude account, on the claude.ai page for managing plugins and connectors. The addresses must be public HTTPS, reachable from Anthropic's egress addresses.

1. **App.** Choose Connectors → Add custom connector and enter the address `APP_MCP_URL`. The App's consent page asks for `APP_OAUTH_OWNER_PASSPHRASE`; a message about the connection appears in Telegram.
2. **GBrain.** The connector works with its own GBrain client, with the `default` source. This command issues the client:

   ```bash
   ./bin/dc exec -T gbrain gbrain auth register-client chat --redirect-uri https://claude.ai/api/mcp/auth_callback --scopes "read write" --source default --federated-read default
   ```

   Choose Add custom connector and enter the address `<GBRAIN_PUBLIC_URL>/mcp` (on the server, `https://<GBRAIN_DOMAIN>/mcp`); in Advanced settings, enter the Client ID and Client Secret that the command issued.
3. **Marketplace.** The marketplace is a private GitHub repository with one file, `.claude-plugin/marketplace.json`, a copy of the template [`marketplace.example.json`](./marketplace.example.json). The entry points to the `plugin/` directory of the project's public repository and serves as the plugin's manifest. In the copy, replace `<OWNER>` with the GitHub account from [§1](#1-requirements) that owns both the marketplace and the project repository, `<APP_DOMAIN>` and `<GBRAIN_DOMAIN>` with the addresses of this installation's App and GBrain, and `<COMMIT_SHA>` with the full SHA of the commit that runs in the installation and is pushed to the project's public repository. `git rev-parse HEAD` prints it in the clone. The installation's addresses live only here and in the account's connectors.
4. **Plugin.** Add the private repository as a marketplace, give the Claude GitHub App access to it, enable the `personal-management-system` plugin and connect Notion on its Connectors tab. Do not add a GBrain row there: authentication settings cannot be changed after the row is added, and step 2 created the GBrain connector.

After this the plugin works in chat on the web, in Desktop and on the phone. The account's connectors provide the tools, and the marketplace entry shows them on the plugin's tab. Claude Code signed in through claude.ai loads the plugin itself, as `personal-management-system@synced`, and the account's connectors reach it as well (`claude mcp list`). A session with an API key or `CLAUDE_CODE_OAUTH_TOKEN` gets neither the plugin nor the connectors.

### 7. Verification

Below, `<APP_PUBLIC_BASE_URL>` and `<GBRAIN_PUBLIC_URL>` are the public addresses of the App and GBrain ([§2](#2-environment)); on the server the GBrain address is `https://<GBRAIN_DOMAIN>`.

```bash
./bin/dc ps
```

**Health.** On the local machine:

```bash
curl -fsS http://localhost:3000/health
```

```bash
curl -fsS http://localhost:3131/health
```

On the server, check the App's health from inside the container: from outside, `APP_DOMAIN` serves only the webhooks, `/mcp`, the OAuth metadata and `/oauth/*`, and Caddy blocks the rest with `404`:

```bash
./bin/dcp exec app curl -fsS http://127.0.0.1:3000/health
```

```bash
curl -fsS https://<GBRAIN_DOMAIN>/health
```

**GBrain.** Check its state, models, search modes and the volume of knowledge:

```bash
./bin/dc exec gbrain gbrain doctor
```

```bash
./bin/dc exec gbrain gbrain models doctor
```

```bash
./bin/dc exec gbrain gbrain search modes
```

```bash
./bin/dc exec gbrain gbrain stats
```

**Search language.** `<LANGUAGE>` is the value of `GBRAIN_FTS_LANGUAGE`, and `<TEXT>` is two forms of one word in that language, such as `running runs` in English. Both forms give one lexeme, the base form of the word:

```bash
./bin/dc exec -T postgres psql -U postgres -d gbrain_db -Atc "SELECT to_tsvector('<LANGUAGE>', '<TEXT>')"
```

For a dictionary language, the log of the start names the installed files:

```bash
./bin/dc logs postgres | grep install-dictionaries
```

**Notion integration.** At startup the App asks Notion who it is and writes the answer to the log:

```bash
./bin/dc logs app | grep 'integration bot identified'
```

Without this line the App writes nothing to Notion: not knowing who it is, it cannot check that a write is attributed to the bot. If the line is missing, check `NOTION_API_TOKEN`, the integration's permissions and its access to all eleven databases ([§2.2](#22-notion-integration)).

**App MCP** rejects an unauthenticated request from outside with `401`, not `200`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' <APP_PUBLIC_BASE_URL>/mcp
```

**GBrain MCP.** The chat client finds GBrain by the `WWW-Authenticate` header of the `401` response:

```bash
curl -s -i -X POST <GBRAIN_PUBLIC_URL>/mcp
```

The `resource_metadata` address in this header answers `200` with JSON; on the server, `404` means Caddy does not let it through (the `@claude` matcher in `caddy/Caddyfile`). The authorization server metadata names the host of `GBRAIN_PUBLIC_URL`:

```bash
curl -fsS <GBRAIN_PUBLIC_URL>/.well-known/oauth-authorization-server
```

On the server, outside the declared GBrain surface, Caddy answers `404`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<GBRAIN_DOMAIN>/metrics
```

The GBrain admin UI is at `<GBRAIN_PUBLIC_URL>/admin` (on the local machine, `http://localhost:3131/admin`).

**Network.** Local machine:

```text
127.0.0.1:3000   -> app
127.0.0.1:3131   -> gbrain
postgres:5432    -> the Compose network only
127.0.0.1:55432  -> ephemeral test database, outside the stack (ops/test-db.sh)
```

From outside, the server answers on `80` and `443`, while `3000`, `3131` and `5432` are closed. From another machine (`<SERVER_IP>` is the server's address), checking a closed port ends in a connection error:

```bash
curl -sS -m 5 -o /dev/null http://<SERVER_IP>:3000/health
```

**Chat:** the Personal Management System plugin is loaded, the Skill is visible, and the App, Notion and GBrain connectors are available ([§6.4](#64-app-mcp-and-chat)). An external MCP client with its own GBrain client reads GBrain independently of the App.

**The run path** — requests to the model, the plugin from the image, the App MCP, the Notion MCP and the GBrain MCP, and the system's write to Notion as the bot — is proven by the gate on the local machine ([`GATE.md`](GATE.md#gate-m3)) and by the first run after the runner is enabled in an installation ([§8](#8-runner-and-reviews)). The approval path: the run's proposal carries the page, the property and the value; the person's decision is recorded; the executor checks the preconditions and writes the change as the integration bot; Notion shows the change as made by the integration, and the App drops its echo as its own.

### 8. Runner and reviews

The runner turns evaluation windows for changes, due continuations, Inbox items and channel messages into real model runs under the Skill. **Runs share the Claude subscription limit with the owner's interactive work**, so enable the runner deliberately, after the verification in [§7](#7-verification). A disabled runner starts no runs, and origin rows wait in the queues without using attempts.

To start with `RUNNER_ENABLED=true`, the environment file has `CLAUDE_CODE_OAUTH_TOKEN`, `GBRAIN_CLIENT_ID` and `GBRAIN_CLIENT_SECRET` set; without them the App does not start and names what is missing. Without a valid Notion MCP grant ([§6.3](#63-notion-mcp-grant)) a run does not start: the runner names the reason, and origin rows lose no attempts.

```dotenv
RUNNER_ENABLED=true
```

```bash
./bin/dc up -d app
```

With the runner enabled, the App itself conducts scheduled reviews, runs the periodic safety sweep once an hour and runs the reconciliation of resolved threads every 20 minutes.

First run: create an item in the Inbox database and look at the run trace after the evaluation window. A run with status `completed` and a system comment on the page attributed to the integration bot prove the whole chain:

```bash
./bin/dc exec -T postgres psql -U postgres -d app_db -c "SELECT mode, origin_kind, status, reason, created_at FROM run_traces ORDER BY created_at DESC LIMIT 5"
```

**Reviews.** The App reads the schedules (`REVIEW_*`; the grammar is in `.env.example`) at startup: to enable or change a review, set the variable and restart the App (`./bin/dc up -d app`). `off` disables a review; an empty value means the default schedule, that is, the review is enabled. Without a delivery channel reviews are not scheduled; the App tells the person in the channel about a review that did not take place (`INV-105`), and the review can be initiated in Claude chat.

The producer immediately schedules the current occurrence of every enabled review whose window is still open, so reviews enabled together in the middle of a period run almost simultaneously: several packets within an hour on one Notion MCP query allowance. So enable them one at a time, each right after its scheduled time, so that the first one runs separately and at its scheduled time:

1. `REVIEW_DAILY_CONTROL`: set it to an empty value on any day, after 08:30; the first Daily Control runs within a minute.
2. `REVIEW_WEEKLY_CONTROL`: set it to an empty value on Sunday, after 18:00.
3. `REVIEW_STRATEGIC`: set it to an empty value on the first day of the month, after 10:00.

`REVIEW_DEEP` stays `off` until the owner wants a Deep Review. The run trace shows what the queries against the allowance were used for.

---

## Part II. Operations

### 9. Backup matrix

| Artifact | Role | Backup |
|---|---|---|
| clone of `personal-management-system` | infrastructure and config | Git |
| environment file (`.env.prod`, `.env.local`) | the secrets that unlock the rest | encrypted copy off the machine, outside Git |
| `infra/notion/` | binding to the workspace and the ledger of built databases | a copy together with the environment file |
| `infra/postgres/dictionaries/` | the search dictionary, which the search vectors and the `gbrain_db` dump depend on | a copy together with the environment file |
| `gbrain-repo` | canonical knowledge | Git + encrypted copy of the file system |
| `app_db` | technical and runtime state of the App | regular `pg_dump` |
| `gbrain_db` | derived data, runtime state and facts not attached to a page | the dump is required: facts with no entity live only here and cannot be restored from Markdown |
| `gbrain_home` | config of the GBrain file plane | encrypted archive, paired with the `gbrain_db` dump |
| Caddy state | TLS | optional: it recovers automatically |

The environment file holds the secrets: `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `GBRAIN_DB_PASSWORD`, `GBRAIN_ADMIN_BOOTSTRAP_TOKEN`, `APP_ENCRYPTION_KEY`, `APP_OAUTH_OWNER_PASSPHRASE`, `CLAUDE_CODE_OAUTH_TOKEN`, `NOTION_API_TOKEN`, `NOTION_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GBRAIN_CLIENT_SECRET` and `VOYAGE_API_KEY`. The dumps can be restored with a new file as well: `postgres/init.sql` sets the role passwords from the current environment. Without a copy of the file, `APP_ENCRYPTION_KEY` is lost, and with it `connector_credentials`: the Notion MCP grant is issued again ([§6.3](#63-notion-mcp-grant)). The other secrets are issued again by their own steps ([§2](#2-environment)); new webhook secrets mean a new Telegram webhook ([§6.1](#61-telegram-webhook)) and a new Notion webhook subscription ([§6.2](#62-notion-webhook-subscription)), and a new `GBRAIN_CLIENT_SECRET` means a new App client in GBrain ([§5](#5-gbrain-initial-import)). Make the first copy right after deployment.

Off-machine copies are kept under a separate contract for retention, encryption and the recovery key. The baseline RPO:

```text
app_db:          <= 24h
gbrain-repo FS:  <= 24h
gbrain_db:       <= 24h
infra/code:      Git
```

The commands below write files to the current `infra/` directory; they do not end up in git.

### 10. Backup `app_db`

```bash
./bin/dc exec -T postgres pg_dump -U postgres --format=custom app_db > app_db.dump.new
```

Read the dump back:

```bash
./bin/dc exec -T postgres pg_restore --list < app_db.dump.new > /dev/null
```

Only then replace the current dump:

```bash
mv app_db.dump.new app_db.dump
```

### 11. Backup `gbrain_db`

```bash
./bin/dc exec -T postgres pg_dump -U postgres --format=custom gbrain_db > gbrain_db.dump.new
```

```bash
./bin/dc exec -T postgres pg_restore --list < gbrain_db.dump.new > /dev/null
```

```bash
mv gbrain_db.dump.new gbrain_db.dump
```

The dump keeps the OAuth state, the runtime and operator state, checkpoints, logs and audit, state that lives only in the database, and facts written with no `entity` or with an `entity` that is not among the pages: such facts do not reach the page files.

### 11.1. Backup and restore `gbrain_home`

`gbrain_home` is the volume mounted at `/data/home`; `GBRAIN_HOME=/data/home/.gbrain` lives in it, with the embedding config. A `gbrain_db` dump is incomplete without it: restore both, taken at the same time ([§14](#14-restore-dump-gbrain_db)).

`gbrain-maintenance` mounts the same volume and directory and holds a connection to `gbrain_db`, so in every step that stops `gbrain`, `gbrain-maintenance` is stopped and started together with `gbrain`: `up -d gbrain` does not recreate it.

Back up `gbrain_home` right after [§11](#11-backup-gbrain_db), while the service is at rest:

```bash
./bin/dc run --rm --no-deps -T gbrain tar -C /data/home -cf - . > gbrain_home.tar.new
```

```bash
tar -tf gbrain_home.tar.new > /dev/null
```

```bash
mv gbrain_home.tar.new gbrain_home.tar
```

Restore `gbrain_home` only as a pair with the `gbrain_db` dump, inside [§14](#14-restore-dump-gbrain_db): with the service stopped, into an empty volume:

```bash
./bin/dc stop gbrain gbrain-maintenance
```

```bash
./bin/dc run --rm --no-deps -T gbrain sh -c 'rm -rf /data/home/* /data/home/.[!.]* && tar -C /data/home -xf -' < gbrain_home.tar
```

[§14](#14-restore-dump-gbrain_db) starts `gbrain` and `gbrain-maintenance` after both restores.

The archive contains file-plane secrets, so store it encrypted together with the dumps.

### 12. Backup `gbrain-repo`

GBrain writes pages, timeline events and facts about pages into the files of the knowledge repository, but does not commit. Uncommitted content stays in the working tree and ends up only in the file-system copy, so take a snapshot with a commit at least once a day: that is the RPO limit for knowledge. Git keeps the reviewed snapshots, and the encrypted file-system copy keeps the full state, including what Git ignores.

Run the commands as a user with write access to the repository; `<GBRAIN_REPO>` is its directory (`GBRAIN_REPO_PATH`). See what has changed:

```bash
git -C <GBRAIN_REPO> status
```

```bash
git -C <GBRAIN_REPO> diff
```

Once the changes are reviewed:

```bash
git -C <GBRAIN_REPO> add <reviewed paths>
```

```bash
git -C <GBRAIN_REPO> commit -m "Brain snapshot"
```

The off-machine copy goes to the owner's remote repository:

```bash
git -C <GBRAIN_REPO> push
```

### 13. Restore `app_db`

Stop the App first: at startup it applies migrations, and a running App would migrate a half-restored or empty database.

```bash
./bin/dc stop app
```

Close the connections to the database:

```bash
./bin/dc exec -T postgres psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'app_db' AND pid <> pg_backend_pid();"
```

Read the dump back before destroying the database:

```bash
./bin/dc exec -T postgres pg_restore --list < app_db.dump > /dev/null
```

Recreate the database:

```bash
./bin/dc exec -T postgres dropdb -U postgres --if-exists app_db
```

```bash
./bin/dc exec -T postgres createdb -U postgres -O app_user app_db
```

Restore the dump:

```bash
./bin/dc exec -T postgres pg_restore -U postgres --exit-on-error --dbname=app_db < app_db.dump
```

Run `postgres/init.sql`, which restores the connection privileges and the role passwords from the environment file; running it again is safe:

```bash
./bin/dc exec postgres psql -U postgres -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql
```

Check that the restored database carries the dump's latest migrations:

```bash
./bin/dc exec -T postgres psql -U postgres -d app_db -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3"
```

Only after that check, start the App: it applies the migrations of its image that the dump does not have yet:

```bash
./bin/dc up -d app
```

A new volume (a lost cluster): start only Postgres with `./bin/dc up -d postgres`, and it runs `init.sql` automatically; the App does not start until the database is restored. Then follow the same steps, from the dump check.

### 14. Restore dump `gbrain_db`

The `gbrain_db` dump and the embedding config in `gbrain_home` are a compatible pair: the vectors in the dump belong to the model and dimension recorded in the config. So both are restored from the same point in time. Vectors of one model do not combine with the config of another.

A dump taken with a dictionary language carries the dictionary's search objects, and `pg_restore` stops on them while the dictionary is not installed. On a new machine, put the copy of `postgres/dictionaries/` in place ([§9](#9-backup-matrix)) and recreate Postgres with `./bin/dc up -d --force-recreate postgres` before the restore.

Read the dump back:

```bash
./bin/dc exec -T postgres pg_restore --list < gbrain_db.dump > /dev/null
```

Stop the service and close the connections:

```bash
./bin/dc stop gbrain gbrain-maintenance
```

```bash
./bin/dc exec -T postgres psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'gbrain_db' AND pid <> pg_backend_pid();"
```

Recreate the database empty, without extensions: the dump itself carries them:

```bash
./bin/dc exec -T postgres dropdb -U postgres --if-exists gbrain_db
```

```bash
./bin/dc exec -T postgres createdb -U postgres -O gbrain_user gbrain_db
```

```bash
./bin/dc exec -T postgres pg_restore -U postgres --exit-on-error --dbname=gbrain_db < gbrain_db.dump
```

Run `postgres/init.sql` **after** the restore. The dump itself, taken as the superuser, carries the extensions, the function and the RLS trigger, and the file restores what the dump lacks: the `CONNECT` privilege on the database, the role passwords from the current environment file and `BYPASSRLS` for the role `gbrain_user`:

```bash
./bin/dc exec postgres psql -U postgres -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql
```

For the paired `gbrain_home`, see [§11.1](#111-backup-and-restore-gbrain_home). Then start the service:

```bash
./bin/dc up -d gbrain gbrain-maintenance
```

```bash
./bin/dc exec gbrain gbrain models doctor
```

```bash
./bin/dc exec gbrain gbrain stats
```

`models doctor` is the check of the pair: it compares the model and dimension of the config with what is in the database. If the model is unknown or the pair has diverged, the dump is not restored, and knowledge is rebuilt from Markdown ([§15](#15-full-gbrain-rebuild-from-markdown)).

### 15. Full GBrain rebuild from Markdown

Knowledge is restored from `gbrain-repo` when `gbrain_db` is lost.

**This step is destructive and irreversible.** It destroys the state that is not in `gbrain-repo`: OAuth clients and tokens, checkpoints, audit and facts not attached to a page. If the database can still be read, back it up first ([§11](#11-backup-gbrain_db)).

```bash
./bin/dc stop gbrain gbrain-maintenance
```

```bash
./bin/dc exec -T postgres psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'gbrain_db' AND pid <> pg_backend_pid();"
```

```bash
./bin/dc exec -T postgres dropdb -U postgres --if-exists gbrain_db
```

Run `postgres/init.sql`, which creates the database with the owner `gbrain_user`, the extensions `vector`, `pg_trgm`, `pgcrypto`, the pair `auto_enable_rls()` + `auto_rls_on_create_table` and, for a dictionary language, its search configuration; without the trigger or the configuration the GBrain migrations fail ([§25](#25-troubleshooting)):

```bash
./bin/dc exec postgres psql -U postgres -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql
```

Start GBrain: it runs `init` on the empty database:

```bash
./bin/dc up -d gbrain gbrain-maintenance
```

Then run the three commands of [§5](#5-gbrain-initial-import): the `default` source (the registry of sources lives in the database), `sync` and a new App client with the new `GBRAIN_CLIENT_ID` / `GBRAIN_CLIENT_SECRET` in the environment file and `./bin/dc up -d app`.

`gbrain sync` reads only what is committed. When `gbrain-repo` has uncommitted changes (a restored file-system copy, writes after the last snapshot), `sync` reports how many files were not imported and deletes nothing. Import the current state of the tree:

```bash
./bin/dc exec gbrain gbrain sync --working-tree
```

Only restoring the dump brings back facts not attached to a page ([§14](#14-restore-dump-gbrain_db)): they are not in Markdown. The clients of external MCP consumers are issued again: the chat connector `chat` ([§6.4](#64-app-mcp-and-chat)) and, on the local machine, the source and client of the gate environment ([`GATE.md`](GATE.md#gate-environment)). The embedding model is the one the environment sets ([§18](#18-changing-the-embedding-model)).

### 16. Upgrading the App

App migrations are applied at startup, so **back up `app_db` before every App upgrade** ([§10](#10-backup-app_db)).

The Compose and Caddy files come from the repository, so upgrade the clone first:

```bash
git pull --ff-only
```

Build the image from the updated clone:

```bash
./bin/dc build app
```

— or set a new tag in `APP_IMAGE` and pull:

```bash
./bin/dc pull app
```

Start the App. `up -d` without a service name recreates `app` with the new image, and the App applies the new migrations before it starts working; changes to Compose are picked up at the same time:

```bash
./bin/dc up -d
```

```bash
./bin/dc ps app
```

If `caddy/Caddyfile` changed, restart Caddy, which reads the file only at startup:

```bash
./bin/dcp restart caddy
```

If `contracts/notion-workspace.yaml` changed, bring the workspace up to the new schema by hand; the check against the contract shows what has fallen behind ([§3](#3-notion-workspace-and-binding)):

```bash
./bin/dc run --rm notion check
```

**Rollback.** The previous image is a tag in `APP_IMAGE` or a build from the previous commit. If the upgrade applied a migration, the previous image does not know the new schema, so a rollback means running the previous image and also restoring `app_db` from the copy taken before the upgrade ([§13](#13-restore-app_db)). A migration that drops or moves columns says so in its rationale comment at the top of the file.

#### Release order

Both plugins come from one commit: the App image contains the runner plugin, and the marketplace entry pins the `sha` of the chat plugin. The chat plugin is updated only when the marketplace pins a new `sha`, so the App is upgraded first and the `sha` follows:

1. Run the installation on the new commit: upgrade the clone and the image and start the App, as in the steps above.
2. In the installation's marketplace, change the `sha` to this commit ([§6.4](#64-app-mcp-and-chat)) and push.
3. On claude.ai, choose Check for updates in the marketplace, then Update in the plugin.

The chat does not get ahead of the App. A chat rollback means the previous `sha` in the marketplace, and the `sha` is rolled back together with the image.

### 17. Upgrading GBrain

The installed baseline is `GBRAIN_REF` and `GBRAIN_IMAGE_TAG` in the environment template. A new version is checked on the local machine first and then goes to the server.

### 17.1. Record the baseline

Before the upgrade, record the output of each of the commands `gbrain doctor --json`, `gbrain models`, `gbrain models doctor`, `gbrain search modes`, `gbrain migrate embeddings --status --json` and `gbrain stats`, each as `./bin/dc exec gbrain <command>`, for example:

```bash
./bin/dc exec gbrain gbrain doctor --json
```

Representative retrieval set: an exact entity; a decision or a project; timeline and date; a semantic paraphrase; Ukrainian; English; mixed Ukrainian and English.

### 17.2. Backup and stop

```bash
./bin/dc stop app gbrain gbrain-maintenance
```

Next come the file-system copy of `gbrain-repo`, [§10](#10-backup-app_db), [§11](#11-backup-gbrain_db), [§11.1](#111-backup-and-restore-gbrain_home) and the check of the off-machine copy. Copy `gbrain-repo` with GBrain stopped; the dumps are consistent on a live database as well.

### 17.3. Image

Set the target `GBRAIN_REF` and `GBRAIN_IMAGE_TAG` in the environment file. Build the image and check the version:

```bash
./bin/dc build --no-cache gbrain
```

```bash
./bin/dc run --rm gbrain gbrain --version
```

### 17.4. GBrain migrations

See what will be applied:

```bash
./bin/dc run --rm gbrain gbrain apply-migrations --list --require-db
```

```bash
./bin/dc run --rm gbrain gbrain apply-migrations --dry-run --require-db
```

Apply the migrations:

```bash
./bin/dc run --rm gbrain gbrain apply-migrations --yes --non-interactive --require-db
```

The step is accepted when `--list` shows no pending, partial or wedged migrations.

### 17.5. Start and check

Start GBrain: it runs the `init` of the new version and starts the server:

```bash
./bin/dc up -d --force-recreate gbrain gbrain-maintenance
```

Next come the commands of [§17.1](#171-record-the-baseline) and their comparison with the baseline, `gbrain sync` and the same retrieval set. The upgrade is accepted when health and the models are fine; the retrieval set passes; the App obtains a GBrain token and makes a model request; the plugin from the App image loads; Claude reads and writes through the public GBrain MCP; an external MCP client has access. Then start the App:

```bash
./bin/dc up -d app
```

### 18. Changing the embedding model

The model and the dimension of the vectors are the configuration of the stored data. `GBRAIN_EMBEDDING_MODEL` and `GBRAIN_EMBEDDING_DIMENSIONS` in the environment file set them for every GBrain process (by default `voyage:voyage-4` and `1024`), and the GBrain embedding migration refuses while the environment names a different model. So changing the model means these two variables together with the migration. `<MODEL>` and `<DIM>` are the target model and dimension (the baseline is `voyage:voyage-4` and `1024`).

Check the current state:

```bash
./bin/dc run --rm gbrain gbrain migrate embeddings --status --json
```

1. Back up and stop: [§17.2](#172-backup-and-stop).
2. In the environment file, set:

   ```dotenv
   GBRAIN_EMBEDDING_MODEL=<MODEL>
   GBRAIN_EMBEDDING_DIMENSIONS=<DIM>
   ```
3. Show the plan:

   ```bash
   ./bin/dc run --rm gbrain gbrain migrate embeddings --to <MODEL> --dim <DIM> --reranker auto --dry-run
   ```

4. Once the plan is reviewed:

   ```bash
   ./bin/dc run --rm gbrain gbrain migrate embeddings --to <MODEL> --dim <DIM> --reranker auto --yes
   ```

5. Start and check: [§17.5](#175-start-and-check); `models doctor` names the new model.

Dumps of `gbrain_db` taken before the change are restored only together with the values that `GBRAIN_EMBEDDING_MODEL` and `GBRAIN_EMBEDDING_DIMENSIONS` had when the dumps were taken ([§14](#14-restore-dump-gbrain_db)).

### 19. Changing the FTS language

The full-text search language is `GBRAIN_FTS_LANGUAGE` in the environment file (baseline `english`): a language Postgres supports or the installation's dictionary ([§1](#search-dictionary)). It is the configuration of the stored data, and so are the dictionary's files: a new language or a changed dictionary includes reindexing and a repeated retrieval benchmark in several languages.

1. Back up and stop: [§17.2](#172-backup-and-stop).
2. For a dictionary language, put its files into `postgres/dictionaries/`.
3. Set the new value of `GBRAIN_FTS_LANGUAGE` in the environment file.
4. Recreate Postgres: on start it installs the dictionary, and it receives the new value. `restart` does neither:

   ```bash
   ./bin/dc up -d --force-recreate postgres
   ```

5. Run `postgres/init.sql`: it checks the language and builds the search configuration of a dictionary language:

   ```bash
   ./bin/dc exec postgres psql -U postgres -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql
   ```

6. Show the plan:

   ```bash
   ./bin/dc run --rm gbrain gbrain reindex-search-vector --dry-run
   ```

7. Reindex:

   ```bash
   ./bin/dc run --rm gbrain gbrain reindex-search-vector --yes
   ```

8. Start and check: [§17.5](#175-start-and-check); the retrieval set from [§17.1](#171-record-the-baseline) passes in each of its languages, and the check of the search language from [§7](#7-verification) gives one lexeme.

### 20. Changing the public address

1. Set the new address values in the environment file ([§2](#2-environment)). On the server, a new domain means a new DNS record that points to the server.
2. Recreate the services with the new environment; on the server, Caddy gets a certificate for the new name:

   ```bash
   ./bin/dc up -d
   ```

3. Telegram webhook: [§6.1](#61-telegram-webhook).
4. New Notion webhook subscription: [§6.2](#62-notion-webhook-subscription); it changes the signing secret.
5. Chat: new connectors in the account and new addresses in the marketplace entry ([§6.4](#64-app-mcp-and-chat)). The endpoint does not accept tokens issued for the earlier `APP_MCP_URL`: the client connects again, with new consent.

### 21. Changing database passwords

Set new `APP_DB_PASSWORD` and `GBRAIN_DB_PASSWORD` in the environment file, each generated with `openssl rand -hex 32`. Recreate Postgres so that the container gets the new values:

```bash
./bin/dc up -d postgres
```

Run `postgres/init.sql`, which sets the role passwords from the environment:

```bash
./bin/dc exec postgres psql -U postgres -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql
```

Recreate the App and GBrain with the new database addresses:

```bash
./bin/dc up -d app gbrain gbrain-maintenance
```

### 22. Token renewal

- **The Claude subscription token** lasts a year. Issue a new one as in [§2.1](#21-claude-subscription-token), put it in `CLAUDE_CODE_OAUTH_TOKEN` and run `./bin/dc up -d app`.
- **The Notion MCP grant** needs a new authorization before the 180-day ceiling or after thirty days without a refresh ([§6.3](#63-notion-mcp-grant)). The App warns about the ceiling in the log two weeks ahead; `--status` shows the state.
- **The Telegram bot token**: send `/token` to BotFather, set the new `TELEGRAM_BOT_TOKEN`, run `./bin/dc up -d app` and then [§6.1](#61-telegram-webhook).
- **Chat tokens** are revoked by the query in [§6.4](#64-app-mcp-and-chat).

### 23. Anchor check

The owner fixes duplicate anchors and addresses that are already in use in GBrain, so run the check every week and after every manual page write in GBrain. The command only reads GBrain, with the same App client the runs use, from the container's environment:

```bash
./bin/dc exec app npm run anchors:check
```

The report names the anchors that deviate from the convention (with a violation code), the Notion objects with several anchors, and the pages whose text lacks events or facts that the database still has (a sign of a crude overwrite of the page). The page lists are read to the end, and a page whose events or facts do not fit in one server response stops the check with exit code 2 and the page name: an incomplete read does not prove that nothing is lost. Exit code: 0 means no violations, 1 means there are some, 2 means GBrain could not be read. Nothing is fixed automatically:

- several anchors of one object: keep one, in a conversation with Claude Chat, and delete the extra ones;
- a deviation from the convention: fix the page in Chat following the “Change a page” procedure, with the full content read before the write;
- drift: the events and facts are still in the database (`get_timeline`, `recall`), but the page text no longer contains them, so a restore from Markdown does not bring them back; write the page again in Chat, putting these sections back into its content, after which the check passes.

---

## Part III. Observability and troubleshooting

### 24. Observability baseline

The list of fields that every run makes observable is a contract: [`contracts/canonical.yaml`](../contracts/canonical.yaml), key `run_trace_fields`.

A run trace is stored as tables: the `run_traces` ledger, the `run_snapshots` snapshot and the lists `run_tool_calls`, `run_policy_decisions`, `run_model_usage` and `run_applied_effects`. The metrics over them are ordinary queries in the database console:

```bash
./bin/dc exec postgres psql -U postgres -d app_db
```

Tokens by mode per local day. `created_at` is stored in UTC, so `<APP_TIMEZONE>` is the value from the environment file (by default `Europe/Kyiv`):

```sql
SELECT t.mode,
       ((t.created_at AT TIME ZONE 'UTC') AT TIME ZONE '<APP_TIMEZONE>')::date AS day,
       count(DISTINCT t.id) AS runs,
       sum(u.input_tokens) AS input,
       sum(u.output_tokens) AS output,
       sum(u.cache_read_input_tokens) AS cache_read,
       sum(u.cache_creation_input_tokens) AS cache_creation
  FROM run_traces t
  JOIN run_model_usage u ON u.run_id = t.id
 GROUP BY 1, 2
 ORDER BY 2 DESC, 1;
```

Tool calls per run by server, against the retrieval limits ([`contracts/canonical.yaml`](../contracts/canonical.yaml), key `retrieval_budgets`):

```sql
SELECT c.run_id,
       count(*) FILTER (WHERE c.server IS NOT NULL) AS mcp,
       count(*) FILTER (WHERE c.server = 'notion') AS notion,
       count(*) FILTER (WHERE c.server = 'gbrain') AS gbrain,
       count(*) FILTER (WHERE c.server = 'app') AS app
  FROM run_tool_calls c
 GROUP BY c.run_id
 ORDER BY mcp DESC;
```

Share of failed calls for each tool; `harness` means the tools of the CLI itself:

```sql
SELECT coalesce(c.server::text, 'harness') AS server,
       c.tool,
       count(*) AS calls,
       round(avg((NOT c.ok)::int), 3) AS failure_rate
  FROM run_tool_calls c
 GROUP BY 1, 2
 ORDER BY failure_rate DESC, calls DESC;
```

Runs that delivered more than one message (`max_notifications_per_run`):

```sql
SELECT a.run_id, count(*) AS deliveries
  FROM run_applied_effects a
 WHERE a.kind = 'delivery'
 GROUP BY a.run_id
HAVING count(*) > 1;
```

What else is observed:

- the run path: App → Claude Agent SDK, plugin loading, Claude → App MCP, Notion MCP and GBrain MCP;
- Notion: REST, webhook delivery and checks, refresh of the Notion MCP grant;
- App MCP: authentication, the share of successful calls, the age of proposals awaiting a decision, the age of continuations, notification delivery;
- GBrain: `gbrain doctor --json`, `stats`, `models`, `models doctor`, `search modes`;
- host: `df -h`, `free -h`, `docker system df`.

### 25. Troubleshooting

#### PostgreSQL unhealthy

```bash
./bin/dc logs postgres
```

Check the disk, the password and the volume compatibility.

#### App does not start

```bash
./bin/dc logs app
```

- **Environment.** The App prints **the whole** list of problems in one `environment is invalid` message: the name of every variable and the reason (`is not set`, `must be 64 hex characters`, `is required when RUNNER_ENABLED is true`). The Notion binding is checked separately: a `null` slot also stops startup, and the list of slots is printed in full. Fix the environment file or `notion/mapping.yaml` and run `./bin/dc up -d app` again.
- **Migration.** A Prisma error in the log and a container that restarts in a loop: the image's migration has not been applied, and the App does not work with a schema that is behind. Roll back to the previous image together with restoring `app_db` from the copy taken before the upgrade ([§16](#16-upgrading-the-app), [§13](#13-restore-app_db)).
- **No binding.** Without `infra/notion/mapping.yaml`, Compose does not start the App at all and names the file ([§3](#3-notion-workspace-and-binding)).

#### Caddy does not get a certificate

```bash
./bin/dcp logs caddy
```

Both names must point to the server, ports `80` and `443` must be reachable from outside ([§1](#1-requirements)), and `ACME_EMAIL` must be set.

#### App image does not pull

If `./bin/dc pull app` returns `denied` or `unauthorized`, the machine is not signed in to the registry that `APP_IMAGE` comes from; `not found` means the registry has no such tag. The image can also be built from the clone ([§2.4](#24-app-image)).

#### GBrain does not start

```bash
./bin/dc logs gbrain
```

Every start runs `gbrain init` first; a failed `init` stops the container, and the reason is in the log.

```bash
./bin/dc run --rm gbrain gbrain doctor
```

#### GBrain migrations stop on a privilege error

```text
v24  rls_backfill_missing_tables: role gbrain_user does not have BYPASSRLS
v35  auto_rls_event_trigger: role gbrain_user may not CREATE EVENT TRIGGER
v120 schema_lint_hardening…: must be owner of function public.auto_enable_rls
```

`postgres/init.sql` grants these privileges. Running it again is safe:

```bash
./bin/dc exec postgres psql -U postgres -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql
```

Then restart GBrain together with the maintenance service: the start repeats `init`, and the migrations run again.

```bash
./bin/dc restart gbrain gbrain-maintenance
```

#### GBrain search language

One of these:

- `postgres/init.sql` stops with a message that begins with `GBRAIN_FTS_LANGUAGE` and says what is wrong: the name, a missing dictionary, or a dictionary named like a language Postgres supports;
- the GBrain migration stops with `configurable_fts_language` and `text search configuration "<name>" does not exist`;
- a search or a write fails with `could not open dictionary file`;
- Postgres does not start, and its log has a line that begins with `install-dictionaries:` and names the file it refused.

The language needs its dictionary in place ([§1](#search-dictionary)). Put the files in place, under a name the message accepts if it refused one, then recreate Postgres and run `init.sql`, as in steps 4 and 5 of [§19](#19-changing-the-fts-language), and start GBrain:

```bash
./bin/dc up -d gbrain gbrain-maintenance
```

If `init.sql` stopped on the first start, Postgres has no roles and no databases until `init.sql` runs, so start the App afterwards as well: `./bin/dc up -d app`.

#### GBrain without a Voyage key

`gbrain sync` stops with `requires VOYAGE_API_KEY`, and the reranker is disabled. The first start without a key writes `search.reranker.enabled=false`, and a repeated `init` does not change that choice. Put the key in the environment file, then:

```bash
./bin/dc up -d gbrain gbrain-maintenance
```

```bash
./bin/dc exec gbrain gbrain config set search.reranker.enabled true
```

```bash
./bin/dc exec gbrain gbrain models doctor
```

#### Sync does not see `/brain`

```text
Source "default" has no local_path
```

The source is registered once: [§5](#5-gbrain-initial-import).

#### GBrain `/brain` mount

```bash
./bin/dc exec gbrain ls -la /brain
```

A repository that uid 1000 can write to is expected ([§1](#1-requirements)).

#### App -> PostgreSQL

The App connects to the database over the Compose network: `postgres:5432`. The database port is not exposed externally.

#### Plugin loads, but Personal Management System behavior is inconsistent

Check that the Personal Management System Skill is enabled, that the plugin's `sha` in the marketplace matches the installation's commit ([§16](#16-upgrading-the-app)), that all three connectors are connected and that the conversation did not end up in a session without the plugin.

#### App run behaves differently from chat

Check that the App loads the plugin from its own image, that the same three MCPs are connected and that the tool set of the mode is the expected one. A divergence between the plugin and the image is a release error.

#### App MCP

The address is `APP_MCP_URL`. Check the Caddy → App route, the authentication, the token's expiry and scope, and whether the required capability is enabled.

#### Notion

Deterministic reads do not work: check the App's outbound HTTPS and `NOTION_API_TOKEN`. Webhook processing has stopped: check the Notion webhook subscription ([§6.2](#62-notion-webhook-subscription)), the App's public address, the Caddy → App route and the signature check. Claude cannot use the Notion MCP: check `https://mcp.notion.com/mcp` separately, the state of the grant and its refresh ([§6.3](#63-notion-mcp-grant)) and the connector configuration. A successful REST call does not prove that the Notion MCP is live.

#### GBrain MCP

For App runs, check: App → GBrain's internal `/token`, the short-lived token, the internal address `RUNNER_GBRAIN_MCP_URL`, the MCP tool set. For chat, check the connector's own client (`chat`), not the App's client.

#### Approved action did not execute

Check the proposal's immutable contract: the changes (page, property, value), the preconditions, `status` and `last_error`. `conflict` means the state changed, and the model will compose a new proposal. `failed` with a reason from Notion points to a value that the property does not accept, or to the integration's permissions ([§2.2](#22-notion-integration)).

#### No model or reranker

```bash
./bin/dc exec gbrain gbrain models doctor
```

```bash
./bin/dc exec gbrain gbrain migrate embeddings --status --json
```

The baseline of the knowledge models needs `VOYAGE_API_KEY` (above: “GBrain without a Voyage key”).

#### OAuth metadata names the wrong GBrain host

GBrain builds the OAuth addresses from `--public-url`, that is, from `GBRAIN_PUBLIC_URL`; on the server it is `https://<GBRAIN_DOMAIN>` from `compose.prod.yaml`. After a change, run:

```bash
./bin/dc up -d gbrain gbrain-maintenance
```

#### External requests share one IP

On the server, set `GBRAIN_HTTP_TRUST_PROXY=1` in `compose.prod.yaml` and keep exactly one proxy in front of the App and GBrain: Caddy ([§1](#1-requirements)).
