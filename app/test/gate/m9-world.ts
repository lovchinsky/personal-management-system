import { randomUUID } from 'node:crypto';
import { Client, isFullPage } from '@notionhq/client';
import { addDays } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { PendingActionRepository } from '../../src/approvals/contracts/pending-action.repository';
import { ExecutorWorker } from '../../src/approvals/executor/executor.worker';
import {
  preconditionsSchema,
  type Precondition,
} from '../../src/approvals/preconditions/precondition';
import { PublicationWorker } from '../../src/approvals/publication/publication.worker';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { callbackDataOf } from '../../src/delivery/channels/telegram/callback-data';
import type { DeliveryRequest } from '../../src/delivery/delivery.schema';
import { DeliveryService, type ProposalLookup } from '../../src/delivery/delivery.service';
import { pageLink } from '../../src/delivery/notion-link';
import { OutboxWorker } from '../../src/delivery/outbox/outbox.worker';
import type { NotificationOutbox, PendingAction } from '../../src/generated/prisma/client';
import type { WorkflowMode } from '../../src/generated/prisma/enums';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { canonicalPage } from '../../src/notion/client/page';
import type { CanonicalWrite } from '../../src/notion/semantics/canonical-write';
import type { Reading } from '../../src/notion/semantics/reading';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { wallClock } from '../../src/platform/time/local-day';
import type { RunActor } from '../../src/runs/actor';
import type { TraceView } from '../../src/runs/run-traces';
import type { TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { telegramConfig, type TelegramConfig } from '../../src/telegram/telegram.config';
import { BotApi } from './bot-api';
import { HarnessError, InfrastructureError } from './gate-attempts';
import { sameId } from './gate-claims';
import { emptyResidue, pagesOutside, type Residue } from './gate-cleanup';
import { allComments, commentText, plain } from './m4-world';
import type { World } from './m5-scenarios';
import type { ScenarioInfo } from './m6-scenarios';
import { M6World } from './m6-world';
import { buildVerified } from './m6-world-check';
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
  SystemNotice,
  ThreadComment,
} from './m9-evidence';
import { NotionAllowance } from './notion-allowance';
import {
  dayIn,
  pageOf,
  proposalViewOf,
  valueOf,
  type Ids,
  type IntakeView,
} from './scenario-world';

/**
 * How many queue rows the gate looks at before a worker tick. The number exceeds what one tick
 * takes, so a foreign row outside its batch is seen too.
 */
const TICK_REACH = 1_000;

/**
 * The property types whose values Notion stores: the person or the App writes them. The rest
 * (formulas, rollups, edit times and editors, unique-ID numbers) Notion computes itself, and an
 * edit of anything changes them.
 */
const STORED_TYPES: ReadonlySet<string> = new Set([
  'title',
  'rich_text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'people',
  'files',
  'checkbox',
  'url',
  'email',
  'phone_number',
  'relation',
]);

/**
 * Everything gate M9 touches in the environment beyond what gate M6 can do: a proposal in the name
 * of a run, the delivery queue to the Bot API listener, a button press, the person's edits and
 * messages, the executor and publication ticks. Every step takes the App's normal path: the queue
 * worker sends the message, the press arrives at the App's own webhook, the person's edit goes
 * through the personal token and arrives as an event at the same ingress as the Notion webhook's.
 *
 * A worker tick takes all rows of its kind in `app_db_gate`, so before a tick the world checks
 * that the rows belong to this attempt, because a tick over a foreign row would write to Notion
 * what the attempt did not set.
 */
export class M9World extends M6World implements M9Port {
  private person?: string;

  awaitAllowance(mode: WorkflowMode): Promise<void> {
    return this.app.get(NotionAllowance).ready(mode, () => this.assertRunning());
  }

  buildWorld(pages: World, info: ScenarioInfo, residue: Residue): Promise<Ids> {
    return buildVerified(this, info, pages, residue);
  }

  day(inDays: number): string {
    return dayIn(wallClock(this.timeZone(), new Date()), inDays);
  }

  /** Lists the rows that a delivery, executor or publication tick would take and no attempt set. */
  async foreignRows(): Promise<readonly string[]> {
    const none = emptyResidue();
    const ticks = await this.tickRows();

    return [
      ...ticks.deliveries
        .filter((row) => !ownsDelivery(none, row))
        .map((row) => `the pending delivery ${row.idempotencyKey}`),
      ...foreignProposals(none, [...ticks.executed, ...ticks.published]),
    ];
  }

  /**
   * Returns the integration bot and the owner of the personal token the gate uses to write in the
   * person's name.
   */
  async editors(): Promise<Editors> {
    this.person ??= (await this.personalClient().users.me({})).id;

    return { bot: await this.bot(), person: this.person };
  }

  /**
   * Makes a proposal in the name of an evaluation run through the same services as the App MCP
   * tools: it opens a thread with an explanation, checks and records the proposal, and puts a
   * message with the proposal in the queue. The actor is the operator, who is exempt from quiet
   * hours, so quiet hours do not defer the message.
   */
  async propose(ids: Ids, proposal: StatusProposal, residue: Residue): Promise<Proposed> {
    const pageId = pageOf(ids, proposal.page);
    const actor = this.evaluationActor('proposal');
    const discussionId = canonicalNotionId(
      await this.openThread(pageId, residue, actor, proposal.notice.thread),
    );
    const approvals = this.app.get(ApprovalsService);
    const status = this.statusProperty();
    const checked = await approvals.check(actor, {
      discussionId,
      effects: [
        {
          kind: 'property_write',
          pageId,
          propertyId: status,
          value: { kind: 'option', option: proposal.to },
        },
      ],
      preconditions: [
        {
          kind: 'property_reads_as',
          pageId,
          propertyId: status,
          value: { kind: 'option', option: proposal.from },
        },
      ],
    });
    const row = await approvals.record(actor, checked);

    residue.proposals.push(row.id);

    const { line, ...notice } = proposal.notice;

    await this.enqueue(
      actor,
      discussionId,
      pageId,
      notice,
      [{ pendingActionId: row.id, line }],
      residue,
    );

    return { proposalId: row.id, discussionId };
  }

  /**
   * Opens a system thread in the name of an evaluation run and delivers a message about it to the
   * person.
   */
  async notify(
    ids: Ids,
    key: string,
    notice: SystemNotice,
    residue: Residue,
  ): Promise<DeliveredMessage> {
    const pageId = pageOf(ids, key);
    const actor = this.evaluationActor('notice');
    const discussionId = canonicalNotionId(
      await this.openThread(pageId, residue, actor, notice.thread),
    );
    const row = await this.enqueue(actor, discussionId, pageId, notice, [], residue);
    const delivered = (await this.deliver(residue)).find((message) => message.outboxId === row.id);

    if (delivered === undefined) {
      throw new InfrastructureError(`the notice ${row.idempotencyKey} was not delivered`);
    }

    return delivered;
  }

  /**
   * Runs a delivery queue tick with the same worker as in normal operation. The messages go to the
   * Bot API listener. Returns what was delivered, with the thread and proposals of the queue row.
   */
  async deliver(residue: Residue): Promise<readonly DeliveredMessage[]> {
    this.assertRunning();

    const prisma = this.app.get(PrismaService);

    assertOwn(
      'delivery',
      (await this.tickRows()).deliveries
        .filter((row) => !ownsDelivery(residue, row))
        .map((row) => `the pending delivery ${row.idempotencyKey}`),
    );

    const bot = this.app.get(BotApi);
    const since = new Date();

    await this.app.get(OutboxWorker).runOnce();

    const sent = bot.sent(since);
    const rows = await prisma.notificationOutbox.findMany({
      where: { externalId: { in: sent.map((message) => String(message.messageId)) } },
      include: { proposals: { orderBy: { position: 'asc' } } },
    });

    return sent.map((message) => {
      const row = rows.find((candidate) => candidate.externalId === String(message.messageId));

      if (row === undefined) {
        throw new HarnessError(`the message ${message.messageId} belongs to no delivery row`);
      }

      return {
        messageId: message.messageId,
        outboxId: row.id,
        discussionId: row.discussionId === null ? null : canonicalNotionId(row.discussionId),
        text: message.text,
        keyboard: message.keyboard,
        proposals: row.proposals.map((line) => line.pendingActionId),
      };
    });
  }

  /**
   * Presses a button of the message the way the person does: a `callback_query` to the App's own
   * webhook from the allowed chat. At the time the App answers the press, the listener reads the
   * proposal row, which shows whether the decision is already recorded. The gate presses only the
   * button of a proposal that writes to the gate's own pages.
   */
  async press(
    message: DeliveredMessage,
    kind: 'approve' | 'reject',
    proposalId: string,
    residue: Residue,
  ): Promise<Pressed> {
    this.assertRunning();

    const data = callbackDataOf({ kind, pendingActionId: proposalId });

    if (!message.keyboard.some((row) => row.some((button) => button.data === data))) {
      return { pressable: false, answer: null, statusAtAnswer: null };
    }

    const proposal = await this.proposal(proposalId);
    const outside = pagesOutside(
      residue,
      proposal.effects.map((effect) => effect.pageId),
    );

    if (outside.length > 0) {
      throw new Error(
        `refusing to ${kind} the proposal ${proposalId}: it writes outside the pages the gate created (${outside.join(', ')})`,
      );
    }

    const bot = this.app.get(BotApi);
    const prisma = this.app.get(PrismaService);
    const queryId = randomUUID();
    const chat = this.app.get<TelegramConfig>(telegramConfig.KEY).allowedChatId;

    bot.observeAnswer(
      queryId,
      async () =>
        (await prisma.pendingAction.findUnique({ where: { id: proposalId } }))?.status ?? null,
    );
    await this.postUpdate({
      update_id: this.telegramId(),
      callback_query: {
        id: queryId,
        data,
        message: { message_id: message.messageId, chat: { id: Number(chat) } },
      },
    });

    const answer = bot.answers().find((item) => item.callbackQueryId === queryId);

    return {
      pressable: true,
      answer: answer?.text ?? null,
      statusAtAnswer: typeof answer?.observed === 'string' ? answer.observed : null,
    };
  }

  messageNow(messageId: number): MessageNow {
    const bot = this.app.get(BotApi);
    const edits = bot.editsOf(messageId);
    const sent = bot.sent().find((message) => message.messageId === messageId);

    return {
      messageId,
      edits: edits.length,
      keyboard: edits.at(-1)?.keyboard ?? sent?.keyboard ?? [],
    };
  }

  /**
   * Changes a Task's properties as the person does, with the personal token and with values
   * encoded by the same encoder as the App's, and sends the edit event to the ingress. The
   * evaluation window that the edit opened is closed without a run, because in normal operation
   * it would be a separate run, and here it must not fold into the person's next message.
   */
  async personEdits(ids: Ids, key: string, edit: PersonEdit): Promise<IntakeView> {
    this.assertRunning();

    const adapter = this.app.get(SemanticAdapter);
    const types = await this.app.get(LiveSchema).typesOf(adapter.dataSourceOf('task'));
    const writes: Partial<Record<'status' | 'date', CanonicalWrite>> = {
      ...(edit.status === undefined ? {} : { status: { kind: 'option', option: edit.status } }),
      ...(edit.dateInDays === undefined ? {} : { date: this.dateIn(edit.dateInDays) }),
    };

    await this.personalClient().pages.update({
      page_id: pageOf(ids, key),
      properties: adapter.encode('task', writes, types),
    });

    const event = await this.notionEvent(ids, {
      type: 'page.properties_updated',
      page: key,
      slots: Object.keys(writes).map((field) => `task.${field}`),
    });

    // The cleanup register removes a window on a world page through its page.
    if (event.windowed) {
      await (await this.claimWindowFor(event.eventId)).conclude();
    }

    return event;
  }

  async personEditsBody(ids: Ids, key: string): Promise<void> {
    await this.writeBody(
      pageOf(ids, key),
      ['Перед рішенням ще раз перечитала умови.'],
      this.personalClient(),
    );
  }

  /** Replies in the channel to this message as the person. */
  async personRepliesTo(message: DeliveredMessage, words: string): Promise<ChannelWords> {
    this.assertRunning();

    const updateId = this.telegramId();
    const answered = await this.sendUpdate(words, updateId, String(message.messageId));

    return { eventId: `telegram:${updateId}`, answered: answered.map((item) => item.text) };
  }

  /**
   * Comments in a Notion thread as the person, with the personal token, and sends the comment
   * event to the ingress.
   */
  async personCommentsInThread(
    ids: Ids,
    key: string,
    discussionId: string,
    words: string,
  ): Promise<IntakeView> {
    this.assertRunning();

    const comment = await this.personalClient().comments.create({
      discussion_id: discussionId,
      rich_text: [{ type: 'text', text: { content: words } }],
    });

    return this.notionEvent(ids, {
      type: 'comment.created',
      page: key,
      discussionId: canonicalNotionId(discussionId),
      commentId: comment.id,
    });
  }

  /** Makes due and claims the window the person's message opened, as the scheduler takes it. */
  async claimWindow(eventId: string): Promise<ClaimedWindow9> {
    const window = await this.claimWindowFor(eventId);

    return {
      mode: window.envelope.mode,
      origin: window.provenance.origin,
      pageId: window.pageId,
      run: (ids, step, residue) =>
        this.ran(step, ids, residue, window.envelope, async (envelope) => {
          const trace = await this.run(envelope, window.provenance, residue);

          await window.conclude();

          return trace;
        }),
      close: async () => {
        await window.conclude();
      },
    };
  }

  /**
   * Brings the thread continuation that the evaluation run scheduled (“I am waiting for an
   * external event”) due. The row is scheduled for tomorrow in the name of the run, moved into the
   * past and claimed the way the scheduler takes it.
   */
  async wake(ids: Ids, key: string, discussionId: string, residue: Residue): Promise<Evidence9> {
    this.assertRunning();

    const actor: RunActor = this.evaluationActor('wake');

    await this.app.get(ContinuationsService).schedule(actor, {
      discussionId,
      notionPageId: pageOf(ids, key),
      runAt: addDays(new Date(), 1),
      reasonCode: 'await_external_event',
    });

    const check = await this.claimCheckFor(discussionId, 'wake');

    return this.ran('recheck', ids, residue, check.envelope, async (envelope) => {
      const trace = await this.run(envelope, check.provenance, residue);

      await check.conclude();

      return trace;
    });
  }

  /**
   * Runs an executor tick with the same worker as in normal operation. The tick takes the approved
   * proposals and those the person may have got ahead of.
   */
  async executorTick(residue: Residue): Promise<void> {
    this.assertRunning();

    assertOwn('executor', foreignProposals(residue, (await this.tickRows()).executed));
    await this.app.get(ExecutorWorker).runOnce();
  }

  /**
   * Runs a publication tick with the same worker as in normal operation. The tick publishes
   * proposal fates: the trail in the thread and the rewritten messages.
   */
  async publicationTick(residue: Residue): Promise<void> {
    this.assertRunning();

    assertOwn('publication', foreignProposals(residue, (await this.tickRows()).published));
    await this.app.get(PublicationWorker).runOnce();
  }

  /**
   * Reads a page as Notion returns it: the stored property values by canonical id, the readings of
   * the status and dates, and who edited it last.
   */
  async pageState(ids: Ids, key: string): Promise<PageState> {
    const raw = await this.app.get(Client).pages.retrieve({ page_id: pageOf(ids, key) });

    if (!isFullPage(raw)) {
      throw new InfrastructureError(`the page ${key} came back without its properties`);
    }

    const page = canonicalPage(raw);
    const adapter = this.app.get(SemanticAdapter);
    const type =
      page.dataSourceId === null ? undefined : adapter.typeOfDataSource(page.dataSourceId);
    const readings = new Map<string, Reading>(
      type === undefined ? [] : Object.entries(adapter.decode(type, page).readings),
    );

    return {
      properties: Object.fromEntries(
        [...page.properties]
          .filter(([, property]) => STORED_TYPES.has(property.type))
          .map(([id, property]) => [String(id), JSON.stringify(property)]),
      ),
      optionIds: Object.fromEntries(
        [...page.properties].flatMap(([id, property]): [string, string | null][] => {
          switch (property.type) {
            case 'status':
              return [[String(id), property.status?.id ?? null]];

            case 'select':
              return [[String(id), property.select?.id ?? null]];

            default:
              return [];
          }
        }),
      ),
      lastEditedBy: raw.last_edited_by.id,
      status: plain(readings.get('status')),
      date: plain(readings.get('date')),
      deadline: plain(readings.get('deadline')),
    };
  }

  /** Returns the comments of a thread on a page, each with the label Notion shows it under. */
  async threadComments(
    ids: Ids,
    key: string,
    discussionId: string,
  ): Promise<readonly ThreadComment[]> {
    const comments = await allComments(this.app.get(Client), pageOf(ids, key));

    return comments
      .filter((comment) => sameId(comment.discussion_id, discussionId))
      .map((comment) => ({
        id: comment.id,
        author: comment.created_by.id,
        text: commentText(comment),
        label: comment.display_name.resolved_name,
      }));
  }

  async proposal(id: string): Promise<ProposalState> {
    return stateOf(
      await this.app.get(PrismaService).pendingAction.findUniqueOrThrow({ where: { id } }),
    );
  }

  /**
   * Returns the rows the ticks would take: the pending deliveries and the proposals, selected the
   * way the executor and publication select them.
   */
  private async tickRows(): Promise<{
    readonly deliveries: readonly NotificationOutbox[];
    readonly executed: readonly PendingAction[];
    readonly published: readonly PendingAction[];
  }> {
    const actions = this.app.get(PendingActionRepository);

    return {
      deliveries: await this.app
        .get(PrismaService)
        .notificationOutbox.findMany({ where: { status: 'pending' } }),
      executed: [...(await actions.approved(TICK_REACH)), ...(await actions.toRecheck(TICK_REACH))],
      published: await actions.unpublished(TICK_REACH),
    };
  }

  /**
   * Puts a message in the actor's name into the delivery queue through the delivery service, as in
   * normal operation.
   */
  private async enqueue(
    actor: RunActor,
    discussionId: string,
    pageId: string,
    notice: Omit<SystemNotice, 'thread'>,
    proposals: NonNullable<DeliveryRequest['message']['proposals']>,
    residue: Residue,
  ): Promise<NotificationOutbox> {
    const approvals = this.app.get(ApprovalsService);
    const lookup: ProposalLookup = {
      awaitsDecision: (id) => approvals.awaitsDecision(id),
      waitingBesides: (shown) => approvals.waitingBesides(shown),
    };
    const key = `gate-${this.gate}-${randomUUID()}`;

    residue.outboxKeys.push(key);

    return this.app.get(DeliveryService).enqueue(
      actor,
      {
        idempotencyKey: key,
        channel: 'telegram',
        discussionId,
        message: {
          noticed: notice.noticed,
          whyItMatters: notice.whyItMatters,
          ask: notice.ask,
          link: pageLink(pageId),
          ...(proposals.length === 0 ? {} : { proposals }),
        },
      },
      lookup,
    );
  }

  /**
   * Performs a run and returns its evidence: snapshots of the world and the memory state before
   * the run, and after it what the run wrote and the proposals and deliveries it pointed to. The
   * threads the run opened on the world pages go into the cleanup register.
   */
  private async ran(
    step: string,
    ids: Ids,
    residue: Residue,
    envelope: TriggerEnvelope,
    go: (envelope: TriggerEnvelope) => Promise<TraceView>,
  ): Promise<Evidence9> {
    const [before, memoryBefore] = await Promise.all([
      this.snapshots(ids, false),
      this.memoryStates(residue),
    ]);
    const trace = await go(envelope);
    const after = await this.memoryStates(residue);
    const base = await this.evidenceFor(step, trace, ids, before, null, {
      slugs: after.slugs,
      before: memoryBefore.states,
      after: after.states,
    });
    const world = Object.values(ids);

    for (const comment of base.written.comments) {
      if (world.some((id) => sameId(id, comment.pageId))) {
        residue.threads.push(comment.discussionId);
      }
    }

    const applied = trace.runtimeEffects ?? [];
    const idsOf = (kind: string): string[] =>
      applied.filter((effect) => effect.kind === kind).map((effect) => effect.id);
    const rows = await this.app
      .get(PrismaService)
      .pendingAction.findMany({ where: { id: { in: idsOf('proposal') } } });

    return {
      ...base,
      proposed: idsOf('proposal').flatMap((id) => {
        const row = rows.find((candidate) => candidate.id === id);

        return row === undefined ? [] : [stateOf(row)];
      }),
      deliveries: idsOf('delivery'),
    };
  }
}

/** Describes a proposal from a row: state, effects, preconditions in words and the thread. */
function stateOf(row: PendingAction): ProposalState {
  return {
    ...proposalViewOf(row),
    preconditions: preconditionsSchema.parse(row.preconditions).map(conditionOf),
    discussionId: row.discussionId === null ? null : canonicalNotionId(row.discussionId),
  };
}

function conditionOf(condition: Precondition): ConditionView {
  switch (condition.kind) {
    case 'page_exists':
      return { kind: condition.kind, propertyId: null, value: null };

    case 'property_equals':
      return {
        kind: condition.kind,
        propertyId: String(condition.propertyId),
        value: condition.optionId,
      };

    case 'property_empty':
      return { kind: condition.kind, propertyId: String(condition.propertyId), value: null };

    case 'property_reads_as':
      return {
        kind: condition.kind,
        propertyId: String(condition.propertyId),
        value: valueOf(condition.value),
      };

    case 'unchanged_since':
      return { kind: condition.kind, propertyId: null, value: condition.lastEditedTime };
  }
}

/**
 * Checks whether this attempt set the queue row: by key, by an id from the run's effects or by the
 * attempt's thread.
 */
function ownsDelivery(residue: Residue, row: NotificationOutbox): boolean {
  return (
    residue.outboxKeys.includes(row.idempotencyKey) ||
    residue.deliveries.includes(row.id) ||
    (row.discussionId !== null &&
      residue.threads.some((thread) => sameId(thread, row.discussionId ?? '')))
  );
}

/**
 * Describes the proposals the attempt did not set: not by the attempt itself, not by its runs, not
 * in its threads.
 */
function foreignProposals(residue: Residue, rows: readonly PendingAction[]): string[] {
  return rows
    .filter(
      (row) =>
        !residue.proposals.includes(row.id) &&
        !(row.proposedByRunId !== null && residue.runs.includes(row.proposedByRunId)) &&
        !(
          row.discussionId !== null &&
          residue.threads.some((thread) => sameId(thread, row.discussionId ?? ''))
        ),
    )
    .map((row) => `the ${row.status} proposal ${row.id} on the page ${row.notionPageId}`);
}

/**
 * Throws when a worker tick would take a foreign row. That is an infrastructure failure, because
 * the attempt would not start from a clean state.
 */
function assertOwn(worker: string, foreign: readonly string[]): void {
  if (foreign.length > 0) {
    throw new InfrastructureError(
      `the ${worker} tick would take rows this attempt did not make: ${foreign.join('; ')}`,
    );
  }
}
