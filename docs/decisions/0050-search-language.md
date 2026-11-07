# ADR 0050 — Search language: a built-in Postgres configuration or a hunspell dictionary of the installation

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D50` |
| **Related** | ADR 0048 · `INV-071` |

## Context

GBrain searches by meaning (embeddings) and by words. Its keyword search is the full-text search of Postgres with the text search configuration that `GBRAIN_FTS_LANGUAGE` names, on both sides: the triggers that fill the search vectors and the queries. The configuration decides how a text breaks into words, which words are dropped and how a word is reduced to its base form, so that different forms of one word match.

Postgres ships configurations for 28 languages, among them `english`, `german`, `spanish` and `russian`. For other languages, Ukrainian, Polish and Czech among them, it has none, and a word matches only in the exact form in which it is written. Hunspell dictionaries exist for most languages, and Postgres reads them through its `ispell` template, but only from its own `tsearch_data` directory and only by a name of lowercase letters, digits and underscores.

GBrain requires the configuration to exist before its schema migration; otherwise its `init` fails. A dictionary comes under its own license, which may limit its use, for example to non-commercial use, so the project cannot carry dictionaries for the installations.

## Decision

**The search language is a built-in configuration of Postgres or a hunspell dictionary that the installation supplies; `init.sql` builds the configuration of a dictionary before GBrain needs it.**

- **Setting.** `GBRAIN_FTS_LANGUAGE`, which GBrain and `init.sql` read with the same default, `english`. A built-in name needs nothing else.
- **The installation's dictionary.** The files `<name>.dic` and `<name>.aff` and an optional stop-word list `<name>.stop`, one word per line, in `infra/postgres/dictionaries/`, under the names the dictionary comes with. The setting is that name in lowercase: `uk_UA.dic` and `uk_UA.aff` give `uk_ua`. Git carries the directory but not the dictionaries, and other files in it, such as the dictionary's license, stay where they are. The owner checks the dictionary's license.
- **Installation into Postgres.** `infra/postgres/install-dictionaries.sh` runs before the image's entry point on every start of the container. It copies the files into `tsearch_data` under the lowercase name and readable by the server, replaces what it installed on the previous start of the container, and never replaces a file of the image.
- **Configuration.** For a name that is not built in, `init.sql` creates in `gbrain_db` the dictionary `public.<name>` on the `ispell` template, the filter `public.<name>_stopwords` when there is a stop-word list, and the configuration `public.<name>`. Every kind of word, in any script, goes through the filter, which drops a listed word as written, as the built-in languages do; then through the dictionary, which reduces a word it knows to its base form; then through `simple`, which keeps a word the dictionary does not know. Numbers, addresses and the like go to `simple`. The configuration carries no second language. Each run of `init.sql` brings these objects in line with the installed files.
- **Check.** `init.sql` stops before it creates anything when the name is not one GBrain accepts (GBrain itself would search in English and say nothing), when a dictionary language has no installed dictionary, and when a dictionary has the name of a built-in configuration, which Postgres would use instead.
- **Change.** A new language or a changed dictionary means a reindex ([RUNBOOK §19](../../infra/RUNBOOK.md#19-changing-the-fts-language)). A `gbrain_db` dump carries the dictionary objects, so the dictionary is installed before the dump is restored.

**Rejected:**

- **A Postgres image of the project with the dictionaries.** Every installation, with a dictionary or without, would build its own database image and rebuild it after each change of a dictionary. The stock image pinned in Compose serves all of them.
- **The files mounted into `tsearch_data` one by one.** Compose would name the files of one language, and an installation without them would not start.
- **A shell script in `/docker-entrypoint-initdb.d`.** It runs once, on an empty volume and as the `postgres` user, while the files are needed on every start and the directory belongs to root.
- **A directory mounted over `tsearch_data`.** It would hide the files of the built-in configurations.
- **Links instead of copies.** The server reads the files as the `postgres` user, and the owner's files may be readable by their owner only.
- **Dictionaries in the repository.** Their licenses are not the project's.
- **English rules for words in the Latin script.** In a language written in the Latin script, two forms of one word would go to different dictionaries and never match. A second language belongs to the configuration of a particular installation, not to the code.
- **A configuration named after the language (`ukrainian`).** A Postgres release may ship a built-in configuration with that name, and Postgres finds a name in its own catalog first: the installation would switch to other rules without a word. Postgres does not use the names of hunspell dictionaries (`uk_ua`) for its configurations.
- **A shared dictionary cache (`shared_ispell`) or a connection pooler in front of GBrain.** The load time below does not justify a custom database image or another service.

## Consequences

- Compose starts `postgres` through the installer, mounts the dictionary directory read-only and passes `GBRAIN_FTS_LANGUAGE` to it with the same default as to GBrain.
- `init.sql` checks the language before it creates anything and builds the configuration in `gbrain_db`.
- RUNBOOK describes [the dictionary](../../infra/RUNBOOK.md#search-dictionary) and [the setting](../../infra/RUNBOOK.md#2-environment), [the check](../../infra/RUNBOOK.md#7-verification), the dictionary in [the backup](../../infra/RUNBOOK.md#9-backup-matrix) and [the restore](../../infra/RUNBOOK.md#14-restore-dump-gbrain_db), [the change of language](../../infra/RUNBOOK.md#19-changing-the-fts-language) and [the failures](../../infra/RUNBOOK.md#gbrain-search-language).
- The integration lane starts the database container the way Compose does, with a dictionary written for the test (`app/test/integration/postgres-dictionaries.spec.ts`).

## Cost

- Every installation runs the installer before Postgres.
- A dictionary is loaded into each database connection on its first use. For a Ukrainian dictionary of 353 thousand words this takes about 65 MB and about one second. GBrain closes a connection after 20 idle seconds, so the first search or write after a pause takes that second.
- The `ispell` template ignores part of the hunspell format, including input conversion and ignored characters, so a form written with a typographic apostrophe or a stress mark is not reduced. The Postgres parser splits a word at an apostrophe in every configuration.
- The owner keeps the dictionary's files and checks their license.
