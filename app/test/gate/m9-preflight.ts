import type { Claim } from './gate-claims';
import type { Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import { checked, type Check } from './m6-preflight';
import type { ScenarioId, ScenarioInfo } from './m6-scenarios';
import {
  chainClaim,
  channelClaim,
  channelLabelClaim,
  notWrittenClaim,
  outpaceClaim,
  type ChannelSteps,
  type Settled,
} from './m9-claims';
import type {
  DeliveredMessage,
  M9Port,
  MessageNow,
  Pressed,
  StatusProposal,
  SystemNotice,
} from './m9-evidence';
import { brand, task } from './scenario-kit';
import { pageOf, type Ids } from './scenario-world';

/**
 * Checks of gate M9 that need neither the model nor the query allowance: the approval chain live —
 * a proposal on behalf of a run, delivery through the Bot API listener, a press on the gate's own
 * webhook, an edit by the person with a personal token, executor and publication ticks. The App
 * enforces what they prove, so everything is `perimeter`. Each blocks the scenarios that would have
 * nothing to prove without it. The checks that block nothing still run, because their verdict is
 * part of the evidence for the M9 criteria.
 *
 * The steps go through the port; what follows from them is judged by the claims of `m9-claims.ts`.
 */

/** Returns the selected scenarios among the named ones. */
const among = (selected: readonly ScenarioInfo[], ids: readonly ScenarioId[]): ScenarioId[] =>
  selected.filter((info) => ids.includes(info.id)).map((info) => info.id);

/**
 * Builds the world of a check: a `Next Action` Task in a Project; the names contain the run and the
 * check.
 */
function checkWorld(run: string, check: string): World {
  const tag = brand(`pre${run}-${check}`);

  return [
    { key: 'project', type: 'project', name: `Перевірка схвалення «${tag}»`, status: 'Active' },
    task({
      key: 'task',
      name: `Задача перевірки схвалення «${tag}»`,
      status: 'Next Action',
      project: 'project',
    }),
  ];
}

const CHECK_NOTICE: SystemNotice = {
  thread: 'Gate: система питає про цю задачу',
  noticed: 'Gate: задача перевірки ланцюга схвалення',
  whyItMatters: 'Gate перевіряє шлях пропозиції без моделі',
  ask: 'Відповідати не треба',
};

/** The proposal of a check: mark the Task done. */
const CHECK_PROPOSAL: StatusProposal = {
  page: 'task',
  from: 'Next Action',
  to: 'Done',
  notice: { ...CHECK_NOTICE, line: 'Gate: позначити задачу перевірки виконаною' },
};

/** The status the person sets, outpacing the proposal. */
const PERSON_STATUS = 'Waiting For';

/** The person's words in the channel. */
const CHANNEL_WORDS = 'Gate: відповідь людини в каналі';

/** A press that did not happen: the proposal was not delivered. */
const NOT_PRESSED: Pressed = { pressable: false, answer: null, statusAtAnswer: null };

/** Builds the verdict of a check: what holds in it. A failure is what did not hold. */
function verdictOf(claim: Claim): { readonly ok: boolean; readonly detail: unknown } {
  return { ok: claim.ok, detail: claim.observations.filter((observation) => !observation.ok) };
}

/** Reads the state after an executor tick: the status of the proposal and the Task page. */
async function settled(port: M9Port, ids: Ids, proposalId: string): Promise<Settled> {
  return {
    status: (await port.proposal(proposalId)).status,
    page: await port.pageState(ids, 'task'),
  };
}

/** Looks up the messages with the proposal as they currently stand. */
const nowOf = (
  port: M9Port,
  delivered: readonly DeliveredMessage[],
  proposalId: string,
): MessageNow[] =>
  delivered
    .filter((message) => message.proposals.includes(proposalId))
    .map((message) => port.messageNow(message.messageId));

/** Presses a button of the message that carries the proposal. */
async function pressOn(
  port: M9Port,
  delivered: readonly DeliveredMessage[],
  kind: 'approve' | 'reject',
  proposalId: string,
  residue: Residue,
): Promise<Pressed> {
  const message = delivered.find((candidate) => candidate.proposals.includes(proposalId));

  return message === undefined ? NOT_PRESSED : port.press(message, kind, proposalId, residue);
}

/**
 * Checks that the queues the M9 ticks take rows from contain nothing foreign. Otherwise an
 * attempt's tick would touch foreign rows.
 */
async function isolationCheck(port: M9Port, selected: readonly ScenarioInfo[]): Promise<Check> {
  const foreign = await port.foreignRows();

  return {
    check:
      'app_db_gate holds no row the delivery queue, the executor or the publication would take',
    ok: foreign.length === 0,
    detail: foreign,
    blocks: selected.map((info) => info.id),
  };
}

/**
 * Checks the approval chain: the tick before the press writes nothing; the press records the
 * decision before the answer; the tick writes exactly the effect of the contract on behalf of the
 * bot; the proposal fate follows, in the thread and as a rewritten message. The person edits the
 * body before the press, so the editor can be seen after the tick.
 */
function chainCheck(port: M9Port, selected: readonly ScenarioInfo[], run: string): Promise<Check> {
  return checked(
    port,
    'an approved proposal is written by the bot exactly as proposed, and only after the press',
    among(selected, ['AP1_proposal_approved', 'AP3_rejected_kept']),
    async (residue) => {
      const ids = await port.build(checkWorld(run, 'chain'), residue);
      const editors = await port.editors();
      const before = await port.pageState(ids, 'task');
      const project = await port.pageState(ids, 'project');
      const { proposalId, discussionId } = await port.propose(ids, CHECK_PROPOSAL, residue);
      const delivered = await port.deliver(residue);

      await port.executorTick(residue);

      const firstTick = await settled(port, ids, proposalId);

      await port.personEditsBody(ids, 'task');

      const bodyEdited = await port.pageState(ids, 'task');
      const pressed = await pressOn(port, delivered, 'approve', proposalId, residue);
      const afterPress = await port.pageState(ids, 'task');

      await port.executorTick(residue);

      const secondTick = await settled(port, ids, proposalId);
      const projectAfter = await port.pageState(ids, 'project');

      await port.publicationTick(residue);

      return verdictOf(
        chainClaim({
          language: port.language(),
          editors,
          statusProperty: port.propertyOf('task.status'),
          to: CHECK_PROPOSAL.to,
          proposalId,
          delivered,
          before,
          firstTick,
          bodyEdited,
          pressed,
          afterPress,
          secondTick,
          others: [{ before: project, after: projectAfter }],
          thread: await port.threadComments(ids, 'task', discussionId),
          messages: nowOf(port, delivered, proposalId),
        }),
      );
    },
  );
}

/**
 * Checks the case where the person outpaced the proposal: it closes as `conflict` with no press and
 * no thread trail.
 */
function outpaceCheck(
  port: M9Port,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check> {
  return checked(
    port,
    'a proposal the person outpaced closes as conflict with no press and no trace',
    among(selected, ['AP2_outpaced_reproposed']),
    async (residue) => {
      const ids = await port.build(checkWorld(run, 'outpace'), residue);
      const editors = await port.editors();
      const { proposalId, discussionId } = await port.propose(ids, CHECK_PROPOSAL, residue);
      const delivered = await port.deliver(residue);
      const edit = await port.personEdits(ids, 'task', { status: PERSON_STATUS });

      await port.executorTick(residue);

      const tick = await settled(port, ids, proposalId);

      await port.publicationTick(residue);

      return verdictOf(
        outpaceClaim({
          language: port.language(),
          editors,
          proposalId,
          delivered,
          edit,
          personStatus: PERSON_STATUS,
          tick,
          thread: await port.threadComments(ids, 'task', discussionId),
          messages: nowOf(port, delivered, proposalId),
        }),
      );
    },
  );
}

/**
 * Checks that an approved proposal the person outpaced before the tick is not written. It leaves
 * the trail of the decision and the trail of the result.
 */
function notWrittenCheck(port: M9Port, run: string): Promise<Check> {
  return checked(
    port,
    'an approved proposal the person outpaced before the tick is not written, and the thread says why',
    [],
    async (residue) => {
      const ids = await port.build(checkWorld(run, 'unwritten'), residue);
      const editors = await port.editors();
      const { proposalId, discussionId } = await port.propose(ids, CHECK_PROPOSAL, residue);
      const delivered = await port.deliver(residue);
      const pressed = await pressOn(port, delivered, 'approve', proposalId, residue);

      await port.personEdits(ids, 'task', { status: PERSON_STATUS });
      await port.executorTick(residue);

      const tick = await settled(port, ids, proposalId);

      await port.publicationTick(residue);

      return verdictOf(
        notWrittenClaim({
          language: port.language(),
          editors,
          proposalId,
          delivered,
          pressed,
          personStatus: PERSON_STATUS,
          tick,
          thread: await port.threadComments(ids, 'task', discussionId),
          messages: nowOf(port, delivered, proposalId),
        }),
      );
    },
  );
}

/**
 * Checks the person's reply in the channel to a delivered message: the App accepts it silently,
 * puts the words in the thread as a comment of the bot and opens a window. The kind label of that
 * comment is a separate check, because it is for the person and blocks nothing.
 */
async function channelChecks(
  port: M9Port,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check[]> {
  const seen: { steps?: ChannelSteps } = {};
  const main = await checked(
    port,
    'a reply in the channel lands in its thread as a comment of the bot and opens a window',
    among(selected, [
      'AP1_proposal_approved',
      'AP2_outpaced_reproposed',
      'AP4_deadline_instruction',
    ]),
    async (residue) => {
      const ids = await port.build(checkWorld(run, 'channel'), residue);
      const editors = await port.editors();
      const message = await port.notify(ids, 'task', CHECK_NOTICE, residue);
      const said = await port.personRepliesTo(message, CHANNEL_WORDS);
      const window = said.answered.length === 0 ? await port.claimWindow(said.eventId) : null;

      await window?.close();

      seen.steps = {
        language: port.language(),
        editors,
        page: pageOf(ids, 'task'),
        words: CHANNEL_WORDS,
        said,
        window,
        thread:
          message.discussionId === null
            ? []
            : await port.threadComments(ids, 'task', message.discussionId),
      };

      return verdictOf(channelClaim(seen.steps));
    },
  );
  const check = 'the words of the person from the channel carry the label of a reply from Telegram';
  const label: Check =
    seen.steps === undefined
      ? { check, blocks: [], ok: false, detail: 'the reply in the channel was not made' }
      : { check, blocks: [], ...verdictOf(channelLabelClaim(seen.steps)) };

  return [main, label];
}

/** How many model-free checks the M9 suite has: their table in `infra/GATE.md` has as many rows. */
export const M9_CHECK_COUNT = 6;

/**
 * Runs the checks of the M9 suite in order: first the isolation of the queues, while no check has
 * enqueued anything, then the chain. All of them run, because those that block no selected
 * scenario prove the criteria.
 */
export async function m9Checks(
  port: M9Port,
  selected: readonly ScenarioInfo[],
  run: string,
): Promise<Check[]> {
  return [
    await isolationCheck(port, selected),
    await chainCheck(port, selected, run),
    await outpaceCheck(port, selected, run),
    await notWrittenCheck(port, run),
    ...(await channelChecks(port, selected, run)),
  ];
}
