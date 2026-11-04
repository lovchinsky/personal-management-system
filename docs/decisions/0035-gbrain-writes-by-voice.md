# ADR 0035 — GBrain writes by voice: on its own behalf the system writes through an App intent, and conversation writes natively at the person's request

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D35` |
| **Related** | ADR 0014 · ADR 0017 · ADR 0034 · `INV-025` · `INV-028` · `INV-055` · `INV-096` · `INV-098` · `INV-100` · `GAP-37` · `GAP-38` |

## Context

The methodology requires that anything the person says that is to influence what follows is kept outside their head: a decision, a fact, the acceptable state of an Area of Focus. The person says it where they work — in a Notion thread, in a reply to a system message in Telegram, in a conversation with Claude. The memory entry lands on the anchor of the Notion object it is about (ADR 0034), and the object fully determines its anchor: type, title and id. The person decides what to remember; the object determines where the write goes.

GBrain, which the installation runs on (the baseline version is in `docs/2-system.md`), behaves as follows, and a safe write rests on this:

- `put_page` has one mode, a full replacement of the page. A replacement without the facts and timeline sections erases them from the file, although the rows in the database remain;
- a timeline event and a graph link require an existing page; a link's verb is taken from the declared vocabulary;
- the same event written a second time lands as a second item; `remember` deduplication relies on embeddings;
- a fact lands in the page file when `entity` is the slug of an existing page; GBrain silently accepts an unknown `entity`;
- a client's slug fence (`--bound-slug-prefixes`) removes `remember` from the client.

For Notion the line is drawn by voice (ADR 0017): on its own behalf the system writes through the App with a closed list of intents, and these writes wait for a valid run result (ADR 0014). A native GBrain write lands at once and for good, and the shape of the write — `entity`, the decision marker, the kind of fact — is determined by whoever calls the tool.

## Decision

**On its own behalf the system writes to GBrain memory with a single App intent, `record_memory` (capability `memory_record`), on both surfaces. A conversation writes natively to GBrain, at the person's request.**

- The model names the entry in canonical terms: the Notion object (or none), the kind (`event`, `decision`, `fact`, `standard`), the text in one line, the day, and the page and thread the entry comes from. Where it lands and in what shape is decided by the App: the anchor by exact identity, the shape by the kind — the marker `Decision:` or `Standard:`, `kind`, `entity` = the anchor's slug; the App skips an identical stored entry.
- When exact identity yields `absent` and the conventional address is free, the App creates the anchor by the convention together with the entry, one per object and with a read-back (`INV-098`). A duplicate anchor or another page at the address results in a refusal of the intent: memory stays as it is, and the person is told that what they asked to be remembered could not be remembered. The App looks after the anchors, and the conversation with the person is about what has been remembered.
- In a run the write is staged, like the rest of the App's effects, and is applied first after a valid result: closing an Inbox item as a reference rests on the recorded fact, and the comment “remembered” lands after a successful write. In conversation the write is applied at once.
- For a run, GBrain is read-only: the `mode_toolsets` rows give a run at most the GBrain bundle `read`.
- Pages that carry judgment — compiled truth, a lesson, an observation about the person — and graph links are written by the conversation with a native write, at the person's request, using the page-replacement protocol. The system brings up a lesson candidate when the person reviews with it what they have learned; a generalization the person stated themselves is the person's own words and is written as a fact.
- The person is told about memory in their own words: what has been remembered, or what could not be remembered.

**Rejected:**

- **Pages only in conversation, with the anchor left to the person's decision.** What was said about an object with no anchor would be lost, and the person would be left with a question about how memory is built, which cannot be answered from a thread or from Telegram.
- **A native `page_write` for a run, with an “empty address only” discipline.** The protection against overwriting another page would rest on the model alone.
- **A separate immediate intent to create an anchor next to native writes.** It is an exception to ADR 0014, and the shape of the write would be enforced by the Skill's text.
- **Anchors in advance for every object.** Empty pages with no entry are a mirror of Notion and noise in search.
- **A slug fence for the App's client.** It removes `remember`.
- **A store of observations (`takes`).** It widens the GBrain surface, which no row of the matrix names, and what it would store is derived from timeline events.

## Consequences

- Memory contains only the writes of valid runs; a write is applied in the same order of effects as the system's writes to Notion.
- Writes about one object go one at a time: an object gets a single anchor, and the App writes an anchor only to a free address.
- The shape of a write is enforced by the code and its tests; the Skill says what is worth remembering.
- The installation owner sees and fixes anchor discrepancies with the command `anchors:check`.

## Cost

- The App has a production write to GBrain that sometimes waits minutes while GBrain computes the embedding. In a run the write waits until the run's deadline: a write that does not finish in time fails the run, and the retry skips an identical write.
- An anchor created by the system starts with the title and the id; compiled truth is written by the conversation when the person asks.
- The title in an anchor is the one it was created with.
- A fact with no Notion object lives only in `gbrain_db` (`GAP-37`); what is written to GBrain sits in uncommitted files (`GAP-38`).
