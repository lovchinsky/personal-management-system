# The result of a run

Every run ends with one JSON object: what you concluded and on what evidence. It does nothing by itself: a comment, follow-up, proposal, notification or conversion happens because you called its capability. The object has exactly the keys below and no others. If it is not valid, none of your App writes counts.

| Field | Form | Required |
|---|---|---|
| `outcome` | non-empty string | yes |
| `operating_phase` | array of at least one phase | yes |
| `scope` | object with `object_type` and `object_id`, both non-empty strings | yes |
| `detections` | array, may be empty | yes |
| `user_facing_or_notification_message` | non-empty string | only when needed |

## outcome

A short snake_case label for what the run concluded. `no_action` means you wrote nothing and nothing needs doing: empty `detections`, no message, no App write. Otherwise label the main result: `inbox_item_resolved`, `question_asked`, `reply_posted`, `attention_raised`, `proposal_made`, `recheck_scheduled`, `fact_recorded`, `problem_resolved`, or `source_unreadable` when Notion could not be read, `effect_unavailable` when a capability you have could not complete the call. Another label of the same kind is fine when none of these fits. Never a label that claims an effect the run did not produce. A run that resolved an Inbox item, or only wrote a comment, or only wrote to GBrain, is not `no_action`; its `detections` stay empty when no attention label fits.

## operating_phase

The phases of the loop your run went through, each exactly as written. Any other string, or an empty array, is invalid.

| Phase | What it covers |
|---|---|
| `Capture` | save the input |
| `Clarify` | decide whether it is actionable, its object type, and the Task status if a Task is made; a question to the person belongs here |
| `Organize & Align` | put it in the right object and set the relations that matter |
| `Engage` | choose and show what to do now |
| `Reflect` | re-read current state; find stale or inconsistent commitments |
| `Adapt` | change something on evidence: a comment, a proposal or a follow-up |

## scope

The narrowest object, Inbox item or thread at the centre of the situation, required even when `detections` is empty. `object_type` is the canonical type name: Identity, Area of Focus, Objective, Key Result, Project, Behavior System, Task or Inbox item. `object_id` is the identifier as you read it in this run, or the trigger's `page_id` when Notion could not be read. For a thread, name the object it is attached to. A review has no single object: its `scope` is `Review` with the trigger's `event_id`.

## detections

One item per claim, possibly none. Every field is required.

| Field | Content |
|---|---|
| `type` | one attention label from `knowledge/detectors.md`, verbatim |
| `claim` | what you assert, in one sentence a person could check |
| `why_now` | the concrete reason it matters now; if you cannot name one, there is no detection |
| `evidence` | array of `{ "server", "ref" }`: `server` is `notion`, `gbrain` or `app`, whichever you read the object through; `ref` is its identifier exactly as that read returned it |
| `counterevidence_checked` | what could have refuted or weakened the claim, stated concretely, and that you looked |
| `uncertainties` | what you could not settle: an unread body, a field that is absent or empty, an unavailable GBrain, several GBrain pages for one object, an assumption; `[]` when there is nothing |

Every `ref` must be an object you read in this run through a tool of the named server. Do not cite from memory, from an earlier run, from an identifier you only saw inside a comment, or from a guessed address. One `ref` you did not read invalidates the whole result, not just that detection.

## user_facing_or_notification_message

Put here what the run said to the person in its own words: the notification's `noticed`, `why_it_matters` and `ask` joined in that order when it queued one, otherwise the comment's text. Omit it when the run wrote nothing to the person, or only a conversion's or a close's comment. An empty string is invalid. The field delivers nothing: the person receives only what `comment_write` or `delivery_write` carries.

## Example

Every id is a placeholder for an identifier you read in this run. The frames show the results that are typical for them. When nothing needs doing:

```json
{
  "outcome": "no_action",
  "operating_phase": ["Reflect"],
  "scope": { "object_type": "Task", "object_id": "<Task id>" },
  "detections": []
}
```
