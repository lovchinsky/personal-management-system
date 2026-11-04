# ADR 0042 — The language of the texts the App writes to the person itself

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D42` |
| **Related** | ADR 0007 · ADR 0021 · ADR 0036 · ADR 0043 · ADR 0045 · ADR 0046 · `INV-024` · `INV-105` · `INV-106` |

## Context

Two authors write to the person. The model writes review packets, comments and replies in the person's language: that is a rule of the Skill — the language of the person's pages or of their latest words. The App itself writes what has to work without the model:
- system messages: the breaker is open, a client is connected to the App MCP, a review did not take place, Notion is unavailable and the answer to the person is waiting for it or could not be given, a reminder or a deadline check did not take place;
- proposal fates next to their lines;
- the trail of a decision on a proposal in its thread and the labels of system comments in Notion;
- buttons, captions and channel replies;
- OAuth consent pages.

These texts do not go through the model. Some are needed precisely when runs are not working: the breaker, an unavailable Notion, a review and a wake that did not take place (ADR 0045). Some concern security: connecting a client, the owner's consent. The rest is too small to wake a run for: a button, the answer to a press.

A text assembled in code from fragments keeps the grammar of one language — gender, case, word order — in the code, and a second language would mean editing every such place.

## Decision

**The texts the App itself writes to the person come from a typed catalog of the installation's language.**

- **Catalog.** `app/src/texts/<language>.ts` for every language in `LANGUAGES` (`texts/language.ts`); its shape is the interface `Texts` (`texts/texts.ts`). The catalog holds whole sentences, so grammar stays the language's own business: `Intl.PluralRules` gives the plural forms, and the catalog itself writes gender and case. A month with a year is a language format, not prose: `Intl.DateTimeFormat` formats it in the installation's language (“жовтень 2026 р.”, “October 2026”). The code keeps for itself the keys, the links and the truncation of reasons; dates for the person likewise use the language's format, written in words ([ADR 0046](0046-system-voice.md)).
- **Installation language.** `APP_LANGUAGE`, optional; the default is `en`, and that value lives only in `appConfig`. The environment validation at startup rejects a language without a catalog.
- **Who reads the language.** Delivery reads it for messages and proposal fates, the Telegram channel for the render and the packet size check, the channel webhook for replies, the publication of a proposal's fate, and attention, for the trail in a thread and the labels of comments, and OAuth for pages. The size check and the render of a packet use the same texts, so a packet that fit when it entered the queue also fits at delivery.
- **Outside the catalog**, because these are not words the App says to the person:
  - the marker `Person's reply via <channel>:` is a protocol between the App and the Skill, and the Skill recognizes it verbatim;
  - the output of operator commands, and logs;
  - technical reasons (`last_error`, the protocol's `error_description`) are evidence and stand as they are, under a label in the installation's language;
  - client names are data, not text.
- **Limits.** The compiler enforces that every catalog is complete, and `INV-106` enforces its limits in the channel. Outside the catalogs the App code has no Ukrainian string literal, and a catalog imports only types.

**Rejected:**

- JSON with ICU MessageFormat. It is a library and a mini-language inside strings, and the compiler checks neither the completeness of the keys nor the parameters. Choosing a text by review mode or proposal fate would stay in the code just the same. Texts outside the code are for translators and localization tools; here the catalogs are kept in code, and the compiler enforces the completeness of each. Consumers see only `Texts`, so the storage format can be changed without touching them.
- Texts through the model: they are needed precisely when there are no runs.
- A language taken from Telegram's `language_code` and a language inferred from pages. The installation owner sets the language once; a language taken from the channel would diverge from the consent page and from messages that go without a channel.

## Consequences

- A new language is a catalog file, its tag in `LANGUAGES` and an entry in `CATALOGS`; the compiler and `INV-106` say whether it is complete and fits within the limits.
- A message already queued stays in the language it was queued in: the queue stores the text. The render takes button captions and links from the current language; longer captions may shorten the body of such a message but will not break the limits.
- The gate renders and measures packets in the App's language and records that language in the verdict. Verdicts of different languages are not compared: their packet lengths differ.

## Cost

Every new text from the App to the person is an entry in every catalog. If an entry is forgotten, the language will not build; if a text is made too long, `INV-106` will not pass.
