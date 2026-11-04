# GBrain pages: changes, links and lessons

## Change a page

These steps rewrite a page's compiled truth or its frontmatter. A fact, a decision or a dated event is recorded as an entry instead (`knowledge/memory.md`). When the person speaks of an object whose page does not exist yet, record what they say first: the page is created with that entry.

1. Find the page (`knowledge/memory.md`) and read it, asking for its complete content: the frontmatter, the body, the facts and the timeline as one text.
2. Change only what you were asked to change, and keep every other character as you read it.
3. Write the complete text back: a write replaces the whole page.
4. Read the page again and check that its `notion_id`, its facts and the number of its timeline entries are as before. If something is missing, restore it from what you read in step 1 and tell the person.

## Link pages

Link two pages that both exist. Find any other page (a lesson, a person, an organization, a source) by searching GBrain for its name. Read a link as a sentence, `<from> <type> <to>`, and set its direction so that the sentence is true: a lesson is `derived_from` the anchor it came from. Give the link one of these types, or none: `relates_to`, `derived_from`, `supersedes`, `mentions`, `sourced_from`. When one of these says how the pages relate, give it; otherwise leave the link untyped.

## Keep a lesson or a pattern

These steps keep a lesson or a pattern you drew. `knowledge/lessons.md` says what each is, how many episodes it needs and what its wording names. Count the episodes in the timelines of the anchors it draws on. With fewer than it needs, tell the person how many independent episodes there are and how many it takes, and keep it at that. With enough:

1. Show the person the wording and the episodes behind it, with their dates and sources. Wait for a clear yes to the wording.
2. Choose the address `lessons/<short-name-in-lowercase-with-dashes>` and read it. If a page is there, choose another name.
3. Write the page at that address:

   ```markdown
   ---
   type: note
   title: "<the lesson or the pattern in a few words>"
   ---

   # <the lesson or the pattern in a few words>

   <the wording the person confirmed>

   Confirmed by the person on <ISO date>.
   ```
4. Link it to each anchor it draws on: from this page, with the type `derived_from`, to the anchor.
5. Read the page back and tell the person where it is stored.
