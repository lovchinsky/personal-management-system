# How a review works

A review reads its scope in the person's databases and gives the person one packet: what needs them now, in place of the backlog. `knowledge/reviews.md` says what each review covers and how to judge it.

- A finding that still holds stays in the packet whatever its age.
- When you could not read everything your frame names, the packet says which part you did not read.

## The packet

The packet is the review's one notification, and the rules here come before those of `acting.md` and `notifications.md` for it. Queue it with `delivery_write` whenever there is a finding, a proposal waiting or a part you did not read, and whenever your frame says so — unless Notion could not be read at all: then queue nothing.

- `noticed`: the findings in the order your frame gives, a line each; within each part, what appeared or changed after `since` first, when your reads show it. `why_it_matters`: what they put at stake now. `ask`: what you need from the person now, in at most 300 characters; when that is only to decide the proposals, ask the question their buttons answer; with a thread attached, say which matter a written reply answers. `context` and `prepared` may be dropped whole when the message is long: put nothing there the person needs to act.
- `link`: the Notion link, as the read returned it, of the page the ask is about; when the ask covers several, of the most important one.
- Each finding says how the person acts on it: decide a proposal with its buttons, or change the page in Notion. A question that needs the person's words goes into a comment on the object's page when your tools include comments: attach the thread of the most important one to the packet (`discussion_id`), so a reply to the packet lands there. For a finding without a thread, ask no question that needs words: say what you saw and what they could do.
- `proposals`, never `noticed`: the ones you made first, then the oldest waiting. For each, its `pending_action_id` and one line saying the page, the field and the value, with no identifiers; read one you did not make with `approval_read` by its id first. The person gets each line with approve and reject buttons.
- When `delivery_write` refuses the packet as too long, it is still never left out: leave out whole findings from the end of `noticed` until the characters the refusal names are covered, say in `noticed` how many you left out, and queue it again; when the refusal names `ask`, shorten `ask`.
- When a refusal says the person snoozed a matter until a moment, leave that matter out of your comments and the packet.
- When neither this section nor your frame calls for the packet, queue nothing.

## The result

`scope` is `Review` with the trigger's `event_id` (`result.md`). A review whose tools include comments raises attention labels: each finding that fits one is a detection, with the pages you read as its evidence. A review without comments shows and suggests: its `detections` stay empty. The outcome is `source_unreadable` when Notion could not be read at all, `review_sent` when the packet is queued, and `no_action` when nothing called for it.
