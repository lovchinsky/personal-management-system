import { callbackDataOf } from '../../src/delivery/channels/telegram/callback-data';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import type { Language } from '../../src/texts/language';
import { textsOf as catalogOf } from '../../src/texts/texts';
import { common } from './claim-parts';
import {
  claimOf,
  effect,
  holds,
  observed,
  perimeter,
  sameId,
  type Claim,
  type Observation,
} from './gate-claims';
import { steps } from './m6-claims';
import type {
  ChannelWords,
  ConditionView,
  DeliveredMessage,
  Editors,
  Evidence9,
  MessageNow,
  PageState,
  Pressed,
  ProposalState,
  ThreadComment,
} from './m9-evidence';
import type { IntakeView } from './scenario-world';

/**
 * Claims of gate M9: what the model-free checks of the approval chain and the scenarios AP1–AP4
 * prove. The App enforces the chain, so its observations are `perimeter`. The model's choice —
 * what it proposed and whom it told — is `effect`.
 */

/** The state after an executor tick: the status of the proposal (`null` if none) and the page. */
export interface Settled {
  readonly status: string | null;
  readonly page: PageState;
}

/** A proposal effect as a claim compares it: the page, the property and the value in words. */
interface Change {
  readonly page: string;
  readonly property: string;
  readonly value: string;
}

/** Returns a proposal's effects in property order, so two proposals for one change coincide. */
function changesOf(proposal: Pick<ProposalState, 'effects'>): Change[] {
  return proposal.effects
    .map((item) => ({
      page: canonicalNotionId(item.pageId),
      property: item.propertyId,
      value: item.value,
    }))
    .sort((a, b) => a.property.localeCompare(b.property));
}

/** Builds the expected change on a page: effects in the same order as `changesOf`. */
function expectedChanges(page: string, values: Readonly<Record<string, string>>): Change[] {
  return Object.entries(values)
    .map(([property, value]) => ({ page: canonicalNotionId(page), property, value }))
    .sort((a, b) => a.property.localeCompare(b.property));
}

/** Checks whether the proposal is exactly this change on a page: the value per property. */
export function makes(
  proposal: Pick<ProposalState, 'effects'>,
  page: string,
  values: Readonly<Record<string, string>>,
): boolean {
  return JSON.stringify(changesOf(proposal)) === JSON.stringify(expectedChanges(page, values));
}

/** Selects the data of the message buttons that lead to the proposal. The data is “kind:id”. */
function buttonsFor(
  keyboard: readonly (readonly { readonly data: string }[])[],
  proposalId: string,
): string[] {
  return keyboard
    .flat()
    .map((button) => button.data)
    .filter((data) => data.endsWith(`:${proposalId}`));
}

/** Checks whether the message has both decision buttons for the proposal. */
function offersDecision(message: DeliveredMessage, proposalId: string): boolean {
  const data = buttonsFor(message.keyboard, proposalId);

  return (['approve', 'reject'] as const).every((kind) =>
    data.includes(callbackDataOf({ kind, pendingActionId: proposalId })),
  );
}

/** Checks whether the message is rewritten and no longer has the proposal's buttons. */
function settledIn(message: MessageNow, proposalId: string): boolean {
  return message.edits > 0 && buttonsFor(message.keyboard, proposalId).length === 0;
}

/** Lists the properties whose values differ between two states of the page. */
function changedProperties(before: PageState, after: PageState): string[] {
  const ids = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);

  return [...ids].filter((id) => before.properties[id] !== after.properties[id]).sort();
}

/** Selects the comments of a thread under a kind label. */
const labelled = (thread: readonly ThreadComment[], label: string): ThreadComment[] =>
  thread.filter((comment) => comment.label === label);

/**
 * Checks whether a precondition reads the property as it is on the page, the way the App checks it:
 * `property_equals` by option id, `property_reads_as` by the canonical reading.
 */
function reads(
  condition: ConditionView,
  page: PageState,
  property: string,
  reading: string | null,
): boolean {
  if (condition.propertyId !== property) return false;

  switch (condition.kind) {
    case 'property_equals':
      return condition.value !== null && condition.value === page.optionIds[property];

    case 'property_reads_as':
      return condition.value === reading;

    case 'property_empty':
      return reading === null;

    default:
      return false;
  }
}

/** Selects the messages that carry the proposal. */
const carrying = (messages: readonly DeliveredMessage[], proposalId: string): DeliveredMessage[] =>
  messages.filter((message) => message.proposals.includes(proposalId));

/** Observes whether the proposal is delivered and every message with it has both buttons. */
function deliveredWithButtons(messages: readonly DeliveredMessage[], id: string): Observation {
  const shown = carrying(messages, id);

  return holds(
    'the proposal is delivered with its approve and reject buttons',
    shown.length > 0 && shown.every((message) => offersDecision(message, id)),
  );
}

/** Observes whether every message with the proposal is rewritten without its buttons. */
function buttonsGone(messages: readonly MessageNow[], id: string): Observation {
  return holds(
    'every message with the proposal is rewritten without its buttons',
    messages.length > 0 && messages.every((message) => settledIn(message, id)),
  );
}

// ---------------------------------------------------------------------------
// Model-free checks
// ---------------------------------------------------------------------------

/**
 * The approval chain: proposal, delivery, tick, the person's body edit, press, tick, publication.
 */
interface ChainSteps {
  readonly language: Language;
  readonly editors: Editors;
  readonly statusProperty: string;
  /** The status the proposal writes. */
  readonly to: string;
  readonly proposalId: string;
  readonly delivered: readonly DeliveredMessage[];
  readonly before: PageState;
  readonly firstTick: Settled;
  readonly bodyEdited: PageState;
  readonly pressed: Pressed;
  readonly afterPress: PageState;
  readonly secondTick: Settled;
  /** The remaining pages of the world, before the press and after the tick. */
  readonly others: readonly { readonly before: PageState; readonly after: PageState }[];
  readonly thread: readonly ThreadComment[];
  readonly messages: readonly MessageNow[];
}

export function chainClaim(steps: ChainSteps): Claim {
  const { labels } = catalogOf(steps.language).comments;
  const { answers } = catalogOf(steps.language).telegram;
  const { before, firstTick, secondTick } = steps;

  return claimOf(
    perimeter(
      deliveredWithButtons(steps.delivered, steps.proposalId),
      observed('the first executor tick leaves the proposal waiting', 'proposed', firstTick.status),
      observed('the first tick writes nothing', [], changedProperties(before, firstTick.page)),
      observed(
        'the body edit makes the person the last editor',
        steps.editors.person,
        steps.bodyEdited.lastEditedBy,
      ),
      observed(
        'the press is answered once the approval is recorded',
        'approved',
        steps.pressed.statusAtAnswer,
      ),
      observed(
        'the answer to the press says it is approved',
        answers.approved,
        steps.pressed.answer,
      ),
      observed(
        'nothing is written before the executor tick',
        { changed: [], editor: steps.editors.person },
        {
          changed: changedProperties(before, steps.afterPress),
          editor: steps.afterPress.lastEditedBy,
        },
      ),
      observed('the executor tick executes the approved proposal', 'executed', secondTick.status),
      observed(
        'the page differs by exactly the effect of the contract',
        [steps.statusProperty],
        changedProperties(before, secondTick.page),
      ),
      observed('the page reads the effect', steps.to, secondTick.page.status),
      observed('the bot is the last editor', steps.editors.bot, secondTick.page.lastEditedBy),
      observed(
        'the other pages of the world are untouched',
        [],
        steps.others.flatMap((page) => changedProperties(page.before, page.after)),
      ),
      observed(
        'one trace of the approval under the decision label',
        1,
        labelled(steps.thread, labels.proposalDecision).length,
      ),
      observed('no not-written trace', 0, labelled(steps.thread, labels.proposalResult).length),
      buttonsGone(steps.messages, steps.proposalId),
    ),
  );
}

/** The person outpaces the proposal: proposal, delivery, the person's edit, tick, publication. */
interface OutpaceSteps {
  readonly language: Language;
  readonly editors: Editors;
  readonly proposalId: string;
  readonly delivered: readonly DeliveredMessage[];
  readonly edit: IntakeView;
  /** The status the person set. */
  readonly personStatus: string;
  readonly tick: Settled;
  readonly thread: readonly ThreadComment[];
  readonly messages: readonly MessageNow[];
}

export function outpaceClaim(steps: OutpaceSteps): Claim {
  const { labels } = catalogOf(steps.language).comments;
  const traces = [labels.proposalDecision, labels.proposalResult];

  return claimOf(
    perimeter(
      deliveredWithButtons(steps.delivered, steps.proposalId),
      holds('the edit of the person reaches the intake', steps.edit.windowed),
      observed('the proposal closes as conflict without a press', 'conflict', steps.tick.status),
      observed(
        'the page keeps what the person wrote, and the bot writes nothing',
        { status: steps.personStatus, editor: steps.editors.person },
        { status: steps.tick.page.status, editor: steps.tick.page.lastEditedBy },
      ),
      observed(
        'no trace is written in the thread',
        [],
        steps.thread
          .filter((comment) => comment.label !== null && traces.includes(comment.label))
          .map((comment) => comment.text),
      ),
      buttonsGone(steps.messages, steps.proposalId),
    ),
  );
}

/**
 * What was approved is not written: proposal, delivery, press, the person's edit, tick,
 * publication.
 */
interface NotWrittenSteps {
  readonly language: Language;
  readonly editors: Editors;
  readonly proposalId: string;
  readonly delivered: readonly DeliveredMessage[];
  readonly pressed: Pressed;
  readonly personStatus: string;
  readonly tick: Settled;
  readonly thread: readonly ThreadComment[];
  readonly messages: readonly MessageNow[];
}

export function notWrittenClaim(steps: NotWrittenSteps): Claim {
  const { labels, proposal } = catalogOf(steps.language).comments;

  return claimOf(
    perimeter(
      deliveredWithButtons(steps.delivered, steps.proposalId),
      observed(
        'the press is answered once the approval is recorded',
        'approved',
        steps.pressed.statusAtAnswer,
      ),
      observed('the approved proposal ends in conflict', 'conflict', steps.tick.status),
      observed(
        'the page keeps what the person wrote, and the bot writes nothing',
        { status: steps.personStatus, editor: steps.editors.person },
        { status: steps.tick.page.status, editor: steps.tick.page.lastEditedBy },
      ),
      observed(
        'one trace of the approval under the decision label',
        1,
        labelled(steps.thread, labels.proposalDecision).length,
      ),
      observed(
        'one not-written trace under the result label, naming the change of the page',
        [true],
        labelled(steps.thread, labels.proposalResult).map((comment) =>
          comment.text.includes(proposal.reasons.conflict),
        ),
      ),
      buttonsGone(steps.messages, steps.proposalId),
    ),
  );
}

/** The person's reply in the channel to a delivered message with a thread. */
export interface ChannelSteps {
  readonly language: Language;
  readonly editors: Editors;
  /** The page of the thread. */
  readonly page: string;
  readonly words: string;
  readonly said: ChannelWords;
  /** The window the words opened; `null` if none was opened. */
  readonly window: { readonly pageId: string; readonly origin: string } | null;
  readonly thread: readonly ThreadComment[];
}

/** Selects the bot's comments in the thread that carry the person's words. */
const quoted = (steps: ChannelSteps): ThreadComment[] =>
  steps.thread.filter(
    (comment) => comment.author === steps.editors.bot && comment.text.includes(steps.words),
  );

export function channelClaim(steps: ChannelSteps): Claim {
  return claimOf(
    perimeter(
      observed('the App takes the reply without answering', [], steps.said.answered),
      observed(
        'the reply opens a window of a reply in the channel on the page of the thread',
        { page: true, origin: 'channel_inbound' },
        {
          page: steps.window !== null && sameId(steps.window.pageId, steps.page),
          origin: steps.window?.origin ?? null,
        },
      ),
      observed('the words land in the thread as a comment of the bot', 1, quoted(steps).length),
    ),
  );
}

/**
 * The kind label under which Notion shows the person's words from the channel is a separate
 * observation.
 */
export function channelLabelClaim(steps: ChannelSteps): Claim {
  const { labels } = catalogOf(steps.language).comments;

  return claimOf(
    perimeter(
      observed(
        'the quoted words carry the label of a reply from Telegram',
        [labels.channelReply('Telegram')],
        quoted(steps).map((comment) => comment.label),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Scenarios with the model
// ---------------------------------------------------------------------------

/**
 * Returns the proposals of a run, by distinct id: a repeated reference to the same proposal counts
 * as one.
 */
export const proposedBy = (run: Evidence9): ProposalState[] =>
  run.proposed.filter(
    (proposal, index) => run.proposed.findIndex((other) => other.id === proposal.id) === index,
  );

/** Checks whether a notification of the run carries the proposal. */
const notifies = (run: Evidence9, proposalId: string): boolean =>
  run.written.notices.some((notice) =>
    (notice.proposals ?? []).some((line) => line.pendingActionId === proposalId),
  );

/** Returns the ids of the proposals that the notifications of the run carry. */
export const notifiedProposals = (run: Evidence9): string[] =>
  run.written.notices.flatMap((notice) =>
    (notice.proposals ?? []).map((line) => line.pendingActionId),
  );

/**
 * Observes that after the run the executor tick wrote nothing: the proposal waits, the page is the
 * same (criterion 1).
 */
function waitsAfterTick(before: PageState, tick: Settled): Observation[] {
  return perimeter(
    ...(tick.status === null
      ? []
      : [observed('after the executor tick the proposal still waits', 'proposed', tick.status)]),
    observed('nothing is written to the page', [], changedProperties(before, tick.page)),
  );
}

/**
 * Observes that the proposal lives in the conversation thread, because the trail of the person's
 * decision on it lands there.
 */
const inThread = (proposal: ProposalState | undefined, conversation: string): Observation =>
  holds(
    'the proposal lives in the thread of the conversation',
    proposal?.discussionId != null && sameId(proposal.discussionId, conversation),
  );

/**
 * Builds a claim for a step the scenario did not reach, because the step before it did not yield
 * what it rests on.
 */
const unreachedStep = (what: string): Claim => claimOf(holds(what, false));

/**
 * AP1: “done” in the channel → a proposal; “yes” to the notification → not a decision; a button →
 * a write.
 */
interface ApprovedSteps {
  readonly language: Language;
  readonly editors: Editors;
  readonly task: string;
  readonly statusProperty: string;
  /** The conversation thread: the person replies to the system's message in it. */
  readonly conversation: string;
  readonly before: PageState;
  readonly done: ChannelWords;
  readonly first: Evidence9 | null;
  readonly afterFirst: Settled | null;
  /** The message that carries the proposal of run 1; `null` if none was delivered. */
  readonly firstMessage: DeliveredMessage | null;
  readonly yes: ChannelWords | null;
  readonly second: Evidence9 | null;
  readonly afterSecond: Settled | null;
  readonly pressed: Pressed | null;
  readonly executed: Settled | null;
  readonly thread: readonly ThreadComment[];
  readonly messages: readonly MessageNow[];
}

export function approvedClaim(s: ApprovedSteps): Claim {
  const { labels } = catalogOf(s.language).comments;
  const taken = (said: ChannelWords): Observation =>
    observed('the App takes the words without answering', [], said.answered);

  if (s.first === null) return steps(['reply', claimOf(perimeter(taken(s.done)))]);

  const first = s.first;
  const made = proposedBy(first);
  const [proposal] = made;
  const firstClaim = claimOf(
    common(first),
    perimeter(taken(s.done)),
    effect(
      observed('exactly one proposal', 1, made.length),
      observed(
        'the proposal marks only the task Done',
        expectedChanges(s.task, { [s.statusProperty]: 'Done' }),
        proposal === undefined ? null : changesOf(proposal),
      ),
      inThread(proposal, s.conversation),
      holds(
        'the notification carries the proposal',
        proposal !== undefined && notifies(first, proposal.id),
      ),
    ),
    effect(
      holds(
        'the notification lives in the thread of the conversation',
        s.firstMessage?.discussionId != null && sameId(s.firstMessage.discussionId, s.conversation),
      ),
    ),
    perimeter(
      holds(
        'the delivered notification offers both buttons',
        proposal !== undefined &&
          s.firstMessage !== null &&
          offersDecision(s.firstMessage, proposal.id),
      ),
    ),
    s.afterFirst === null ? [] : waitsAfterTick(s.before, s.afterFirst),
  );

  if (proposal === undefined || s.yes === null || s.second === null || s.afterSecond === null) {
    return steps(
      ['run 1', firstClaim],
      ['run 2', unreachedStep('the person answers yes to the notification')],
    );
  }

  const second = s.second;
  const secondClaim = claimOf(
    common(second),
    perimeter(taken(s.yes)),
    effect(
      observed(
        'no new proposal',
        [],
        proposedBy(second)
          .filter((other) => other.id !== proposal.id)
          .map((other) => other.id),
      ),
      holds('the notification carries the same proposal', notifies(second, proposal.id)),
    ),
    waitsAfterTick(s.before, s.afterSecond),
  );
  const decided =
    s.pressed === null || s.executed === null
      ? unreachedStep('the person presses approve')
      : claimOf(
          perimeter(
            observed(
              'the press on the proposal of run 1 is answered once the approval is recorded',
              'approved',
              s.pressed.statusAtAnswer,
            ),
            observed('the executor tick executes it', 'executed', s.executed.status),
            observed(
              'the page differs by exactly the effect',
              [s.statusProperty],
              changedProperties(s.before, s.executed.page),
            ),
            observed('the page reads Done', 'Done', s.executed.page.status),
            observed('the bot is the last editor', s.editors.bot, s.executed.page.lastEditedBy),
            observed(
              'one trace of the approval under the decision label',
              1,
              labelled(s.thread, labels.proposalDecision).length,
            ),
            observed('no not-written trace', 0, labelled(s.thread, labels.proposalResult).length),
            buttonsGone(s.messages, proposal.id),
          ),
        );

  return steps(['run 1', firstClaim], ['run 2', secondClaim], ['approval', decided]);
}

/**
 * AP2: “I can get started” → a proposal; the person outpaces it; “let's do it now” → a new
 * proposal.
 */
interface OutpacedSteps {
  readonly language: Language;
  readonly editors: Editors;
  readonly task: string;
  readonly statusProperty: string;
  readonly dateProperty: string;
  /**
   * The conversation thread: the person replies in it through the channel, then writes in
   * Notion.
   */
  readonly conversation: string;
  readonly before: PageState;
  readonly start: ChannelWords;
  readonly first: Evidence9 | null;
  readonly afterFirst: Settled | null;
  readonly firstMessage: DeliveredMessage | null;
  readonly edit: IntakeView | null;
  /** The page after the person's edit: `Scheduled` and a new date. */
  readonly edited: PageState | null;
  readonly outpaced: Settled | null;
  readonly thread: readonly ThreadComment[];
  readonly messages: readonly MessageNow[];
  readonly comment: IntakeView | null;
  /** The origin of the run on the words in the thread. */
  readonly origin: string | null;
  readonly second: Evidence9 | null;
  readonly afterSecond: Settled | null;
}

export function outpacedClaim(s: OutpacedSteps): Claim {
  const { labels } = catalogOf(s.language).comments;
  const traces = [labels.proposalDecision, labels.proposalResult];
  const change = expectedChanges(s.task, {
    [s.statusProperty]: 'Next Action',
    [s.dateProperty]: 'clear',
  });

  if (s.first === null) {
    return steps([
      'reply',
      claimOf(
        perimeter(observed('the App takes the words without answering', [], s.start.answered)),
      ),
    ]);
  }

  const first = s.first;
  const made = proposedBy(first);
  const [proposal] = made;
  const firstClaim = claimOf(
    common(first),
    perimeter(observed('the App takes the words without answering', [], s.start.answered)),
    effect(
      observed('exactly one proposal', 1, made.length),
      observed(
        'the proposal makes the task a Next Action and clears its Date in one contract',
        change,
        proposal === undefined ? null : changesOf(proposal),
      ),
      inThread(proposal, s.conversation),
      holds(
        'the notification carries the proposal',
        proposal !== undefined && notifies(first, proposal.id),
      ),
    ),
    s.afterFirst === null ? [] : waitsAfterTick(s.before, s.afterFirst),
  );

  if (
    proposal === undefined ||
    s.edit === null ||
    s.edited === null ||
    s.outpaced === null ||
    s.firstMessage === null
  ) {
    return steps(
      ['run 1', firstClaim],
      ['outpaced', unreachedStep('the person outpaces the proposal')],
    );
  }

  const edited = s.edited;
  const outpacedClaim = claimOf(
    perimeter(
      holds('the edit of the person reaches the intake', s.edit.windowed),
      observed('the proposal closes as conflict without a press', 'conflict', s.outpaced.status),
      observed(
        'the page keeps what the person wrote',
        [],
        changedProperties(edited, s.outpaced.page),
      ),
      observed(
        'no trace is written in the thread',
        [],
        s.thread
          .filter((comment) => comment.label !== null && traces.includes(comment.label))
          .map((comment) => comment.text),
      ),
      buttonsGone(s.messages, proposal.id),
    ),
  );

  if (s.comment === null || s.second === null || s.afterSecond === null) {
    return steps(
      ['run 1', firstClaim],
      ['outpaced', outpacedClaim],
      ['run 2', unreachedStep('the person asks again in the thread')],
    );
  }

  const second = s.second;
  const fresh = proposedBy(second).filter((other) => other.id !== proposal.id);
  const [next] = fresh;
  const secondClaim = claimOf(
    common(second),
    perimeter(
      holds('the words in the thread reach the intake', s.comment.windowed),
      observed('the run answers a reply in the thread', 'managed_discussion_reply', s.origin),
    ),
    effect(
      observed('exactly one new proposal', 1, fresh.length),
      observed(
        'the new proposal makes the same change',
        change,
        next === undefined ? null : changesOf(next),
      ),
      inThread(next, s.conversation),
      holds(
        'the notification carries the new proposal',
        next !== undefined && notifies(second, next.id),
      ),
    ),
    perimeter(
      holds(
        'the conditions of the new proposal read the page as the person left it',
        next !== undefined &&
          next.preconditions.some((condition) =>
            reads(condition, edited, s.statusProperty, edited.status),
          ) &&
          next.preconditions.some((condition) =>
            reads(condition, edited, s.dateProperty, edited.date),
          ),
      ),
      ...waitsAfterTick(edited, s.afterSecond),
    ),
  );

  return steps(['run 1', firstClaim], ['outpaced', outpacedClaim], ['run 2', secondClaim]);
}

/** AP3: the person rejected the system's proposal, nothing new; the recheck comes due. */
interface RejectedSteps {
  readonly language: Language;
  readonly rejected: ProposalState;
  readonly delivered: readonly DeliveredMessage[];
  readonly pressed: Pressed;
  readonly before: PageState;
  readonly afterReject: Settled;
  readonly thread: readonly ThreadComment[];
  readonly run: Evidence9;
  /** The proposals that the notifications of the run carry, with their effects. */
  readonly notified: readonly ProposalState[];
}

/**
 * Checks whether the proposal carries the change: every effect of the change is among the
 * proposal's effects. The same change together with another one counts too.
 */
function carries(candidate: Pick<ProposalState, 'effects'>, change: readonly Change[]): boolean {
  const own = changesOf(candidate).map((item) => JSON.stringify(item));

  return change.every((item) => own.includes(JSON.stringify(item)));
}

export function rejectedClaim(s: RejectedSteps): Claim {
  const { labels } = catalogOf(s.language).comments;
  const repeated = (proposals: readonly ProposalState[]): string[] =>
    proposals
      .filter((proposal) => carries(proposal, changesOf(s.rejected)))
      .map((proposal) => proposal.id);

  return steps(
    [
      'rejection',
      claimOf(
        perimeter(
          deliveredWithButtons(s.delivered, s.rejected.id),
          observed('the press rejects the proposal', 'rejected', s.pressed.statusAtAnswer),
          observed(
            'the rejected proposal writes nothing',
            [],
            changedProperties(s.before, s.afterReject.page),
          ),
          observed(
            'one trace of the rejection under the decision label',
            1,
            labelled(s.thread, labels.proposalDecision).length,
          ),
        ),
      ),
    ],
    [
      'recheck',
      claimOf(
        common(s.run),
        effect(
          observed('the run proposes the rejected change no more', [], repeated(proposedBy(s.run))),
          observed('no notification carries the rejected change', [], repeated(s.notified)),
        ),
      ),
    ],
  );
}

/** AP5, the AP3 control: the same world without a rejection; the recheck comes due. */
interface UnblockedSteps {
  readonly task: string;
  readonly statusProperty: string;
  readonly before: PageState;
  readonly run: Evidence9;
  readonly afterRun: Settled;
}

export function unblockedClaim(s: UnblockedSteps): Claim {
  const change = expectedChanges(s.task, { [s.statusProperty]: 'Next Action' });
  const moving = proposedBy(s.run).filter((proposal) => carries(proposal, change));

  return claimOf(
    common(s.run),
    effect(
      observed('one proposal moves the task to Next Action', 1, moving.length),
      holds(
        'the notification carries it',
        moving.some((proposal) => notifies(s.run, proposal.id)),
      ),
    ),
    waitsAfterTick(s.before, s.afterRun),
  );
}

/**
 * AP4: “move the deadline to <date>” → exactly this proposal, the precondition is the current
 * deadline.
 */
interface DeadlineSteps {
  readonly task: string;
  readonly deadlineProperty: string;
  /** The date the person named, `YYYY-MM-DD`. */
  readonly target: string;
  readonly before: PageState;
  readonly said: ChannelWords;
  readonly run: Evidence9 | null;
  readonly afterRun: Settled | null;
}

export function deadlineClaim(s: DeadlineSteps): Claim {
  if (s.run === null) {
    return claimOf(
      perimeter(observed('the App takes the words without answering', [], s.said.answered)),
    );
  }

  const made = proposedBy(s.run);
  const [proposal] = made;

  return claimOf(
    common(s.run),
    perimeter(observed('the App takes the words without answering', [], s.said.answered)),
    effect(
      observed('exactly one proposal', 1, made.length),
      observed(
        'the proposal moves exactly the Deadline to the named date',
        expectedChanges(s.task, { [s.deadlineProperty]: s.target }),
        proposal === undefined ? null : changesOf(proposal),
      ),
      holds(
        'the notification carries the proposal',
        proposal !== undefined && notifies(s.run, proposal.id),
      ),
    ),
    perimeter(
      holds(
        'a condition reads the present Deadline',
        proposal !== undefined &&
          proposal.preconditions.some((condition) =>
            reads(condition, s.before, s.deadlineProperty, s.before.deadline),
          ),
      ),
    ),
    s.afterRun === null ? [] : waitsAfterTick(s.before, s.afterRun),
  );
}
