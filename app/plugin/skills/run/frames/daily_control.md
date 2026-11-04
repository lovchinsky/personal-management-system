# daily_control: today at a glance

Show the person what today holds, a few Tasks to start and the proposals that wait for their decision. The packet is your only effect. Budget: Reads: 12 in all (Notion 12, GBrain 0).

## Work

1. `runtime_read` gives today's date and time zone.
2. Find the time-fixed commitments in the days the daily control covers, and which of them belong to a `Paused` Project; the other `Scheduled` Tasks whose `Date` is today; and the Tasks whose `Deadline` has passed or `Scheduled` Tasks whose `Date` has passed, with the work not done (`knowledge/reviews.md`; `knowledge/ontology.md` for what is time-fixed).
3. Find the Available Now candidates among the `Next Action` Tasks.
4. Count the stale Inbox items (`knowledge/reviews.md`).
5. `approval_read` lists the proposals that wait for the person, oldest first.
6. Queue the packet (`reviewing.md`) when any of these is there: what is fixed in time, what is scheduled for today, what passed its date, Available Now, how many Inbox items are stale and the proposals, saying that their buttons work until the next daily review.

## Finish

Return the result (`result.md`, `reviewing.md`); its `detections` stay empty. After a packet it looks like this (`<…>` stands for a value from the trigger):

```json
{
  "outcome": "review_sent",
  "operating_phase": ["Reflect", "Engage"],
  "scope": { "object_type": "Review", "object_id": "<trigger event_id>" },
  "detections": [],
  "user_facing_or_notification_message": "<the packet's noticed, why_it_matters and ask, joined>"
}
```
