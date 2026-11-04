# ADR 0033 — A label's mode is a contract key; the schema holds the result's content; shadow is not raised

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D33` |
| **Related** | ADR 0027 · ADR 0048 · `INV-035` · `INV-036` · `INV-039` · `INV-083` · `INV-210` · `GAP-06` |

## Context

The detector layer is the Skill's instructions and the validation of their result; there is no detector algorithm in the code. Labels have different modes: the system raises some itself, others belong to Inbox items or the review packet, and the rest stay shadow (`docs/3-policy.md` § “Proactive scope”). The contract names the list of labels (`detector_labels`); if each label's mode lived only in policy prose and Skill text, nothing would catch a divergence between them.

The result schema must also constrain the content. `INV-210` requires every proactive detection to have both evidence that was read and a named counterevidence check. The model invents labels outside the list (`prompt_injection`, `behavior_system_candidate`) and writes `outcome` as prose: only the schema can stop such a result before the write.

## Decision

**Each label's mode is the contract key `detector_activation`, the schema checks the content of the result, and a shadow label is neither raised nor written.**

- The key is an exhaustive map of `detector_labels` onto `proactive`, `inbox_review`, `review_packet` or `shadow`: the broadest mode in which the label may be raised. The bounds of the forms within a label (“narrow”, “high-confidence”, “structural”) are not values of the key: policy defines them, and the Skill applies it. The key has a consumer that measures behavior: gate M6 derives from it the observation “a label that an event run does not raise has not been raised”; a test enforces the agreement of the Skill's action table with the key and of the policy prose with it.
- The result schema: `type` is a value of `detector_labels` (an enum); `evidence` and `counterevidence_checked` are non-empty, and so are their elements; `outcome` is snake_case. The CLI checks `enum`, `minItems` and `pattern` and returns a violation to the model as a tool error, so the run corrects the result instead of failing at once. Field descriptions go into the same schema, so the model sees them in the tool schema.
- The list of labels and their modes are constants in the code, because the running App does not read the contracts (ADR 0048); a test enforces their agreement with the contract and the Skill's (`claims.md`) agreement with the key.
- Shadow means that an autonomous run does not raise the category: no effect and no write; when the person leads the conversation, it is a conversation, not a finding.

**Rejected:**

- **A guard in the run classifier** (“only shadow labels — no effects”). It can be built in two ways, and both are wrong. Tied to the person's words, it would wrongly fail legitimate runs: a reminder for a time the person named arrives in `scheduled_check`, which has none of the person's words. Tied to the absence of effects, it would wrongly fail a Daily Control that carries a delivery. Both are bypassed with empty `detections`, and a series of the resulting failures opens the breaker, which counts runs of any origin.
- **A `disposition` field in a detection.** The mode is a property of the label, not of the run: a field that the model fills in would let it revise the allocation every time, and the schema would have nothing to check it against.
- **Recording shadow findings for eval.** Metrics per label need rows (`INV-083`), while `detections` sit in the result as a document; a record with no consumer would cost reads on every event. That is for the eval dataset design to decide (`GAP-06`).

## Consequences

- A run that invents a label or submits empty evidence learns of it in the same run. Each rejection costs a model round.
- A gate run's result passes the same schema, so the gate's instructions carry a real label and a non-empty counterevidence check.
- A new label mode is a single change to the key, the code, the policy, the Skill and the test together.
- The mode in the code is the constant `DETECTOR_ACTIVATION` (`app/src/claude/result/detector-labels.ts`), which the gate reads; it does not check a run: a run that raises a label that does not belong to the run's mode gets a negative gate observation, not a refusal.

## Cost

- A strict schema makes drift in the form expensive: exhausted attempts fail the run, and a series of consecutive failures opens the breaker (`contracts/canonical.yaml`, key `run_budget`).
- A non-empty `counterevidence_checked` does not yet mean a concrete check: that stays with eval (`INV-210`).
- Shadow categories leave no examples for eval until the design of the dataset settles it.
