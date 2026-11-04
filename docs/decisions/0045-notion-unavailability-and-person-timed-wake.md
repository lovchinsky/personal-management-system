# ADR 0045 — Notion unavailability and a time the person named

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D45` |
| **Related** | ADR 0012 · ADR 0018 · ADR 0025 · ADR 0036 · ADR 0042 · ADR 0044 · `INV-037` · `INV-084` · `INV-105` · `INV-108` · `INV-109` · `INV-301` · `GAP-25` · `GAP-35` · `GAP-41` · `GAP-42` · `GAP-46` |

## Context

The person says “remind me on Monday” and the App schedules a `user_snooze` wake. The person also named the deadline date, and the `deadline_followup` wake ahead of it is likewise the person's time; the person configured the review schedule. Neither the budget nor quiet hours stop such runs: failing silently to return to the person what they asked for is the worst kind of failure.

A time the person named is lost in two ways:

- **Notion cannot be read at the time of the run.** One rule both for judging and for fulfilling a request that has already been made — infer nothing and defer itself with a continuation whose reason is `await_external_event` — would turn the person's snooze into an ordinary system check, and the reminder would not arrive; a deadline check would become autonomous, and the limit, the breaker and quiet hours would stop it. A review that read nothing would stay silent and be closed as carried out, so the message about a review that did not take place (`INV-105`) would not fire. The person's reply in the channel, which the App wrote to the thread and the run did not read, would be left unanswered. The retry would then depend on whether the model schedules a continuation and with what reason — a separate rule for each kind of run.
- **No run happens at all.** Claude is unavailable, the process crashes — after the attempt limit the row is retired as `failed`, and without a separate step nobody tells the person anything.

## Decision

**The App retries a run that did not reach Notion — the same run.** In such a run the Skill infers nothing and writes nothing: the result is the reserved label `source_unreadable`, and the App decides what follows. The App trusts the label only when it sees the fact itself, and it has three pieces of evidence:

- the refresh of the Notion MCP access failed with a refusal that clears on its own: network, timeout, HTTP 5xx or 429 (`ConnectorUnavailableError`);
- init stopped the run solely because the Notion server does not respond (`failed`, `pending`); revoked access and a disabled server do not clear on their own, and that is a failure (`INV-301`);
- the run returned `source_unreadable`, and at least one of its Notion calls failed while none succeeded.

The writes of such a run are discarded, the attempt is returned, and the origin row waits by a mark, not by its time: the time stays the one the person or the rule named (`INV-084`). The pause is twice the time the row has already waited consecutively, from 15 minutes to an hour: 15, 30, then hourly. A short failure passes within minutes, and a long one is unlikely to pass in the minutes that follow, so more frequent attempts would spend the plan quota and access refreshes on something that has not passed yet. A row that has waited a day since its first deferral no longer waits: an ordinary failure follows, which the breaker sees, and that is a signal of a prolonged stop. The limit is set by time, not by count, and is the same as for the retries of an approved action on a temporary failure (ADR 0044): the person feels time, not attempts.

Only this row waits: it does not occupy the head of its group, and other rows carry on as usual. The wait is lifted by a change to the row — a moved continuation, a person's event folded into the window — and by a run that reached Notion: it lifts the pauses of the rows, each at most once per its consecutive wait. A row that again fails to reach Notion while Notion is answering others most likely has a fault of its own and waits out its own pause. The time of each row's first deferral is kept until a run of the row itself reaches Notion: a row that still does not reach it keeps its day running. The grant protects access to Notion for the duration of a failure: after a refusal that clears on its own, for two minutes runs get the same refusal without calling the provider — every refresh rotates the refresh token, and a lost response to it would kill the grant.

**A person's snooze does not wait.** A snooze run that did not reach Notion is a failure with the flag for an unavailable Notion, which the breaker does not count: there is no pause, and the attempts follow one another. If Notion recovers between them, the reminder goes out in an ordinary run; if not, past the attempt limit, a few minutes later, the App tells the person (below). A deadline check waits like all the others, with its own reason.

**A person who replied in the channel is not met with silence.** The evaluation window of the reply waits, and the App queues one message in the same thread: Notion is unavailable, and the answer will come as soon as it is back. A window that has waited a day yields a second one: the answer could not be given, write again. Both break through quiet hours, and their keys are in their own namespace and are not the run's key: the real answer after recovery will not be dropped as a repeat (ADR 0025). A reply that could not even be written to Notion because of a refusal that clears on its own does not open a window: the App at once answers in the channel that Notion is unavailable and the reply should be sent again a bit later, and the receipt is settled with a reason. If that answer fails too, the receipt fails, and the provider's redelivery will either record the person's words or tell the person again.

**A trigger page that is not found is an answer, not an error.** Notion answered that the page does not exist or is not open to the integration: there is no retry, because it would never end, and the run ends with `no_action` — this includes a reminder or a reply to the person about such a page. A secondary page that Notion cannot find does not stop the run.

**The Skill knows only its own part.** The model needs to know one thing in every run: if Notion was not read, write nothing and return `source_unreadable`; if the page does not exist, `no_action`. Everything the person is told in these cases is written by the App.

**The App itself shows the person a wake that did not take place** (`INV-108`). The continuations worker takes a `failed` wake whose time the person named and calls the `WakeFailureNotice` port; the adapter in delivery queues a system message: which reminder or deadline check did not take place, and for what time, with the thread and a link to the page. The list of reasons is the same classifier that exempts runs from the budget and quiet hours, so a reason added without a decision will not compile. The delivery key is the one the run of this wake would have set (ADR 0025): a reminder that the run managed to queue before it failed stays the only one. `failure_noticed_at` marks what the person has been told, as for a review occurrence (`INV-105`).

**Rejected:**

- **A retry by a continuation that the Skill schedules.** The retry would depend on the model: whether it schedules one, and with what reason, would be a separate rule for each kind of run, and each rule a new chance to go wrong. The App sees the failure, and one mechanism retries the same run for all the run queues.
- **A shared run gate “Notion unavailable”, as there is for the plan quota.** A single page whose read fails, or a failure that flickers, would stop all runs, snoozes included, and only a separate probe request could open the gate. A mark on the row holds back exactly the row that did not reach Notion.
- **Trusting the `source_unreadable` label without evidence.** A false label would defer the row without end.
- **A limit by the number of deferrals, not by time.** The person feels how long a failure lasts as time; a count under a growing pause is an opaque way of saying the same thing.
- **Provider redelivery for a reply that could not be recorded.** The redelivery would arrive at a random time, and a person who has been told nothing would not know whether their words arrived.
- **Pushing the snooze back until Notion answers.** The reminder would come late precisely when the person is waiting for it.
- **Notifying the person about every `failed` wake.** The system chose the time of the rest: the run trace reports them, and the signal for stuck work is `GAP-25`.
- **Having the Skill produce the reminder and the reply to the person without Notion.** A rule for a rare case would sit in the context of every run and dilute the model's attention, and the reminder would duplicate what the App tells the person anyway within a few minutes (`INV-108`).
- **Fitting the rules into the first-read limit of the reviews by moving them where there is room or by shortening others.** The size, not the subject, would decide where a rule goes, and what was shortened would change behavior that has already been verified. The first-read limit of the Strategic Review accommodates these rules, and the explanation is in the test of `INV-037`.

## Consequences

- The three run queues (`scheduled_checks`, `evaluation_windows`, `review_occurrences`) have `notion_hold_until` and `notion_held_since`; the run-row rules supply the “wait for Notion” disposition, and the lease-based queue supplies the condition under which a due row is not claimed at the moment (`platform/queue/`). The pause and the limit are in `contracts/canonical.yaml`, key `scheduled_check.notion_hold`.
- The ledger has the flag `notion_unavailable`; a reset time (`deferred_until`) belongs only to the plan quota. The breaker does not count flagged runs, and the daily limit counts deferrals that reached the model.
- `scheduled_checks` carries `failure_noticed_at`.
- The ports `WakeFailureNotice` (`continuations/`) and `NotionWaitNotice` (`runs/`); the adapters are in `delivery/delivery-notices.module.ts`. The text catalog has `notices.wakeFailure`, `notices.notionWait` and the channel reply `notRecorded`.

## Cost

- A failure of the Notion API alone — the MCP server connects while the calls fail — takes every attempt through to the model. Autonomous rows are stopped by the daily limit; those exempt from it — the deadline check, the window of the person's reply, the review — try hourly for up to a day, and every attempt is a run that spends the plan quota.
- A model whose Notion calls all failed for another reason receives the same deferral: the row waits a day instead of failing once, and the person in the channel is told a false “Notion is unavailable”.
- A deadline check that waits may not be done in time for the deadline itself if the failure is longer.
- Runs go one at a time: a start that fails at init occupies the slot while the MCP servers connect, and a snooze may have to wait behind it.
- A reminder whose run did not reach Notion arrives not from a run but as an App message a few minutes later; the message does not name the matter, and the person recognizes the matter by the thread and the link.
- A person whose reply was never read within a day, or could not be recorded, writes a second time. A long reply of which Notion managed to accept only a part lands in the thread twice after it is sent again. A person who writes a second time just when the run of their window, which has waited a day, is under way may immediately get “write again”.
- A reply by comment in Notion and an Inbox item that have waited a day fail without a message: the person was speaking in Notion, and the signal for stuck work is `GAP-25`.
- An OAuth refusal with a code that is not in the standard is returned by the SDK as a “server error” with no code or status, and the App reads it as a failure that will pass: rows wait a day before the breaker sees a failure.
- A reminder, a reply to the person and a deadline check on a page that Notion cannot find end silently: a deleted page cannot be told apart from a page to which Claude has lost access, and lost access is `GAP-41`.
- A reply in the channel that Notion will never accept — the thread or the page has been deleted, or the integration has been denied access — is lost silently: the provider redelivers until it gives up (`GAP-46`).
- The link is built from the page id, without reading: the message will still mention a page the person has already closed or thrown away.
- A wake that the runner is not ready to start does not move to `failed` and gives no message (`GAP-42`).
- The Skill's behavior in a run that did not reach Notion is not verified live by the gate (`GAP-35`).
