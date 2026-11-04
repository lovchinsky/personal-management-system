import { HarnessError } from './gate-attempts';
import type { Claim } from './gate-claims';
import type { Residue } from './gate-cleanup';
import type { Conductor, Conductors } from './m6-conduct';
import { variantOf } from './m6-phrasing';
import { tagOf, variantNumber, worldOf } from './m6-scenarios';
import {
  approvedClaim,
  deadlineClaim,
  makes,
  notifiedProposals,
  outpacedClaim,
  proposedBy,
  rejectedClaim,
  unblockedClaim,
  type Settled,
} from './m9-claims';
import type {
  ChannelWords,
  DeliveredMessage,
  Evidence9,
  M9Port,
  M9Script,
  PageState,
} from './m9-evidence';
import {
  AP1_DONE,
  AP1_NOTICE,
  AP1_YES,
  AP2_NOTICE,
  AP2_NOW,
  AP2_SCHEDULED_IN_DAYS,
  AP2_START,
  AP3_PROPOSAL,
  AP4_MOVE,
  AP4_MOVED_IN_DAYS,
  AP4_NOTICE,
  AP5_NOTICE,
  M9_MODEL_MODE,
  spokenDate,
  type M9ScenarioId,
} from './m9-scenarios';
import { pageOf, type Ids } from './scenario-world';

/**
 * Conductors of the gate M9 scenarios, with the steps of each over the M9 port and the claims drawn
 * from them. After every run comes an executor tick: a proposal the run left must await the
 * person's decision (criterion 1).
 *
 * A scenario goes on only when the step before yielded what the next one rests on. A press on a
 * proposal the model composed wrongly would judge the App for a change that is not its own.
 */

/** Reads the state after an executor tick: the proposal's status (if any) and the Task page. */
async function settledOf(
  port: M9Port,
  ids: Ids,
  key: string,
  proposalId: string | undefined,
): Promise<Settled> {
  return {
    status: proposalId === undefined ? null : (await port.proposal(proposalId)).status,
    page: await port.pageState(ids, key),
  };
}

/**
 * Conducts a run of the window opened by the person's words in the channel, if the App took them,
 * and otherwise returns `null`.
 */
async function runOn(
  port: M9Port,
  said: ChannelWords,
  ids: Ids,
  step: string,
  residue: Residue,
  record: (evidence: Evidence9) => Evidence9,
): Promise<Evidence9 | null> {
  if (said.answered.length > 0) return null;

  return record(await (await port.claimWindow(said.eventId)).run(ids, step, residue));
}

/**
 * Returns the thread of a system message, because the gate sends the person only messages with a
 * thread.
 */
function threadOf(message: DeliveredMessage): string {
  if (message.discussionId === null) {
    throw new HarnessError(`the message ${message.messageId} was delivered without its thread`);
  }

  return message.discussionId;
}

/** Finds the delivered message of a run that carries the proposal. */
const messageOf = (
  delivered: readonly DeliveredMessage[],
  run: Evidence9,
  proposalId: string,
): DeliveredMessage | null =>
  delivered.find(
    (message) =>
      run.deliveries.includes(message.outboxId) && message.proposals.includes(proposalId),
  ) ?? null;

/** Looks up what became of the messages that carry the proposal. */
const nowOf = (port: M9Port, delivered: readonly DeliveredMessage[], proposalId: string) =>
  delivered
    .filter((message) => message.proposals.includes(proposalId))
    .map((message) => port.messageNow(message.messageId));

/** Steps the scenario did not reach. */
const NOT_REACHED = {
  afterFirst: null,
  firstMessage: null,
  thread: [],
  messages: [],
  afterSecond: null,
  second: null,
} as const;

const approved: M9Script = async (port, ids, residue, record, variant) => {
  const key = 'badges';
  const message = await port.notify(ids, key, AP1_NOTICE, residue);
  const base = {
    language: port.language(),
    editors: await port.editors(),
    task: pageOf(ids, key),
    statusProperty: port.propertyOf('task.status'),
    conversation: threadOf(message),
    before: await port.pageState(ids, key),
    done: await port.personRepliesTo(message, variantOf(AP1_DONE, variant)),
  };
  const stopped = { ...NOT_REACHED, yes: null, pressed: null, executed: null };
  const first = await runOn(port, base.done, ids, 'reply', residue, record);

  if (first === null) return approvedClaim({ ...base, ...stopped, first });

  await port.executorTick(residue);

  const [proposal] = proposedBy(first);
  const afterFirst = await settledOf(port, ids, key, proposal?.id);
  const delivered = [...(await port.deliver(residue))];
  const firstMessage = proposal === undefined ? null : messageOf(delivered, first, proposal.id);
  const reached = { ...stopped, first, afterFirst, firstMessage };

  if (
    proposal === undefined ||
    firstMessage === null ||
    !makes(proposal, base.task, { [base.statusProperty]: 'Done' })
  ) {
    return approvedClaim({ ...base, ...reached });
  }

  const yes = await port.personRepliesTo(firstMessage, variantOf(AP1_YES, variant));
  const second = await runOn(port, yes, ids, 'confirm', residue, record);

  if (second === null) return approvedClaim({ ...base, ...reached, yes });

  await port.executorTick(residue);

  const afterSecond = await settledOf(port, ids, key, proposal.id);

  delivered.push(...(await port.deliver(residue)));

  // The press is on the notification of run 2 if it carries the proposal, otherwise on that of
  // run 1: that is how a proposal from an earlier conversation is decided in a new one (session).
  const pressed = await port.press(
    messageOf(delivered, second, proposal.id) ?? firstMessage,
    'approve',
    proposal.id,
    residue,
  );

  await port.executorTick(residue);

  const executed = await settledOf(port, ids, key, proposal.id);

  await port.publicationTick(residue);

  return approvedClaim({
    ...base,
    first,
    afterFirst,
    firstMessage,
    yes,
    second,
    afterSecond,
    pressed,
    executed,
    thread:
      proposal.discussionId === null
        ? []
        : await port.threadComments(ids, key, proposal.discussionId),
    messages: nowOf(port, delivered, proposal.id),
  });
};

const outpaced: M9Script = async (port, ids, residue, record, variant) => {
  const key = 'report';
  const message = await port.notify(ids, key, AP2_NOTICE, residue);
  const statusProperty = port.propertyOf('task.status');
  const dateProperty = port.propertyOf('task.date');
  const base = {
    language: port.language(),
    editors: await port.editors(),
    task: pageOf(ids, key),
    statusProperty,
    dateProperty,
    conversation: threadOf(message),
    before: await port.pageState(ids, key),
    start: await port.personRepliesTo(message, variantOf(AP2_START, variant)),
  };
  const stopped = {
    ...NOT_REACHED,
    edit: null,
    edited: null,
    outpaced: null,
    comment: null,
    origin: null,
  };
  const first = await runOn(port, base.start, ids, 'reply', residue, record);

  if (first === null) return outpacedClaim({ ...base, ...stopped, first });

  await port.executorTick(residue);

  const [proposal] = proposedBy(first);
  const afterFirst = await settledOf(port, ids, key, proposal?.id);
  const delivered = await port.deliver(residue);
  const firstMessage = proposal === undefined ? null : messageOf(delivered, first, proposal.id);
  const reached = { ...stopped, first, afterFirst, firstMessage };

  if (
    proposal === undefined ||
    firstMessage === null ||
    !makes(proposal, base.task, { [statusProperty]: 'Next Action', [dateProperty]: 'clear' })
  ) {
    return outpacedClaim({ ...base, ...reached });
  }

  const edit = await port.personEdits(ids, key, {
    status: 'Scheduled',
    dateInDays: AP2_SCHEDULED_IN_DAYS,
  });
  const edited = await port.pageState(ids, key);

  await port.executorTick(residue);

  const outpacedState = await settledOf(port, ids, key, proposal.id);

  await port.publicationTick(residue);

  const thread = await port.threadComments(ids, key, base.conversation);
  const messages = nowOf(port, delivered, proposal.id);
  const comment = await port.personCommentsInThread(
    ids,
    key,
    base.conversation,
    variantOf(AP2_NOW, variant),
  );
  const done = {
    ...base,
    ...reached,
    edit,
    edited,
    outpaced: outpacedState,
    thread,
    messages,
    comment,
  };

  if (!comment.windowed) return outpacedClaim(done);

  const window = await port.claimWindow(comment.eventId);
  const second = record(await window.run(ids, 'thread', residue));

  await port.executorTick(residue);

  const [next] = proposedBy(second).filter((other) => other.id !== proposal.id);

  return outpacedClaim({
    ...done,
    origin: window.origin,
    second,
    afterSecond: await settledOf(port, ids, key, next?.id),
  });
};

const rejected: M9Script = async (port, ids, residue, record) => {
  const key = 'movers';
  const before = await port.pageState(ids, key);
  const { proposalId, discussionId } = await port.propose(ids, AP3_PROPOSAL, residue);
  const delivered = await port.deliver(residue);
  const message = delivered.find((candidate) => candidate.proposals.includes(proposalId));
  const pressed =
    message === undefined
      ? { pressable: false, answer: null, statusAtAnswer: null }
      : await port.press(message, 'reject', proposalId, residue);

  await port.executorTick(residue);

  const afterReject = await settledOf(port, ids, key, proposalId);

  await port.publicationTick(residue);

  const thread = await port.threadComments(ids, key, discussionId);
  const run = record(await port.wake(ids, key, discussionId, residue));

  await port.executorTick(residue);

  return rejectedClaim({
    language: port.language(),
    rejected: await port.proposal(proposalId),
    delivered,
    pressed,
    before,
    afterReject,
    thread,
    run,
    notified: await Promise.all(notifiedProposals(run).map((id) => port.proposal(id))),
  });
};

const deadline: M9Script = async (port, ids, residue, record, variant) => {
  const key = 'copy';
  const message = await port.notify(ids, key, AP4_NOTICE, residue);
  const before: PageState = await port.pageState(ids, key);
  const target = port.day(AP4_MOVED_IN_DAYS);
  const said = await port.personRepliesTo(
    message,
    variantOf(AP4_MOVE, variant)(spokenDate(target, port.day(0))),
  );
  const run = await runOn(port, said, ids, 'reply', residue, record);

  if (run !== null) await port.executorTick(residue);

  const [proposal] = run === null ? [] : proposedBy(run);

  return deadlineClaim({
    task: pageOf(ids, key),
    deadlineProperty: port.propertyOf('task.deadline'),
    target,
    before,
    said,
    run,
    afterRun: run === null ? null : await settledOf(port, ids, key, proposal?.id),
  });
};

const unblocked: M9Script = async (port, ids, residue, record) => {
  const key = 'movers';
  const message = await port.notify(ids, key, AP5_NOTICE, residue);
  const before = await port.pageState(ids, key);
  const run = record(await port.wake(ids, key, threadOf(message), residue));

  await port.executorTick(residue);

  const [proposal] = proposedBy(run);

  return unblockedClaim({
    task: pageOf(ids, key),
    statusProperty: port.propertyOf('task.status'),
    before,
    run,
    afterRun: await settledOf(port, ids, key, proposal?.id),
  });
};

const SCRIPTS: Readonly<Record<M9ScenarioId, M9Script>> = {
  AP1_proposal_approved: approved,
  AP2_outpaced_reproposed: outpaced,
  AP3_rejected_kept: rejected,
  AP4_deadline_instruction: deadline,
  AP5_unblocked_proposed: unblocked,
};

/**
 * Returns the M9 conductors bound to the port. The harness conducts them like the rest of the
 * procedures.
 */
export function m9Conductors(port: M9Port): Conductors {
  return Object.fromEntries(
    Object.entries(SCRIPTS).map(([id, script]): [string, Conductor] => [
      id,
      async (info, attempt, residue, record): Promise<Claim> => {
        const mode = M9_MODEL_MODE[info.id];

        if (mode !== undefined) await port.awaitAllowance(mode);

        const ids = await port.buildWorld(worldOf(info.id, tagOf(attempt)), info, residue);

        return script(
          port,
          ids,
          residue,
          (evidence) => {
            record(evidence);

            return evidence;
          },
          variantNumber(attempt),
        );
      },
    ]),
  );
}
