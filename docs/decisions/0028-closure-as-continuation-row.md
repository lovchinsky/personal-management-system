# ADR 0028 — Thread closure — its own place in the continuation queue

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D28` |
| **Related** | ADR 0014 · ADR 0018 · ADR 0035 · ADR 0038 · `INV-019` · `INV-020` · `INV-089` · `INV-095` · `INV-096` · `INV-204` |

## Context

A thread managed by the system has been resolved, and it needs processing: to establish how the matter ended and to decide whether anything in it is worth remembering (`closure_processing`). What must be woken is the closure of **the thread that was resolved**. An evaluation window will not do for this: there is one per page, and the envelope carries only the last thread of that window's events, so a closure could point at the wrong thread or conflate two. `scheduled_checks` is the only queue whose cardinality is the thread.

The place “one open continuation per thread” in that queue, however, is built for a wake: “wake the thread at time T”, where a new request moves the existing row, together with its reason. A closure is not a point in time but an obligation derived from state (“the thread is resolved, it needs processing”). In the shared place it would compete with all the others. A repeated request would move a row that is already going into a run, and that run would execute a second time with a second write to GBrain. Any later wake — by the model, by a person's snooze, by a step of the closure itself — would silently overwrite it. The closure itself would overwrite `deadline_followup`, a time the person named that is exempt from the budget. Priority rules in a single place would arbitrate a conflict that should not exist, and each has a counterexample: “the closure yields to everything” postpones the recording of the decision until the day of a needless check; “a wake displaces the closure” loses the obligation derived from state but keeps the one that is not derived from it — and which of the two is needed depends on whether the thread has been reopened.

A closure writes to memory without the person. The policy forbids autonomous lessons and edits to compiled truth (`docs/3-policy.md` § “Closure processing and memory policy”), and a proposal cannot carry an effect into GBrain, so the boundary of what the mode can do must live in its toolset, not in the text of the frame.

## Decision

**Thread closure is a row of the continuation queue with its own place; whoever finds the thread resolved requests it through `ContinuationsService.requestClosure`.**

- Two partial unique indexes apply to a thread: at most one open wake and at most one open closure. By construction, neither moves the other's row. The class rule — `resolution_reconciliation` against all other reasons — lives in `continuations/reason-class.ts` as a record over the whole list of reasons (a new reason without a decision is a compile error) and in the index predicates; an integration test over all pairs of reasons keeps the two copies in agreement.
- `requestClosure` only inserts a row, due immediately. When an open closure already exists, the request changes nothing, including a row that is going into a run: the response is `already_requested`. A new resolution after a completed closure is a new closure.
- A row with this reason wakes `closure_processing`, not a recheck: the envelope has the same shape as a continuation's (`INV-020`), and the mode names the class of the reason.
- Only the App sets the reason: no step that requests a continuation — run or chat — names it, and the wire schema does not offer it (`INV-095`).
- The model does not see closures: `get_continuation_state` shows wakes. An open closure counts as the system's engagement with the thread: a thread with an open closure is managed (`INV-089`).
- The mode's toolset: Notion `read`, GBrain `read`, App `memory` and `introspection` (`INV-096`). The mode's only write is the memory intent `record_memory`: an event, a decision or a fact of the person's, with its source, lands on the object's anchor as the App decides (ADR 0035). The mode does not comment, schedule continuations, notify or propose changes, because it cannot; lessons and edits to compiled truth are not written autonomously.
- The frame describes the closed set rather than contradicting the general `acting.md`: that file is not among the mode's reads, and the frame carries what it needs from it itself. `detections` in this mode are always empty.
- The reconciliation of resolved threads (ADR 0038) requests the closure: Notion sends no resolve event, so the time-based reconciliation finds a resolved thread. It calls the same `requestClosure` as the gate does.

## Consequences

- The `closure_processing` mode is dispatched: `run_frames` and `DISPATCHED_MODES` name it, the App builds the closure envelope, and the run entry has a frame and a router row.
- A closure spends the daily limit as an autonomous run does: it is a reaction of the system, not the person's words.
- The seam between wake rows and closure rows guarantees idempotency while the closure is open. The reconciliation (ADR 0038) remembers what is “processed”: after a completed closure it requests a new one only when the thread has been seen open again, and it does not repeat a failed closure.

## Cost

- A wake does not disappear with the closure. `user_snooze` and `deadline_followup`, which are exempt from the budget, can fire on a resolved thread, and a recheck over it costs one run that finds nothing.
- The wake and the closure of one thread do not overlap only because runs go one at a time (`run_budget`, field `concurrency`): raised concurrency would let them run in parallel.
