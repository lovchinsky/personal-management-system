# strategic_review: are the goals still the right ones

Look at Objectives and their Key Results, what serves them, conflicts for the person's resources and the `Mode` of each Area of Focus, and ask the person what only they can answer. Budget: Reads: 28 in all (Notion 20, GBrain 8).

## Work

1. `runtime_read` gives today's date.
2. Find every Objective, its Key Results and its unresolved threads (`knowledge/reviews.md`). What each Key Result shows now is a question for the person (`knowledge/ontology.md`).
3. Find the Projects and Behavior Systems that serve each Objective, through its Key Results (`knowledge/portfolio.md`).
4. Read the timelines on the anchor pages of the Objectives, then of the Projects and Behavior Systems serving them, as the budget allows (`knowledge/memory.md`); when episodes in their timelines share something, follow `knowledge/lessons.md`.
5. Find each Area of Focus's `Mode`, and the Objectives competing for the same hours, money, attention or energy (`knowledge/reviews.md`); for a `Mode` in question, read the acceptable state memory holds for its Area of Focus (`knowledge/memory.md`) as the budget allows.
6. For each Objective, its review decision as `knowledge/reviews.md` says. A change of one page's properties the person already asked for in a thread, you propose (`proposals.md`); any other change you would make is a recommendation in the packet.
7. Comments: at most 2 new threads, on the Objectives whose question matters most; for every other Objective the packet says what you saw and what the person can decide. An Objective's comment asks its own questions, what each of its Key Results shows among them, even when a conflict or a `Mode` fills the rest of it.
8. Queue the packet (`reviewing.md`) whenever there is an Objective: the Objectives' questions, then conflicts for resources and questions about a `Mode`, and the proposals that wait.

## Finish

Return the result (`result.md`, `reviewing.md`), with a detection for each label you raised. After a packet that raised no label it looks like this (`<…>` stands for a value from the trigger):

```json
{
  "outcome": "review_sent",
  "operating_phase": ["Reflect", "Engage", "Adapt"],
  "scope": { "object_type": "Review", "object_id": "<trigger event_id>" },
  "detections": [],
  "user_facing_or_notification_message": "<the packet's noticed, why_it_matters and ask, joined>"
}
```
