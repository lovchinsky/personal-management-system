# event_evaluation: a change or a comment in Notion

Judge whether there is something the person should hear, and say it the least intrusive way that works. Usually the right result is nothing: `no_action` is a complete result.

## What the trigger tells you

Several changes of one page arrive together: `event_types` names every kind among them, in name order, and `type` the kind of the latest. Read every field:

- `page_id` (and `entity_id`) names the changed object.
- `updated_property_ids` names the properties that changed; empty when none did.
- `discussion_id` names the thread someone commented in, when a comment is among the changes.
- `channel.message` among `event_types`: the person replied in the messaging channel to a message you sent. Their words are already in the thread as a comment that starts with `Person's reply via <channel>:`.
- `page.content_updated` among `event_types`: the page's body changed. Read the body: a commitment or a dependency may be written there.

When `person_speaks` is true, this is the person's answer: answer in that thread (`acting.md`, "Reading an answer"), and go on below only if the answer raises something new.

## Work

1. **Centre.** Find the narrowest object the trigger points at and start there, not with a workspace-wide search.
2. **Current state.** Read its relevant properties, its unresolved threads and its direct relations; for a Task, also its Project and the Project's status. Go further only when a hypothesis needs it.
3. **Memory.** Read what GBrain holds about the object, starting from its anchor and the list of its links (`knowledge/memory.md`).
4. **Claim.** For each thing that may need attention, hold the claim, the evidence, what would weaken it and why it matters now (`knowledge/detectors.md`). A claim without evidence you read in this run is not made. When the evidence is not enough, the result is `no_action` or a follow-up, never a confident guess. A Project's or a field's state may need `knowledge/portfolio.md` or `knowledge/schema.md`.
5. **Smallest useful effect.** Nothing, a comment in the right thread, a follow-up (`follow-ups.md`), one notification (`notifications.md`), a proposal (`proposals.md`), a memory entry: the least that serves the person. `claims.md` says what each label asks for. Before any lasting effect check that you may do it, that the evidence holds, that the thread does not already say it, and that it has not been done before.

## Finish

Return the result (`result.md`), with a detection for each claim you made and the narrowest object as its `scope`. A claim raised with a comment and a follow-up looks like this (`<…>` stands for an identifier you read in this run):

```json
{
  "outcome": "attention_raised",
  "operating_phase": ["Reflect", "Adapt"],
  "scope": { "object_type": "Task", "object_id": "<Task id>" },
  "detections": [
    {
      "type": "dependency",
      "claim": "The Task is Waiting For an external reply and the Project has no other Task that can move the work.",
      "why_now": "The check Date has passed and no reply has come.",
      "evidence": [
        { "server": "notion", "ref": "<Task id>" },
        { "server": "notion", "ref": "<Project id>" },
        { "server": "gbrain", "ref": "<anchor reference GBrain returned>" }
      ],
      "counterevidence_checked": [
        "Read the page body and the thread: no reply is recorded.",
        "Read the Project's other Tasks: none can move the work."
      ],
      "uncertainties": ["The reply may have reached the person outside Notion."]
    }
  ],
  "user_facing_or_notification_message": "<the comment text, in the person's language>"
}
```
