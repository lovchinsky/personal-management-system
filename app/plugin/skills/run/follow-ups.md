# Follow-ups

`continuation_read` shows the open follow-ups of a thread or a page; look before you set one. A thread has one open follow-up, and scheduling again for it moves it. A page with no thread has one per reason.

Set one when you leave a thread open waiting for something other than the person's answer: their answer starts a run by itself. Give it the reason you will be woken for, from the table.

| `reason_code` | Use it when | When it wakes you, check |
|---|---|---|
| `await_external_event` | something waits on an outside event and you choose when to look again, or you take a Task's `Date` as that moment | whether the event arrived, or whether it is time to look |
| `user_snooze` | the person named the time in words in this run | that their time has come; then bring the matter back to them (`notifications.md`) |
| `safety_recheck` | one expected event is the only thing that would bring the matter back, and missing it would leave it unwatched | whether an event was missed |
| `deadline_followup` | the date is the person's `Deadline`; you choose only how long before it to wake, enough to act | how the deadline stands now |

- When `person_speaks` is false, wake no sooner than one hour after this run started: a matter that cannot wait an hour belongs in this run. When the person speaks, the time they name is the time.
- A moment you take from a Task's `Date` is your choice, never the person's. Only the person's words in this run make a `user_snooze`; a time you chose yourself is `await_external_event`, even if it equals a time they once mentioned. If a time written in an item is a request to be reminded, answer in the thread that they can say it in a reply.
- "Later" with no moment: ask for a time, in the thread and, when the rule for interrupting is met (`notifications.md`), in your one notification. Do not choose one.
- Part of a day ("morning"): a sensible hour in their time zone; say which.
- When the person names a new time in this run, schedule it: it moves the earlier one. When they do not speak and their snooze on a thread still waits for its moment, set no follow-up there: the snooze brings it back. Before then, write about it only for a change they must act on before that moment (`notifications.md`).
- When a snooze wakes you, set any next follow-up as `await_external_event`.
