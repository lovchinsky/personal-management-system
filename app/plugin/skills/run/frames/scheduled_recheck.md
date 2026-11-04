# scheduled_recheck: a follow-up has come due

The envelope carries no state and no earlier conclusion: you start from what is true now. `reason_code` says why you were woken (`follow-ups.md`); `discussion_id` names the thread when there is one.

## Work

1. Read the live Notion state of the page and, when there is a thread, the thread. Add GBrain only when the decision needs it (`knowledge/memory.md`). If the matter is closed (the page is in the trash, an item has left the Inbox, a Task is `Done`, `Canceled` or `Failed`), write and set nothing: the result is `no_action`. A closed Project is not a closed matter: judge it below.
2. Go by `reason_code`:
   - **`user_snooze`: the person's time has come.** Bring the matter back to them, with or without a thread: a comment in the thread or on the page, and a notification (`notifications.md`). Label the result `reminder_sent`.
   - **`safety_recheck` with no thread: the page itself may need attention now.** Judge its dates, status and relations as they are now: a check `Date` that has come for a `Waiting For` Task, a `Deadline` that has passed or that the Task's dependency puts at risk, a Project in a `project_integrity` form its properties show, a status that contradicts the Task's dependency (`knowledge/detectors.md`). Raise what you find on that page (`claims.md`), setting a follow-up when you leave a matter waiting, or return `no_action` when nothing holds.
   - **Anything else:** go on with step 3.
3. Judge what you found with the labels of `knowledge/detectors.md`, and decide which of these it is:
   - **The wait is confirmed.** The expectation still holds and nothing new is at stake. Set the next follow-up and return `recheck_scheduled`.
   - **Something material changed, or the situation got worse** (the awaited reply is missing and the deadline is now close, say). Tell the person: a comment in the thread and, when the rule for interrupting is met (`notifications.md`), a notification; what each label asks for is in `claims.md`. If the matter stays open, set the next follow-up too.
   - **The problem is resolved, or no longer relevant.** Set no further follow-up. Write a short comment with what you found only if the thread does not already say it, and notify only when that rule is met (`notifications.md`). Label the result `problem_resolved` when you wrote it, `no_action` when you wrote nothing.
4. The next follow-up wakes you when there is something to check: a date the matter depends on, a reply you expect, the person's `Deadline` minus the time to act, and never sooner than `follow-ups.md` allows.

## Finish

Return the result (`result.md`), with a detection for each claim you made and the narrowest object as its `scope`. When the expectation still holds and nothing new is at stake it looks like this (`<…>` stands for an identifier you read in this run):

```json
{
  "outcome": "recheck_scheduled",
  "operating_phase": ["Reflect", "Adapt"],
  "scope": { "object_type": "Task", "object_id": "<Task id>" },
  "detections": []
}
```
