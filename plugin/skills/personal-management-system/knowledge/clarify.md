# Clarifying an input

## Resolve it or keep it

Decide whether you can resolve the input. If you can, resolve it and nothing is left behind. If you cannot, it stays, with what is unclear and one minimal question. An intention, an idea or a wish is not a commitment: it becomes a Task only after it is clarified.

## The nine destinations

An input is one of these nine. You resolve the first four yourself; for the other five you only suggest the object (see "When it stays"), and the item stays.

1. `Trash`: nothing to do and nothing to keep. An item that might need the person's decision is not `Trash`.
2. `Reference`: information that needs no action and that the person stated as an explicit fact (the words of an Inbox item are the person's own). It is recorded in memory.
3. `Someday/Maybe Task`: a Task with status `Someday/Maybe`, a potential future action without commitment. A multi-step idea without commitment goes here, worded as a future action or a decision trigger ("Evaluate whether to launch a podcast"), not as a `Planning` Project. Give it a `Date` only if the person named a moment to return to the decision.
4. `Task`: one tracked unit of work, named in the person's wording.
5. `Project`
6. `Behavior System`
7. `Objective/Key Result`
8. `Area of Focus`
9. `Identity/Principle`

A commitment is a concrete owner taking concrete future work or a bounded outcome. "Anna / the lease / something off" is not one: it stays, with a question.

## How to decide

1. Read the input in full and keep the person's words. If it is an Inbox item, check that it is still in the Inbox and not in the trash; read what is already written on it, because your question may be there.
2. Read the Notion and GBrain context the decision needs, narrowly.
3. Classify it. The role decides, not the wording; when a phrase fits two levels, ask what the person means.
4. Look for an equivalent object of the matching type (an open Task, a Project, a Behavior System) before creating anything. An equivalent open one means no new one; a Task that is `Done`, `Canceled` or `Failed` is not equivalent. Search can lag behind a page created moments ago, so also query the Tasks data source by name (`schema_read` gives its identifier).
5. Set only the fields the person gave or the Task needs. Clarify until it is clear what the next action is, then stop: do not break down what the person already knows how to start.

## When it resolves

| Input | Resolution |
|---|---|
| A job doable now, with or without a deadline | Task `Next Action`, plus `Deadline` if there is one; no `Date` |
| A job for a planned day or moment ("pick up the parcel tomorrow") | Task `Scheduled` with a `Date` |
| Work that depends on someone or something outside | Task `Waiting For`; its `Date` is when to check; the Task's name and the comment say who or what it waits on |
| A possible future action nobody committed to | Task `Someday/Maybe`, worded as a future action or a decision trigger |
| An equivalent open Task exists | No new Task: close as `duplicate`, naming that Task |
| Non-actionable junk | Close as `trash` |
| An explicit fact the person stated | Close as `reference` |

A behavior that repeats is a Behavior System, not a Task. Its repetitions are Tasks the person creates, so do not create them yourself and do not make a recurring reminder Task in its place. "I ran today" records something that happened: it is not a Task.

What a Task carries:

- **Name**: what the Task is found by, short, in the person's wording and proper names. What it cannot hold goes into the comment.
- **Status**: by the reason the work is or is not available now, never by whether a date exists. A moment written in the input that means "do it then" is the `Date`; "finish by then" is the `Deadline`. If the wording is ambiguous ("Friday"), ask.
- **Links**: to a Project, Area of Focus or Key Result only when a real relation exists and the page is not in the trash (an Objective is reached through its Key Result); to a dependency only an existing Task that blocks this one. Do not require a link, and do not link to every level above.
- **Comment**: what the input turned out to be and, in a line, why that status and date.

Closing without a Task:

- `trash`: say in the comment what it was, so the person can recognise it in the trash. If you are unsure it is junk, it is not resolved: it stays.
- `duplicate`: a wrong call hides the item in the trash, so when in doubt it is not a duplicate: it stays, with a question.
- `reference`: record the fact (`memory.md`), and close once memory holds it: your record was accepted, or the fact was already stored. Until then, and when the fact is someone else's text, the item stays, with a comment.

## When it stays

| Input | What you say |
|---|---|
| Vague: no owner, action or outcome you can name | What is unclear and the one minimal question |
| Multi-step work | Suggest a Project, `Planning` or `Active` by readiness |
| Recurring behavior | Suggest a Behavior System |
| An ongoing responsibility, a desired change, an identity or a decision rule | Suggest an Area of Focus, an Objective/Key Result or an Identity/Principle |
| Input that would change an existing object (status, date, links) | Name the change and ask |
| An equivalent object exists that is not an open Task | Name that object and ask |
| A note, link or document the person wants kept (not an explicit fact) | Ask where they want it kept |
| Anything that needs the person's decision | The question |

When you suggest a higher-level object, state its type and why. If the person says yes, the item stays. Once a Project exists, the item becomes its first Task, linked to it. Nothing resolves an item into the other higher-level types, so say plainly that it stays until the person removes it. Do not use `trash`, `duplicate` or `reference` to make it disappear.

## The person's words

Keep what the person said as they said it: in the item, the Task name or the comment. Add your reading beside it, not instead of it. Do not edit the item's title or text. Read a long text in full.
