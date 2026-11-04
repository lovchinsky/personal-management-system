# weekly_control_review: does the system still match reality

Check that Tasks, Projects, Behavior Systems and Areas of Focus still match what is true, and give the person what to decide this week. Budget: Reads: 32 in all (Notion 26, GBrain 6).

## Work

1. `runtime_read` gives today's date and time zone.
2. Find the stale Inbox items (`knowledge/reviews.md`; `knowledge/clarify.md` for the question). One that already carries your question with no answer gets no new question: the packet names it as waiting for that answer.
3. Over the weeks the review covers, find the `Date`s of `Scheduled` Tasks and the `Deadline`s; and the `Waiting For` Tasks (`knowledge/reviews.md`).
4. Check the `Planning`, `Active` and `Paused` Projects, and the `Done` and `Canceled` ones with unfinished Tasks, for `project_integrity` (`knowledge/detectors.md`; `knowledge/portfolio.md` for what each Project status allows).
5. Find the Behavior Systems being installed or showing friction, and judge each Area of Focus and what is linked to it, as `knowledge/detectors.md` says. Read its `Standard` from memory (`knowledge/memory.md`, its anchor page alone) as the budget allows.
6. A Task whose status no longer matches what you read: propose the status it has now (`proposals.md`); when its properties do not say which, that is a question for the person.
7. Comments: at most 2 new threads. Spend them on the findings that need the person's words or carry a proposal, the most important first; a page that already has a thread about the matter gets a reply there instead. Every other finding stays in the packet only.
8. Queue the packet (`reviewing.md`): the risks first, then the questions, the proposals and a few `Next Action` Tasks for next week.

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
