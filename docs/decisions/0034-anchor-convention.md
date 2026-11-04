# ADR 0034 — Anchor: id in the frontmatter and in the body, slug from the id, identity as a pure function

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D34` |
| **Related** | ADR 0011 · ADR 0027 · ADR 0035 · `INV-055` · `INV-097` · `INV-098` · `INV-099` · `GAP-40` · `SCEN-19-38` |

## Context

Exact identity is a search by the full `notion_id`, a read of the candidate and a check of `frontmatter.notion_id` for equality. GBrain, which the installation runs on (the baseline version is in `docs/2-system.md`), behaves as follows, and the procedure rests on this:

- the text index covers compiled truth and the timeline; the frontmatter lies outside it. A search for an id that is present only in the frontmatter returns the page closest in meaning, marked as a weak semantic match;
- a page that merely mentions the id (a lesson, a note) is an exact match just as an anchor is;
- a search response carries the slug, the type and the match mark, while `notion_id` comes from reading the page;
- search lags behind a write: a page to which an event or a fact has just been added is not found by an id search for some time, although a read by slug sees it at once (`GAP-40`);
- GBrain reserves the frontmatter key `id` for deduplication: a write carrying another page's `id` value overwrites that page;
- the page types `behavior_system`, `objective`, `area_of_focus` and `identity` lie outside the pack's schema, but writing, listing and searching by type work with them;
- `entity` resolves a name and an alias and, on a tie, picks the last touched page.

The procedure holds when the id is in the text of the page, the anchor's address is derived from the id, and identity is decided by the `notion_id` read from the page.

## Decision

**The anchor convention records the id in both the frontmatter and the body, the slug is derived from the id, and the answer about identity comes from a pure function over what was read.**

- The slug is `<type prefix>/<notion_id without hyphens>`: it stays the same when the person renames the object, and belongs to one object.
- The frontmatter carries exactly `type`, `title`, `notion_id` and `aliases`.
- The body begins with the title and an identity line `Notion: <notion_id>`, which an id search sees. The frontmatter is authoritative: the equality of `frontmatter.notion_id` is what makes a page an anchor.
- Identity is one of three states (`absent`, `exact`, `integrity_error`), computed over the candidates: pages of the anchor types that the search marked as an exact match, and the page at the object's conventional address. The address does not depend on the index, so an anchor that has just been written to does not drop out. Two pages with the same `notion_id` yield `integrity_error`.
- The `knowledge/` layer owns building, parsing and identity: pure functions with no I/O, following the pattern of [ADR 0027](0027-methodology-layer.md). The model that reads memory takes the same steps with native GBrain calls, and the App takes them as the precondition of a memory intent ([ADR 0035](0035-gbrain-writes-by-voice.md)); the layer is the reference that tests and the gate check against, and the only place where the shape of GBrain's responses is written down.
- The installation takes the page types `behavior_system`, `objective`, `area_of_focus` and `identity` as GBrain accepts them, and uses the pack's vocabulary without its own copy.

**Rejected:**

- **A slug from the title.** Two pages with the same title get the same slug, and the second overwrites the first; renaming in Notion breaks the link between the slug and the object.
- **Search through `entity`.** It resolves a name and an alias and, on a tie, takes the last touched page, so a duplicate would go unnoticed.
- **Frontmatter and semantic search only.** Search does not see the frontmatter, and a similar page would stand in for the anchor.
- **An App MCP tool for identity.** The model reads memory with native GBrain operations and establishes identity itself (`INV-055`); the App runs the same procedure as the precondition of a memory intent.

## Consequences

- An anchor created by the convention is found by its address and by an id search, and a duplicate is detectable automatically.
- `anchors:check` and the gate read GBrain through one set of parsing schemas (`knowledge/`).
- A GBrain upgrade that changes the indexing of the frontmatter or the exact-match mark breaks the preflight of gate M7: the change is visible before the first run.

## Cost

- The id lives in two places on the page. Parsing an anchor checks that they match, but a person who edits the page by hand can make them diverge.
- Slugs derived from the id are not human-readable in the file system of `gbrain-repo`; the frontmatter carries the title and alias, and a search by title goes through the entity card.
- For some time, search does not show a duplicate anchor that has no conventional slug and has just been written to (`GAP-40`).
