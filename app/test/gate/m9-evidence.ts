import type { WorkflowMode } from '../../src/generated/prisma/enums';
import type { TaskStatus } from '../../src/notion/semantics/canonical-status';
import type { Language } from '../../src/texts/language';
import type { SentButton } from './bot-api';
import type { Claim, ProposalView } from './gate-claims';
import type { Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import type { Evidence6 } from './m6-evidence';
import type { ScenarioInfo } from './m6-scenarios';
import type { Ids, IntakeView } from './scenario-world';

/**
 * What gate M9 sees of the approval chain live: delivered messages with their buttons, the press
 * and the answer to it, the page and the thread in Notion, the proposals. The M9 port (`M9Port`)
 * performs the steps; the model-free checks (`m9-preflight.ts`) and the claims (`m9-claims.ts`)
 * judge by this evidence.
 */

/** A message the App delivered to the person via the Bot API listener of the gate environment. */
export interface DeliveredMessage {
  readonly messageId: number;
  /** The outbox row it went out from: it shows whose packet this is. */
  readonly outboxId: string;
  /** The thread the person's reply lands in; `null` means a message without a thread. */
  readonly discussionId: string | null;
  readonly text: string;
  readonly keyboard: readonly (readonly SentButton[])[];
  /** The proposals the message carries, in packet order. */
  readonly proposals: readonly string[];
}

/** A message as it currently stands: how many times the App rewrote it and which buttons remain. */
export interface MessageNow {
  readonly messageId: number;
  readonly edits: number;
  readonly keyboard: readonly (readonly SentButton[])[];
}

/** What the person saw after pressing a button. */
export interface Pressed {
  /** Whether the message had a button with this intent for this proposal. */
  readonly pressable: boolean;
  /** The App's answer to the press; `null` if it did not answer or there was nothing to press. */
  readonly answer: string | null;
  /** The proposal's status when the answer is given: the decision is recorded first (`INV-023`). */
  readonly statusAtAnswer: string | null;
}

/** The person's words in the channel replying to a message: the event id and the App's answer. */
export interface ChannelWords {
  readonly eventId: string;
  /** What the App said to the person; empty means the words were accepted silently. */
  readonly answered: readonly string[];
}

/** A page in Notion: the stored property values, the readings and who edited it last. */
export interface PageState {
  /** Values of properties the person or the App writes, by canonical id; computed ones excluded. */
  readonly properties: Readonly<Record<string, string>>;
  /** The option id each status or select property holds: that is how `property_equals` reads it. */
  readonly optionIds: Readonly<Record<string, string | null>>;
  readonly lastEditedBy: string;
  readonly status: string | null;
  readonly date: string | null;
  readonly deadline: string | null;
}

/**
 * A thread comment as Notion returns it: the author, the text and the kind label it is shown
 * under.
 */
export interface ThreadComment {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly label: string | null;
}

/** A proposal precondition in words: the kind, the property and the value it reads. */
export interface ConditionView {
  readonly kind: string;
  readonly propertyId: string | null;
  readonly value: string | null;
}

/** A proposal with its state: effects, preconditions and thread. */
export interface ProposalState extends ProposalView {
  readonly preconditions: readonly ConditionView[];
  readonly discussionId: string | null;
}

/** Who is who in the gate's Notion: the integration bot and the owner of the personal token. */
export interface Editors {
  readonly bot: string;
  readonly person: string;
}

/** Evidence of an M9 run: the same as in M6, plus the proposals and deliveries it points to. */
export interface Evidence9 extends Evidence6 {
  /**
   * Proposals by the run's effects: new ones and existing ones that it proposed a second time.
   * Proposing the same change again returns the existing row, so they cannot be found by the
   * row's author.
   */
  readonly proposed: readonly ProposalState[];
  /** Outbox rows the run enqueued. */
  readonly deliveries: readonly string[];
}

/** A window opened by the person's words, ready for a run. */
export interface ClaimedWindow9 {
  readonly mode: WorkflowMode;
  /** The origin of the run: a reply in the channel (`channel_inbound`) or in a Notion thread. */
  readonly origin: string;
  readonly pageId: string;
  run(ids: Ids, step: string, residue: Residue): Promise<Evidence9>;
  /** Closes the window without a run: the gate does not evaluate what is in it. */
  close(): Promise<void>;
}

/** The words with which the system opens a thread, and the packet of the message about it. */
export interface SystemNotice {
  readonly thread: string;
  readonly noticed: string;
  readonly whyItMatters: string;
  readonly ask: string;
}

/**
 * A proposal the gate places on behalf of an evaluation run: to change the Task status while it
 * reads as `from`. The explanation opens the thread; the message carries the proposal line.
 */
export interface StatusProposal {
  readonly page: string;
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly notice: SystemNotice & { readonly line: string };
}

/** A proposal the gate placed, and the thread where it lives. */
export interface Proposed {
  readonly proposalId: string;
  readonly discussionId: string;
}

/** The person's edit of Task properties: a new status and a `Date` that many days ahead. */
export interface PersonEdit {
  readonly status?: TaskStatus;
  readonly dateInDays?: number;
}

/**
 * All the ways the checks and conductors of M9 touch the environment: the live world does it in
 * Notion, `app_db_gate` and the Bot API listeners; a test fake does it without them.
 */
export interface M9Port {
  begin(): Residue;
  clean(residue: Residue): Promise<readonly string[]>;
  /** The language the App writes to the person in: the gate reads its texts in the same one. */
  language(): Language;
  /** The day `inDays` from today in the App's time zone, `YYYY-MM-DD`. */
  day(inDays: number): string;
  /** The canonical id of the property that carries the slot (`task.deadline`). */
  propertyOf(slot: string): string;
  /**
   * Lists the `app_db_gate` rows that a delivery, executor or publication tick would claim. There
   * are none at the start of the suite; otherwise an attempt's tick would touch what is foreign.
   */
  foreignRows(): Promise<readonly string[]>;
  /** Waits for the Notion query allowance for a mode run, ahead of the world. */
  awaitAllowance(mode: WorkflowMode): Promise<void>;
  /** Builds the world of a model-free check. */
  build(pages: World, residue: Residue): Promise<Ids>;
  /** Builds the world of a scenario and verifies that it reads as intended. */
  buildWorld(pages: World, info: ScenarioInfo, residue: Residue): Promise<Ids>;
  editors(): Promise<Editors>;
  /** Creates a proposal on behalf of a run: the thread, the proposal row, its outbox message. */
  propose(ids: Ids, proposal: StatusProposal, residue: Residue): Promise<Proposed>;
  /** Creates a system thread on a page and the message about it, delivered to the person. */
  notify(ids: Ids, key: string, notice: SystemNotice, residue: Residue): Promise<DeliveredMessage>;
  /** Performs a tick of the delivery queue and returns what it delivered. */
  deliver(residue: Residue): Promise<readonly DeliveredMessage[]>;
  /** The person presses a proposal button; the gate presses only one that writes to its pages. */
  press(
    message: DeliveredMessage,
    kind: 'approve' | 'reject',
    proposalId: string,
    residue: Residue,
  ): Promise<Pressed>;
  messageNow(messageId: number): MessageNow;
  /** The person changes Task properties; the evaluation window it opened closes without a run. */
  personEdits(ids: Ids, key: string, edit: PersonEdit): Promise<IntakeView>;
  /** The person writes to the page body with no ingress event, becoming the last editor. */
  personEditsBody(ids: Ids, key: string): Promise<void>;
  personRepliesTo(message: DeliveredMessage, words: string): Promise<ChannelWords>;
  /** The person writes in a Notion thread; the comment event goes to the ingress. */
  personCommentsInThread(
    ids: Ids,
    key: string,
    discussionId: string,
    words: string,
  ): Promise<IntakeView>;
  claimWindow(eventId: string): Promise<ClaimedWindow9>;
  /** A thread continuation that a run placed comes due, and its run goes ahead. */
  wake(ids: Ids, key: string, discussionId: string, residue: Residue): Promise<Evidence9>;
  /** Performs an executor tick: the approved proposals and those the person could outpace. */
  executorTick(residue: Residue): Promise<void>;
  /** Performs a tick that publishes proposal fates. */
  publicationTick(residue: Residue): Promise<void>;
  pageState(ids: Ids, key: string): Promise<PageState>;
  threadComments(ids: Ids, key: string, discussionId: string): Promise<readonly ThreadComment[]>;
  proposal(id: string): Promise<ProposalState>;
}

/**
 * A conductor of an M9 scenario: the steps over the port in the built world and the claims from
 * them. `variant` is the number of the person's phrasings for this trial.
 */
export type M9Script = (
  port: M9Port,
  ids: Ids,
  residue: Residue,
  record: (evidence: Evidence9) => Evidence9,
  variant: number,
) => Promise<Claim>;
