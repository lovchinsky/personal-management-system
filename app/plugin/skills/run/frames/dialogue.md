# dialogue: an Inbox item, or the person's answer about one

## Look

1. Read the item in full and every comment on it: your earlier question and the person's answer live there. If the item has left the Inbox or is already in the trash, there is nothing to do: result `no_action`.
2. If `person_speaks` is true, this run is the person's answer: read the whole thread before you decide anything (`acting.md` says how to read an answer).
3. Decide what the item is and whether an equivalent exists (`knowledge/clarify.md`; `knowledge/schema.md` when the state of a field matters).

## Act

- **It resolves into a Task**: `capture_convert` with the name, status, `Date` or `Deadline` and the comment that `knowledge/clarify.md` describes. Its answer names the new Task's page, so you can use it at once, for example for a follow-up on a `Waiting For` Task whose check moment the person named. Write no separate comment or notification about a conversion.
- **It resolves without a Task**: `capture_close` with the reason `trash`, `duplicate` or `reference`, each as `knowledge/clarify.md` describes.
- **It does not resolve**: one comment on the item (`comment_write`). Lead with the question, then say what you think it is and which equivalents you checked. If your question is already there and unanswered, leave it: do not ask twice. Send the question in a notification too when `notifications.md` says so.
- **It suggests a higher-level object, or a change to an existing one**: that is the comment too, naming the type or the change and why. The item stays.

## The person answered

- The answer resolves the item: resolve it now, as above. Reply in the thread only if there is something to add.
- It answers only part, or says the item is not needed: answer in the thread and resolve what you can. An item the person calls unneeded is junk: close it as `trash`.
- "Yes, make it a Project" (or a Behavior System, Objective, Area of Focus, Identity): you cannot create it. Say once, in the thread, that the person creates it in Notion. For a Project, add that once they say here that it exists, you turn the item into its first Task. The item stays.
- "Yes" to a change of an existing object that you named: propose it (`proposals.md`) and say so in the thread. The item stays until the change is made.
- A time for a reminder ("on Monday morning"): `follow-ups.md`. "Later" with no moment: ask for one.

## Finish

Return the result (`result.md`). Its `scope` is the Inbox item, and a run that resolved or closed an item, or only asked a question, is not `no_action`: label it `inbox_item_resolved`, or `question_asked`. After a conversion it looks like this (`<…>` stands for an identifier you read in this run):

```json
{
  "outcome": "inbox_item_resolved",
  "operating_phase": ["Capture", "Clarify", "Organize & Align"],
  "scope": { "object_type": "Inbox item", "object_id": "<Inbox item id>" },
  "detections": []
}
```
