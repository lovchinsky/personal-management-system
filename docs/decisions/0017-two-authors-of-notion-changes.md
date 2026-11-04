# ADR 0017 — Two authors of Notion changes

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D17` |
| **Related** | ADR 0006 · ADR 0014 · ADR 0015 · ADR 0023 · ADR 0043 · `INV-008` · `INV-018` · `INV-086` · `INV-087` · `INV-088` |

## Context

Notion attributes a write made through the Notion MCP to the person who issued the grant. A write made through Notion REST is attributed to the integration bot (`created_by`, `last_edited_by`). A comment on a page made through REST opens a discussion, and a reply with `discussion_id` stays in it. Properties are written by their ids in the binding. A page in the trash accepts no writes.

If the system wrote through the Notion MCP, its writes would look as if the person had made them:

- intake could not tell the system's own write from a person's edit and would wake a run about itself;
- a run could not tell its own comment in a discussion from the person's reply;
- an Inbox item parked in the chat would be processed a second time.

## Decision

**Changes to Notion have two authors — the person and the system. The interface chooses the voice, not the operation.**

- **The person.** Their edits in Notion and what Claude writes to Notion through the Notion MCP during a chat, at their request: Notion attributes this to the person. These are the person's writes in substance, not only by attribution.
- **The system.** Everything the system decides about the state of Notion is written by the App through REST, in the integration bot's name, as intents from a closed list in canonical terms:
  - a comment;
  - the conversion of an Inbox item into a Task;
  - closing an Inbox item without a Task ([ADR 0023](0023-close-inbox-item-intent.md));
  - executing an approved change.

  In App runs the Notion MCP only reads.
- **The system's writes pass through one boundary — `NotionWriter`.** It writes and checks that the author of the response is the integration bot. It receives values already encoded: the binding adapter encodes canonical values into physical ones by the types of the live schema, because the binding contains no physical types.
- **The system's writes from a run are staged until the result is valid**, like the rest of a run's writes (ADR 0014, ADR 0015).

## Consequences

- An event whose authors are all the integration bot is the system's own write; anything else is a person's change (`INV-018`, `INV-087`). Intake filters out the system's own writes by author.
- A run tells its own comment from the person's words by author, and the discussions the system manages are recognized.
- Converting and closing an Inbox item are actions of the system through the App, both in a run and in the chat, including at the person's request. Moving the item to the trash goes through REST.
- Writes in the bot's name that decide nothing about the existing state are not intents of the system: an Inbox item parked from the chat and the person's reply from the channel in the system's thread carry the person's words into Notion, while the trail of a proposal's fate in its thread ([ADR 0043](0043-proposal-fate-in-thread.md)) records what has already happened.
- `INV-008`: the App does not write to the page body. `INV-086`: only `NotionWriter` calls the Notion write endpoints.

## Cost

- The system's texts in Notion are attributed to the integration, not to the person: the author is the bot even when the comment is shown under a kind label (ADR 0043), so the person can see that the system wrote it.
- The Notion page history shows the writes Claude makes during a chat at the person's request under the person's name; the conversation shows who made them.
- Every property write reads the live schema — one request, because the binding contains no types. Neither a comment nor a move to the trash reads the schema.
- The integration needs permissions to insert and update content and comments.
