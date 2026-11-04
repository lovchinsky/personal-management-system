import { addDays } from 'date-fns';
import { callbackDataOf } from '../../src/delivery/channels/telegram/callback-data';
import type { Language } from '../../src/texts/language';
import { textsOf } from '../../src/texts/texts';
import { emptyResidue, type Residue } from '../gate/gate-cleanup';
import type { World } from '../gate/m5-scenarios';
import type { Notice } from '../gate/m6-evidence';
import type {
  ChannelWords,
  ClaimedWindow9,
  ConditionView,
  DeliveredMessage,
  Editors,
  Evidence9,
  M9Port,
  MessageNow,
  PageState,
  PersonEdit,
  Pressed,
  ProposalState,
  Proposed,
  StatusProposal,
  ThreadComment,
} from '../gate/m9-evidence';
import type { Ids, IntakeView } from '../gate/scenario-world';
import { acted, BOT, idOf, result } from './m6-evidence.fixture';

/**
 * The gate M9 port over a fake App and Notion: the proposal, the delivery queue with buttons, the
 * button presses, the executor and publication ticks, the person's edit and the evaluation
 * windows behave as `docs/2-system.md` describes them (ADR 0043, ADR 0044). With the port, the
 * gate M9 checks and conductors run the whole path without Notion and the model. The test
 * switches an App fault on with a flag and supplies the model runs through the scenario.
 */

const PERSON = 'person-user';

/** Canonical Task property ids by slot. */
const PROPERTY: Readonly<Record<string, string>> = {
  'task.status': 'status-property',
  'task.date': 'date-property',
  'task.deadline': 'deadline-property',
};

/** The page field that holds the property. */
type Field = 'status' | 'date' | 'deadline';

const FIELD: Readonly<Record<string, Field>> = {
  'status-property': 'status',
  'date-property': 'date',
  'deadline-property': 'deadline',
};

/** Today's date in the fake App. */
const TODAY = new Date('2026-10-26T09:00:00Z');

export const dayOf = (inDays: number): string => addDays(TODAY, inDays).toISOString().slice(0, 10);

interface FakePage {
  readonly key: string;
  status: string | null;
  date: string | null;
  deadline: string | null;
  lastEditedBy: string;
}

interface FakeProposal {
  readonly id: string;
  readonly page: string;
  readonly discussionId: string | null;
  /** The values the proposal writes, by property: `clear` clears the property. */
  readonly changes: Readonly<Record<string, string>>;
  /** The values the properties read when the proposal was recorded: these are its preconditions. */
  readonly reads: Readonly<Record<string, string | null>>;
  status: string;
  approved: boolean;
  recheck: boolean;
  published: string | null;
}

interface FakeRow {
  readonly id: string;
  readonly discussionId: string | null;
  readonly proposals: readonly string[];
  sent: number | null;
}

interface FakeMessage {
  readonly keyboard: readonly (readonly { readonly text: string; readonly data: string }[])[];
  edits: (readonly (readonly { readonly text: string; readonly data: string }[])[])[];
}

/** A model run that the test scenario supplies in answer to an evaluation window or a wake. */
export type FakeRun = (port: FakeM9Port, step: string) => Evidence9;

/** What the run does: proposals (a page and values) and a notification with proposals. */
interface RunActs {
  readonly propose?: readonly {
    readonly page: string;
    readonly values: Readonly<Record<string, string>>;
  }[];
  /**
   * The numbers of proposals from `propose` or the ids of existing ones that the notification
   * carries. Without the field there is no notification.
   */
  readonly notify?: readonly (number | string)[];
}

const NOTICE: Omit<Notice, 'proposals'> = {
  noticed: 'Задача чекає на рішення.',
  whyItMatters: 'Від нього залежить наступний крок.',
  ask: 'Схвалити зміну?',
  link: 'https://www.notion.so/page',
};

export class FakeM9Port implements M9Port {
  readonly calls: string[] = [];
  /** The person's words in the channel and in the thread, in the order the gate said them. */
  readonly said: string[] = [];
  /** Model runs in the order in which the scenario will call them. */
  readonly runs: FakeRun[] = [];
  /** Rows the ticks would claim although no attempt placed them. */
  foreign: string[] = [];
  /** App faults the test switches on. */
  readonly broken = {
    /** The executor writes regardless of the button press. */
    executesUnapproved: false,
    /** Publication does not rewrite messages. */
    keepsButtons: false,
    /** The answer to the press comes before the decision is recorded. */
    answersFirst: false,
  };

  private world: World = [];
  private readonly pages = new Map<string, FakePage>();
  private readonly proposals = new Map<string, FakeProposal>();
  private readonly rows: FakeRow[] = [];
  private readonly messages = new Map<number, FakeMessage>();
  private readonly threads = new Map<string, ThreadComment[]>();
  /** The page of each thread. */
  private readonly threadPages = new Map<string, string>();
  private readonly windows = new Map<string, { origin: string; page: string }>();
  /** The page the current run is working on: its conversation is the last thread on it. */
  private running = '';
  private counter = 0;

  begin(): Residue {
    return emptyResidue();
  }

  /**
   * Cleans up the attempt. The rows and pages of the world vanish, as the cleanup registry removes
   * them.
   */
  clean(): Promise<readonly string[]> {
    this.calls.push('clean');

    for (const state of [
      this.pages,
      this.proposals,
      this.messages,
      this.threads,
      this.threadPages,
      this.windows,
    ]) {
      state.clear();
    }

    this.rows.length = 0;

    return Promise.resolve([]);
  }

  language(): Language {
    return 'uk';
  }

  day(inDays: number): string {
    return dayOf(inDays);
  }

  propertyOf(slot: string): string {
    const id = PROPERTY[slot];

    if (id === undefined) throw new Error(`no carrier of ${slot}`);

    return id;
  }

  foreignRows(): Promise<readonly string[]> {
    return Promise.resolve(this.foreign);
  }

  awaitAllowance(mode: string): Promise<void> {
    this.calls.push(`allowance:${mode}`);

    return Promise.resolve();
  }

  build(pages: World): Promise<Ids> {
    this.calls.push('build');
    this.world = pages;

    for (const page of pages) {
      this.pages.set(page.key, {
        key: page.key,
        status: 'status' in page ? page.status : null,
        date: page.type === 'task' && page.dateInDays !== undefined ? dayOf(page.dateInDays) : null,
        deadline:
          page.type === 'task' && page.deadlineInDays !== undefined
            ? dayOf(page.deadlineInDays)
            : null,
        lastEditedBy: BOT,
      });
    }

    return Promise.resolve(Object.fromEntries(pages.map((page) => [page.key, idOf(page.key)])));
  }

  buildWorld(pages: World): Promise<Ids> {
    return this.build(pages);
  }

  editors(): Promise<Editors> {
    return Promise.resolve({ bot: BOT, person: PERSON });
  }

  propose(_ids: Ids, proposal: StatusProposal): Promise<Proposed> {
    this.calls.push(`propose:${proposal.page}`);

    const discussionId = this.thread(proposal.page);
    const id = this.proposalOn(proposal.page, { 'status-property': proposal.to }, discussionId);

    this.queue(discussionId, [id]);

    return Promise.resolve({ proposalId: id, discussionId });
  }

  async notify(_ids: Ids, key: string): Promise<DeliveredMessage> {
    this.calls.push(`notify:${key}`);

    const row = this.queue(this.thread(key), []);
    const message = (await this.deliverRows()).find((item) => item.outboxId === row.id);

    if (message === undefined) throw new Error('the notice was not delivered');

    return message;
  }

  deliver(): Promise<readonly DeliveredMessage[]> {
    this.calls.push('deliver');

    return this.deliverRows();
  }

  press(
    message: DeliveredMessage,
    kind: 'approve' | 'reject',
    proposalId: string,
  ): Promise<Pressed> {
    this.calls.push(`press:${kind}:${message.messageId}`);

    const data = callbackDataOf({ kind, pendingActionId: proposalId });

    if (!message.keyboard.some((row) => row.some((button) => button.data === data))) {
      return Promise.resolve({ pressable: false, answer: null, statusAtAnswer: null });
    }

    const proposal = this.row(proposalId);
    const before = proposal.status;
    const answers = textsOf('uk').telegram.answers;

    if (proposal.status === 'proposed') {
      proposal.status = kind === 'approve' ? 'approved' : 'rejected';
      proposal.approved = kind === 'approve';
    }

    return Promise.resolve({
      pressable: true,
      answer: kind === 'approve' ? answers.approved : answers.rejected,
      statusAtAnswer: this.broken.answersFirst ? before : proposal.status,
    });
  }

  messageNow(messageId: number): MessageNow {
    const message = this.messages.get(messageId);

    return {
      messageId,
      edits: message?.edits.length ?? 0,
      keyboard: message?.edits.at(-1) ?? message?.keyboard ?? [],
    };
  }

  personEdits(_ids: Ids, key: string, edit: PersonEdit): Promise<IntakeView> {
    this.calls.push(`edit:${key}`);

    const page = this.page(key);

    if (edit.status !== undefined) page.status = edit.status;
    if (edit.dateInDays !== undefined) page.date = dayOf(edit.dateInDays);

    page.lastEditedBy = PERSON;

    for (const proposal of this.proposals.values()) {
      if (proposal.page === key && proposal.status === 'proposed') proposal.recheck = true;
    }

    return Promise.resolve({ eventId: this.next('event'), windowed: true, reason: null });
  }

  personEditsBody(_ids: Ids, key: string): Promise<void> {
    this.calls.push(`body:${key}`);
    this.page(key).lastEditedBy = PERSON;

    return Promise.resolve();
  }

  personRepliesTo(message: DeliveredMessage, words: string): Promise<ChannelWords> {
    this.calls.push(`reply:${message.messageId}`);
    this.said.push(words);

    if (message.discussionId === null) {
      return Promise.resolve({ eventId: 'none', answered: [textsOf('uk').telegram.nowhere] });
    }

    const eventId = this.next('telegram');

    this.say(message.discussionId, {
      author: BOT,
      text: `Person's reply via Telegram\n${words}`,
      label: textsOf('uk').comments.labels.channelReply('Telegram'),
    });
    this.windows.set(eventId, {
      origin: 'channel_inbound',
      page: this.pageOfThread(message.discussionId),
    });

    return Promise.resolve({ eventId, answered: [] });
  }

  personCommentsInThread(
    _ids: Ids,
    key: string,
    discussionId: string,
    words: string,
  ): Promise<IntakeView> {
    this.calls.push(`comment:${key}`);
    this.said.push(words);
    this.say(discussionId, { author: PERSON, text: words, label: null });

    const eventId = this.next('event');

    this.windows.set(eventId, { origin: 'managed_discussion_reply', page: key });

    return Promise.resolve({ eventId, windowed: true, reason: null });
  }

  claimWindow(eventId: string): Promise<ClaimedWindow9> {
    const window = this.windows.get(eventId);

    if (window === undefined) throw new Error(`no window for ${eventId}`);

    return Promise.resolve({
      mode: 'event_evaluation',
      origin: window.origin,
      pageId: idOf(window.page),
      run: (_ids, step) => Promise.resolve(this.runModel(step, window.page)),
      close: () => {
        this.calls.push('close');

        return Promise.resolve();
      },
    });
  }

  wake(_ids: Ids, key: string): Promise<Evidence9> {
    return Promise.resolve(this.runModel('recheck', key));
  }

  executorTick(): Promise<void> {
    this.calls.push('executor');

    for (const proposal of this.proposals.values()) {
      if (
        proposal.status === 'approved' ||
        (this.broken.executesUnapproved && proposal.status === 'proposed')
      ) {
        proposal.status = this.holds(proposal) ? this.write(proposal) : 'conflict';
      } else if (proposal.status === 'proposed' && proposal.recheck) {
        proposal.recheck = false;

        if (!this.holds(proposal)) proposal.status = 'conflict';
      }
    }

    return Promise.resolve();
  }

  publicationTick(): Promise<void> {
    this.calls.push('publication');

    const { labels, proposal: words } = textsOf('uk').comments;

    for (const proposal of this.proposals.values()) {
      if (proposal.status === 'proposed' || proposal.status === proposal.published) continue;

      const decided = proposal.approved || proposal.status === 'rejected';

      if (proposal.published === null && decided && proposal.discussionId !== null) {
        this.say(proposal.discussionId, {
          author: BOT,
          text:
            proposal.status === 'rejected'
              ? words.rejected('статус → Next Action', 'neutral')
              : words.approved('статус → Done', 'neutral'),
          label: labels.proposalDecision,
        });
      }

      if (proposal.status === 'conflict' && proposal.approved && proposal.discussionId !== null) {
        this.say(proposal.discussionId, {
          author: BOT,
          text: words.notWritten('статус → Done', words.reasons.conflict),
          label: labels.proposalResult,
        });
      }

      if (!this.broken.keepsButtons) {
        for (const row of this.rows) {
          if (row.sent === null || !row.proposals.includes(proposal.id)) continue;

          const message = this.messages.get(row.sent);

          message?.edits.push(
            (message.edits.at(-1) ?? message.keyboard).map((line) =>
              line.filter((button) => !button.data.endsWith(`:${proposal.id}`)),
            ),
          );
        }
      }

      proposal.published = proposal.status;
    }

    return Promise.resolve();
  }

  pageState(_ids: Ids, key: string): Promise<PageState> {
    const page = this.page(key);

    return Promise.resolve({
      properties: {
        'status-property': JSON.stringify(page.status),
        'date-property': JSON.stringify(page.date),
        'deadline-property': JSON.stringify(page.deadline),
      },
      optionIds: { 'status-property': page.status === null ? null : `opt-${page.status}` },
      lastEditedBy: page.lastEditedBy,
      status: page.status,
      date: page.date,
      deadline: page.deadline,
    });
  }

  threadComments(_ids: Ids, _key: string, discussionId: string): Promise<readonly ThreadComment[]> {
    return Promise.resolve(this.threads.get(discussionId) ?? []);
  }

  proposal(id: string): Promise<ProposalState> {
    return Promise.resolve(this.stateOf(this.row(id)));
  }

  /**
   * Simulates a model run: the proposals as the App records them (the same change, while open, is
   * the same proposal) and a notification with them, in the conversation thread unless the run
   * named another (`null` means no thread). The evidence is assembled as the gate M9 world
   * assembles it.
   */
  ran(step: string, acts: RunActs, discussionId?: string | null): Evidence9 {
    const thread = discussionId === undefined ? this.conversation(this.running) : discussionId;
    const made = (acts.propose ?? []).map(({ page, values }) =>
      this.proposalOn(page, values, thread),
    );
    const shown = (acts.notify ?? []).map((item) =>
      typeof item === 'number' ? (made[item] ?? '') : item,
    );
    const row = acts.notify === undefined ? null : this.queue(thread, shown);
    const notices: Notice[] =
      row === null
        ? []
        : [{ ...NOTICE, proposals: shown.map((id) => ({ pendingActionId: id, line: 'Зміна' })) }];
    const base = acted(this.world, { notices }, result([]));

    return {
      ...base,
      step,
      proposed: made.map((id) => this.stateOf(this.row(id))),
      deliveries: row === null ? [] : [row.id],
    };
  }

  /** Returns the conversation thread on a page: the last one opened on it. */
  conversation(key: string): string {
    const opened = [...this.threadPages].filter(([, page]) => page === key).at(-1);

    if (opened === undefined) throw new Error(`no thread on ${key}`);

    return opened[0];
  }

  /** Opens a new system thread on a page. Each opening yields a thread of its own, as in Notion. */
  private thread(key: string): string {
    const id = this.next('thread');

    this.threads.set(id, []);
    this.threadPages.set(id, key);

    return id;
  }

  private runModel(step: string, page: string): Evidence9 {
    const run = this.runs.shift();

    if (run === undefined) throw new Error(`no run scripted for ${step}`);

    this.calls.push(`run:${step}`);
    this.running = page;

    return run(this, step);
  }

  private proposalOn(
    key: string,
    changes: Readonly<Record<string, string>>,
    discussionId: string | null,
  ): string {
    const open = [...this.proposals.values()].find(
      (proposal) =>
        ['proposed', 'approved'].includes(proposal.status) &&
        proposal.page === key &&
        JSON.stringify(proposal.changes) === JSON.stringify(changes),
    );

    if (open !== undefined) return open.id;

    const page = this.page(key);
    const id = this.next('proposal');

    this.proposals.set(id, {
      id,
      page: key,
      discussionId,
      changes,
      reads: Object.fromEntries(
        Object.keys(changes).map((property) => [property, page[fieldOf(property)]]),
      ),
      status: 'proposed',
      approved: false,
      recheck: false,
      published: null,
    });

    return id;
  }

  private queue(discussionId: string | null, proposals: readonly string[]): FakeRow {
    const row: FakeRow = { id: this.next('outbox'), discussionId, proposals, sent: null };

    this.rows.push(row);

    return row;
  }

  private deliverRows(): Promise<readonly DeliveredMessage[]> {
    const delivered: DeliveredMessage[] = [];

    for (const row of this.rows) {
      if (row.sent !== null) continue;

      const messageId = 2 ** 31 + this.rows.indexOf(row);
      const keyboard = row.proposals.map((id) =>
        (['approve', 'reject'] as const).map((kind) => ({
          text: kind,
          data: callbackDataOf({ kind, pendingActionId: id }),
        })),
      );

      row.sent = messageId;
      this.messages.set(messageId, { keyboard, edits: [] });
      delivered.push({
        messageId,
        outboxId: row.id,
        discussionId: row.discussionId,
        text: 'Повідомлення',
        keyboard,
        proposals: row.proposals,
      });
    }

    return Promise.resolve(delivered);
  }

  private holds(proposal: FakeProposal): boolean {
    const page = this.page(proposal.page);

    return Object.entries(proposal.reads).every(
      ([property, value]) => page[fieldOf(property)] === value,
    );
  }

  private write(proposal: FakeProposal): string {
    const page = this.page(proposal.page);

    for (const [property, value] of Object.entries(proposal.changes)) {
      page[fieldOf(property)] = value === 'clear' ? null : value;
    }

    page.lastEditedBy = BOT;

    return 'executed';
  }

  private stateOf(proposal: FakeProposal): ProposalState {
    return {
      id: proposal.id,
      status: proposal.status,
      discussionId: proposal.discussionId,
      effects: Object.entries(proposal.changes).map(([propertyId, value]) => ({
        pageId: idOf(proposal.page),
        propertyId,
        option: fieldOf(propertyId) === 'status' ? value : null,
        value,
      })),
      preconditions: Object.entries(proposal.reads).map(([propertyId, value]): ConditionView =>
        fieldOf(propertyId) === 'status'
          ? { kind: 'property_equals', propertyId, value: `opt-${value ?? ''}` }
          : value === null
            ? { kind: 'property_empty', propertyId, value: null }
            : { kind: 'property_reads_as', propertyId, value },
      ),
    };
  }

  private say(discussionId: string, comment: Omit<ThreadComment, 'id'>): void {
    const thread = this.threads.get(discussionId) ?? [];

    thread.push({ id: this.next('comment'), ...comment });
    this.threads.set(discussionId, thread);
  }

  private pageOfThread(discussionId: string): string {
    const page = this.threadPages.get(discussionId);

    if (page === undefined) throw new Error(`no thread ${discussionId}`);

    return page;
  }

  private page(key: string): FakePage {
    const page = this.pages.get(key);

    if (page === undefined) throw new Error(`no page ${key}`);

    return page;
  }

  private row(id: string): FakeProposal {
    const proposal = this.proposals.get(id);

    if (proposal === undefined) throw new Error(`no proposal ${id}`);

    return proposal;
  }

  private next(what: string): string {
    this.counter += 1;

    return `${what}-${this.counter}`;
  }
}

function fieldOf(property: string): Field {
  const field = FIELD[property];

  if (field === undefined) throw new Error(`no field carries ${property}`);

  return field;
}
