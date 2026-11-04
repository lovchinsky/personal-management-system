import type { WorkflowMode } from '../../src/generated/prisma/enums';
import type { ReviewMode } from '../../src/runs/trigger-envelope';
import type { Claim } from './gate-claims';
import type { Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import type { Evidence6, Notice } from './m6-evidence';
import type { ScenarioInfo } from './m6-scenarios';
import type { FixtureKey } from './m8-fixtures';
import type { MemoryPage } from './scenario-kit';
import type { Ids, IntakeView, NotionEventInput } from './scenario-world';

/**
 * What gate M8 sees of the steps of its scenarios: the evidence of a review or wake run, the ticks
 * of the sweep and the reconciliation, the ingress window. The M8 scenario port (`M8Port`)
 * performs the steps; the claims (`m8-claims.ts`) judge by this evidence.
 */

/**
 * A notification packet as the person will see it: fields, attached thread, and the text and
 * buttons of the channel.
 */
export interface DeliveredPacket {
  readonly notice: Notice;
  /** The thread the person's reply to the packet lands in; `null` means no thread. */
  readonly discussionId: string | null;
  /** The message as the channel will render it. */
  readonly text: string;
  /** Button captions: a row per proposal that awaits a decision. */
  readonly buttons: readonly (readonly string[])[];
}

/** Evidence of an M8 run: the same as in M6, plus packets, new threads and seeded items. */
export interface Evidence8 extends Evidence6 {
  readonly packets: readonly DeliveredPacket[];
  /** Threads this run opened: they were not in the registry before it. */
  readonly newThreads: readonly string[];
  /** Seeded stale Inbox items: the page id by key. */
  readonly fixtures: Readonly<Record<FixtureKey, string>>;
}

/** A wake placed by a sweep tick: the continuation row and the page it wakes. */
export interface Woken {
  readonly checkId: string;
  readonly pageId: string;
}

/** What the reconciliation remembers about a thread after a tick. */
export interface ThreadMemory {
  readonly seenOpenAt: string | null;
  readonly closureRequestedAt: string | null;
  readonly goneAt: string | null;
}

/** A reconciliation tick: the closure requests it placed and the memory of the named threads. */
export interface ReconcileTick {
  readonly closures: readonly { readonly checkId: string; readonly discussionId: string }[];
  readonly memory: Readonly<Record<string, ThreadMemory>>;
}

/** A system thread the gate opened: the thread and the comment the reconciliation knows it by. */
export interface OpenedThread {
  readonly discussionId: string;
  readonly commentId: string;
}

/** An evaluation window made up of events: the mode, the event types, the type of the last. */
export interface WindowView {
  readonly mode: WorkflowMode;
  readonly eventTypes: readonly string[];
  readonly type: string;
  readonly pageId: string;
}

/** An open window ready for a run: what it shows, and how to conduct a run on it. */
export interface ClaimedWindow extends WindowView {
  run(ids: Ids, step: string, residue: Residue): Promise<Evidence8>;
}

/**
 * All the ways the M8 scenario conductors touch the environment: the live world does it in Notion
 * and `app_db_gate`, a test fake does it without them.
 */
export interface M8Port {
  begin(): Residue;
  /**
   * Waits for the Notion query allowance for a mode run, ahead of the world, because an hour of
   * waiting must not fall between building a world with “today” dates and the run over it.
   */
  awaitAllowance(mode: WorkflowMode): Promise<void>;
  /**
   * Checks that the environment contains only what was seeded. Otherwise it raises an
   * infrastructure failure that lists what is foreign.
   */
  assertIsolated(): Promise<void>;
  buildWorld(pages: World, info: ScenarioInfo, residue: Residue): Promise<Ids>;
  plant(pages: readonly MemoryPage[], ids: Ids, residue: Residue): Promise<void>;
  /** Conducts a review run on the occurrence of the current period, claimed by the run source. */
  review(mode: ReviewMode, ids: Ids, step: string, residue: Residue): Promise<Evidence8>;
  /**
   * Plants a proposal that an evaluation run placed earlier: the thread on the page and the
   * proposal in it.
   */
  plantProposal(ids: Ids, key: string, residue: Residue): Promise<string>;
  /** Creates a system thread on a page and the person's reply to it in the channel. */
  personAnswers(
    ids: Ids,
    key: string,
    question: string,
    answer: string,
    residue: Residue,
  ): Promise<void>;
  /** Creates a system thread on a page on behalf of an evaluation run. */
  systemThread(ids: Ids, key: string, text: string, residue: Residue): Promise<OpenedThread>;
  sweepTick(residue: Residue): Promise<readonly Woken[]>;
  /** Conducts a run of the wake that the sweep placed. */
  wake(checkId: string, ids: Ids, step: string, residue: Residue): Promise<Evidence8>;
  reconcileTick(threads: readonly string[], residue: Residue): Promise<ReconcileTick>;
  /** The person resolves a thread in Notion; `false` means the wait ended without it. */
  personResolves(ids: Ids, key: string, discussionId: string): Promise<boolean>;
  deleteComment(commentId: string): Promise<void>;
  /** The person writes to the page body. */
  writeNote(ids: Ids, key: string, paragraphs: readonly string[]): Promise<void>;
  /** The person moves the `Deadline` of a Task by `inDays` days from today. */
  personMovesDeadline(ids: Ids, key: string, inDays: number): Promise<void>;
  notionEvent(ids: Ids, event: NotionEventInput): Promise<IntakeView>;
  claimWindow(eventId: string): Promise<ClaimedWindow>;
  clean(residue: Residue): Promise<readonly string[]>;
}

/** A conductor of an M8 scenario: the steps over the port in the built world, and the claims. */
export type M8Script = (
  port: M8Port,
  info: ScenarioInfo,
  ids: Ids,
  residue: Residue,
  record: (evidence: Evidence8) => Evidence8,
) => Promise<Claim>;
