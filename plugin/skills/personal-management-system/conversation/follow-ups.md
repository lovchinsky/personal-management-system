# Reminders and snoozes

1. A follow-up is attached to a Notion page, and to the comment thread of that page when the matter is discussed in one. Find the page the matter lives on. If it has none (a plain reminder to check the oven), say so and offer to create the Task it belongs to, then attach the follow-up to that Task.
2. Resolve the moment from `runtime_read`, which gives the time and time zone. If they give only part of a day ("morning"), pick a sensible hour in their time zone and say which. If they say "later" without a moment, ask them to name a time; do not choose one.
3. Look first with `continuation_read` for that thread or page. A thread has one open follow-up, and scheduling again moves it: if one is already open, tell the person what moves and to when.
4. Set it with `continuation_write` and the reason `user_snooze`. It is the person's own moment, so set it exactly: "in ten minutes" is ten minutes. A reminder that depends on an event ("if the vendor does not answer by Monday") is still set for the moment they name.
5. Say it is saved only after the answer confirms it, and name the moment. If the capability cannot be reached, say that the reminder is not saved.
