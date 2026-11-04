import { randomInt, randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { Client, collectPaginatedAPI } from '@notionhq/client';
import { subSeconds } from 'date-fns';
import { AttentionService } from '../../src/attention/attention.service';
import { CaptureService } from '../../src/capture/capture.service';
import { appConfig, type AppConfig } from '../../src/config/app.config';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { runDeliveryKey } from '../../src/delivery/delivery-key';
import { OutboxRepository } from '../../src/delivery/outbox/outbox.repository';
import { EvaluationWindowRunSource } from '../../src/intake/notion/evaluation-window.run-source';
import { BotIdentity } from '../../src/notion/client/bot-identity';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { PageReader } from '../../src/notion/client/page.reader';
import { Reading } from '../../src/notion/semantics/reading';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { Actor, CHAT } from '../../src/runs/actor';
import { RunProvenance } from '../../src/runs/provenance';
import { RunTraces, TraceView } from '../../src/runs/run-traces';
import { RunDispatcher } from '../../src/runs/run.dispatcher';
import { RunShape } from '../../src/runs/run.launcher';
import { eventEnvelope, TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { escapeHtml } from '../../src/telegram/telegram-html';
import { telegramConfig, type TelegramConfig } from '../../src/telegram/telegram.config';
import type { Language } from '../../src/texts/language';
import { textsOf } from '../../src/texts/texts';
import { BotApi, type BotMessage } from './bot-api';
import { InfrastructureError } from './gate-attempts';
import type { GateName } from './gate-boot';
import { memoryWritesOf } from './gate-claims';
import { emptyResidue, GateCleanup, Residue } from './gate-cleanup';
import { ContinuationState, ItemState, TaskState } from './m4-claims';
import { FixtureTask } from './m4-scenarios';
import { NotionAllowance } from './notion-allowance';
import { RunViews } from './run-views';

/** How long to wait for Notion search to find a page that was just created. */
const SEARCH_INDEX_SETTLE_MS = 45_000;

/** How long to wait for the App's own webhook to answer. */
const WEBHOOK_TIMEOUT_MS = 30_000;

/**
 * The numbers of the gate's updates and messages are above everything Telegram issues (int32), so
 * a real update or message with such a number does not match a gate row, either in
 * `webhook_receipts` or in the message lookup by `(channel, id)`.
 */
const TELEGRAM_ID_FLOOR = 2 ** 31;
const TELEGRAM_ID_CEILING = 2 ** 40;

/**
 * Everything gate M4 uses to touch the world: Notion, `app_db` and the second App instance.
 *
 * The gate is an operator command, not part of the App, so it talks to the App's services through
 * the same paths normal operation uses: the same capability the channel uses parks the Inbox item,
 * the same queue opens the window, and the run goes through the dispatcher.
 */
export class GateWorld {
  /** What could not be cleaned up across the scenarios: the verdict shows it to the operator. */
  private readonly left: string[] = [];

  /**
   * `gate` is the command the world serves: event and delivery keys are composed with it, so that
   * a row in `app_db` names the gate that left it.
   */
  constructor(
    protected readonly app: INestApplicationContext,
    protected readonly gate: GateName,
  ) {}

  /**
   * The registers of scenarios not yet cleaned up: a gate that is being stopped cleans up after
   * them itself.
   */
  private readonly open = new Set<Residue>();

  /** The residue of cleanup across the whole gate. */
  get leftovers(): readonly string[] {
    return this.left;
  }

  /**
   * The gate was stopped by a signal: cleanup after the gate is already under way, and a page that
   * appeared after the cleanup would stay in the workspace. So the world creates and launches
   * nothing new.
   */
  private stopped = false;

  protected assertRunning(): void {
    if (this.stopped) throw new Error('the gate was stopped by a signal');
  }

  /**
   * Opens a register for a new scenario. Until the scenario is cleaned up, stopping the gate
   * cleans up after it.
   */
  begin(): Residue {
    this.assertRunning();

    const residue = emptyResidue();

    this.open.add(residue);

    return residue;
  }

  /**
   * Cleans up after all the scenarios that did not reach their own cleanup; returns the residue
   * of the whole gate, not only of this pass: scenarios that managed to clean up earlier may also
   * have left something.
   */
  async abandon(): Promise<readonly string[]> {
    this.stopped = true;

    const residues = [...this.open];

    // The cleanup runs twice because an operation that was in flight adds its page to the register
    // after the first snapshot, and the second cleanup picks it up. Removing something a second
    // time does no harm, because the trash is checked.
    await this.cleanAll(residues);
    await this.cleanAll(residues);

    return [...new Set(this.left)];
  }

  private async cleanAll(residues: readonly Residue[]): Promise<void> {
    for (const residue of residues) {
      await this.clean(residue);
    }
  }

  /** Returns a number for a gate update or message, one that the real Telegram does not issue. */
  telegramId(): number {
    return randomInt(TELEGRAM_ID_FLOOR, TELEGRAM_ID_CEILING);
  }

  /**
   * Puts an item in the Inbox as the person does, through the same path as in the chat step where
   * the person left something unresolved.
   */
  async putItem(title: string, text: string | undefined, residue: Residue): Promise<string> {
    this.assertRunning();

    const capture = this.app.get(CaptureService);
    const parking = await capture.checkPark(CHAT, { title, text });
    const pageId = await capture.park(CHAT, parking, () => undefined);

    residue.pages.push(pageId);

    return pageId;
  }

  /** Creates an open Task in Notion ahead of the run: an equivalent object. */
  async putTask(fixture: FixtureTask, residue: Residue): Promise<string> {
    this.assertRunning();

    const adapter = this.app.get(SemanticAdapter);
    const dataSourceId = adapter.dataSourceOf('task');
    const properties = adapter.encode(
      'task',
      {
        name: { kind: 'text', text: fixture.name },
        status: { kind: 'option', option: fixture.status },
      },
      await this.app.get(LiveSchema).typesOf(dataSourceId),
    );
    const page = await this.app.get(NotionWriter).createPage(dataSourceId, properties);

    residue.pages.push(page.id);

    return page.id;
  }

  /**
   * Gives Notion time to index the Tasks just created, because workspace search lags behind page
   * creation and the equivalent object must be found, not missed.
   */
  settle(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, SEARCH_INDEX_SETTLE_MS);
    });
  }

  /** Builds the envelope of an Inbox item as the window builds it: identifiers, no content. */
  inboxEnvelope(pageId: string): TriggerEnvelope {
    return eventEnvelope('dialogue', {
      type: 'page.created',
      event_types: ['page.created'],
      event_id: `gate-${this.gate}-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      entity_id: pageId,
      page_id: pageId,
      updated_property_ids: [],
    });
  }

  /** Counts the run's queries that Notion refused on an exhausted workspace allowance. */
  refusedQueries(runId: string): number {
    return this.app
      .get(RunViews)
      .readsOf(runId)
      .filter((read) => read.refused).length;
  }

  /**
   * Conducts a run that the dispatcher drives the way the scheduler would. Before the run, the gate
   * waits for the Notion query allowance (`notion-allowance.ts`); after it, the gate records what
   * the run spent.
   *
   * Whatever the run leaves behind, the world records in the register right here. The delivery key
   * is known from the envelope before the run starts, so it is there even when the run is
   * interrupted. The trace id and the pages the run created come after the run.
   */
  async run(
    envelope: TriggerEnvelope,
    provenance: RunProvenance,
    residue: Residue,
    shape?: RunShape,
    recordAttempt: () => Promise<void> = () => Promise.resolve(),
  ): Promise<TraceView> {
    const allowance = this.app.get(NotionAllowance);

    await allowance.ready(envelope.mode, () => this.assertRunning());
    residue.outboxKeys.push(runDeliveryKey(envelope.trigger.event_id));

    const result = await this.app.get(RunDispatcher).dispatch({
      envelope,
      provenance,
      recordAttempt,
      shape,
    });

    if (!result.started) {
      throw new InfrastructureError(`the gate run was denied: ${result.denial}`);
    }

    allowance.spent(envelope.mode, this.app.get(RunViews).readsOf(result.traceId));

    const trace = await this.app.get(RunTraces).find(result.traceId);
    if (!trace) {
      throw new Error(`no trace for ${result.traceId}`);
    }

    const effects = trace.runtimeEffects ?? [];
    const idsOf = (kind: string): string[] =>
      effects.filter((effect) => effect.kind === kind).map((effect) => effect.id);

    residue.runs.push(trace.id);
    residue.pages.push(...idsOf('page_created'));
    residue.continuations.push(...idsOf('continuation'));
    residue.deliveries.push(...idsOf('delivery'));
    residue.proposals.push(...idsOf('proposal'));

    return trace;
  }

  /**
   * Sends the person's message in the channel as an update to the App's own webhook. The return
   * value is what the App said in reply (the Bot API listener of the gate environment,
   * `bot-api.ts`). An empty return value means the person's message was accepted silently, and the
   * window will show where it landed.
   */
  async sendUpdate(
    text: string,
    updateId: number,
    repliedTo?: string,
  ): Promise<readonly BotMessage[]> {
    const telegram = this.app.get<TelegramConfig>(telegramConfig.KEY);

    return this.postUpdate({
      update_id: updateId,
      message: {
        message_id: updateId,
        chat: { id: Number(telegram.allowedChatId) },
        text,
        date: Math.floor(new Date().getTime() / 1000),
        ...(repliedTo === undefined ? {} : { reply_to_message: { message_id: Number(repliedTo) } }),
      },
    });
  }

  /**
   * Posts an update to the App's own webhook, with the channel secret. A 200 response says only
   * that the update was accepted. The return value is what the App sent to the person in the
   * meantime. A message the App did not record because Notion did not accept it is an
   * infrastructure failure, not an answer from the App, so that failure is thrown here.
   */
  protected async postUpdate(update: object): Promise<readonly BotMessage[]> {
    const telegram = this.app.get<TelegramConfig>(telegramConfig.KEY);
    const { port } = this.app.get<AppConfig>(appConfig.KEY);
    const bot = this.app.get(BotApi);
    const since = new Date();
    const response = await fetch(`http://127.0.0.1:${port}/webhooks/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': telegram.webhookSecret ?? '',
      },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`the Telegram webhook answered ${response.status}`);
    }

    const answered = bot.sent(since);
    const notRecorded = escapeHtml(textsOf(this.language()).telegram.answers.notRecorded);

    if (answered.some((message) => message.text === notRecorded)) {
      throw new InfrastructureError('Notion did not take the words of the person in the channel');
    }

    return answered;
  }

  /** Puts a system message about a thread, which the person then replies to. */
  async putSystemMessage(discussionId: string, residue: Residue): Promise<string> {
    this.assertRunning();

    const key = `gate-${this.gate}-${randomUUID()}`;
    const messageId = String(this.telegramId());
    const outbox = this.app.get(OutboxRepository);

    await outbox.enqueue({
      idempotencyKey: key,
      channel: 'telegram',
      discussionId,
      message: {
        noticed: 'Gate: повідомлення системи, на яке відповідає людина',
        whyItMatters: 'Відповідь мусить потрапити в цю нитку',
        ask: 'Відповідати не треба',
        link: 'https://www.notion.so/',
      },
      quietHoursExempt: false,
    });
    await this.app.get(PrismaService).notificationOutbox.update({
      where: { idempotencyKey: key },
      data: { status: 'sent', sentAt: new Date(), externalId: messageId },
    });

    residue.outboxKeys.push(key);

    return messageId;
  }

  /**
   * Opens a system thread on a page: a thread in which the system once left a comment. The
   * thread's mode is the mode of whoever opened it, and the person's reply continues in that mode.
   * So a thread that an evaluation run opens in normal operation is opened by that run's actor, not
   * by the chat. `text` is the words the thread is opened with. A scenario that needs a natural
   * thread supplies them itself.
   */
  async openThread(
    pageId: string,
    residue: Residue,
    actor: Actor = CHAT,
    text = 'Gate: система нагадує про це завдання',
  ): Promise<string> {
    this.assertRunning();

    const written = await this.app.get(AttentionService).comment(actor, { pageId, text });

    residue.threads.push(written.discussionId);

    return written.discussionId;
  }

  /**
   * Makes the window that a channel message opened due and claims it, by the same path the
   * scheduler uses. Returns the run request and the call that concludes the window.
   */
  async claimWindowFor(eventId: string): Promise<{
    envelope: TriggerEnvelope;
    provenance: RunProvenance;
    pageId: string;
    conclude: () => Promise<unknown>;
  }> {
    const prisma = this.app.get(PrismaService);
    const window = await prisma.evaluationWindow.findFirstOrThrow({
      where: { latestEventId: eventId },
    });

    // The window comes due after the silence; the gate does not wait for it but moves the end of
    // the window.
    await prisma.evaluationWindow.update({
      where: { id: window.id },
      data: { notBefore: subSeconds(new Date(), 1) },
    });

    // The window is claimed by id, not among the candidates, because a candidate is only the head
    // of a queue partition, and a window that sits behind another one would not be found.
    const claimed = await this.app.get(EvaluationWindowRunSource).claim(window.id);

    if (!claimed) {
      throw new InfrastructureError(`the window ${window.id} could not be claimed`);
    }

    await claimed.recordAttempt();

    return {
      envelope: claimed.request.envelope,
      provenance: claimed.request.provenance,
      pageId: window.pageId,
      // The gate run reads the real Notion, so it reached it.
      conclude: () => claimed.conclude(true),
    };
  }

  /** The integration bot is the author of the system's writes. */
  bot(): Promise<string> {
    return this.app.get(BotIdentity).require();
  }

  /** The App's time zone: which day of the week a time falls on depends on it. */
  timeZone(): string {
    return this.app.get<AppConfig>(appConfig.KEY).timeZone;
  }

  /**
   * Returns the language in which the App itself writes to the person (ADR 0042). The gate also
   * renders and measures packets in that language.
   */
  language(): Language {
    return this.app.get<AppConfig>(appConfig.KEY).language;
  }

  /** Reads a page as the run left it: in the trash or not, and what the system wrote on it. */
  async itemState(pageId: string, written: readonly string[]): Promise<ItemState> {
    const page = await this.app.get(PageReader).page(pageId);

    return {
      pageId,
      inTrash: page.inTrash,
      comments: await this.commentsById(written),
    };
  }

  /** Reads a bystander item. The comments are read from the page, not from the run's effects. */
  async bystanderState(pageId: string): Promise<ItemState> {
    const page = await this.app.get(PageReader).page(pageId);

    return {
      pageId,
      inTrash: page.inTrash,
      comments: page.inTrash ? [] : await this.commentsOn(pageId),
    };
  }

  /** Reads a Task the way the canonical model reads it. */
  async taskState(pageId: string): Promise<TaskState> {
    const adapter = this.app.get(SemanticAdapter);
    const page = await this.app.get(PageReader).page(pageId);
    const { readings } = adapter.decode('task', page);

    return {
      id: pageId,
      name: plain(readings.name),
      status: plain(readings.status),
      date: plain(readings.date),
      deadline: plain(readings.deadline),
      inTrash: page.inTrash,
    };
  }

  /** Lists the continuations that remain on the thread. */
  async continuationsOn(discussionId: string): Promise<ContinuationState[]> {
    const { continuations } = await this.app.get(ContinuationsService).state({ discussionId }, []);

    return continuations.map((row) => ({ reasonCode: row.reason_code, runAt: row.run_at }));
  }

  /**
   * Returns the run's memory writes: applied memory intents and native GBrain writes
   * (`memoryWritesOf`).
   */
  gbrainWritesOf(trace: TraceView): string[] {
    return memoryWritesOf(trace);
  }

  /**
   * Cleans up what the scenario created: `app_db` rows removed outright, pages sent to the trash.
   * It does not throw: a step's failure must not destroy a verdict that has already been
   * collected, so the residue is collected in `leftovers`.
   */
  async clean(residue: Residue): Promise<readonly string[]> {
    const left = await GateCleanup.of(this.app).clean(residue);

    this.open.delete(residue);

    if (left.length > 0) {
      process.stderr.write(`gate: the cleanup left behind: ${left.join('; ')}\n`);
    }

    this.left.push(...left);

    return left;
  }

  /**
   * Reads the comments the run wrote, by their ids, because a page in the trash does not return
   * its comments.
   */
  private async commentsById(ids: readonly string[]): Promise<{ text: string; author: string }[]> {
    const notion = this.app.get(Client);
    const comments = await Promise.all(
      ids.map((id) => notion.comments.retrieve({ comment_id: id })),
    );

    return comments.flatMap((comment) =>
      'rich_text' in comment
        ? [
            {
              text: commentText(comment),
              author: comment.created_by.id,
            },
          ]
        : [],
    );
  }

  private async commentsOn(pageId: string): Promise<{ text: string; author: string }[]> {
    const results = await allComments(this.app.get(Client), pageId);

    return results.map((comment) => ({
      text: commentText(comment),
      author: comment.created_by.id,
    }));
  }
}

/** A page comment as Notion returns it. */
type NotionComment = Awaited<ReturnType<Client['comments']['list']>>['results'][number];

/**
 * Reads all the comments of a page, not just the first batch of the response, because Notion
 * returns them in pages.
 */
export function allComments(notion: Client, pageId: string): Promise<NotionComment[]> {
  return collectPaginatedAPI(notion.comments.list, { block_id: pageId });
}

/** Returns the text of a Notion comment without markup. */
export function commentText(comment: Pick<NotionComment, 'rich_text'>): string {
  return comment.rich_text.map((piece) => piece.plain_text).join('');
}

/**
 * Returns the scalar form of a reading: a text, an option or the start of a date. `null` means
 * empty or something else.
 */
export function plain(reading: Reading | undefined): string | null {
  if (reading?.state !== 'value') return null;

  switch (reading.value.type) {
    case 'text':
      return reading.value.text;
    case 'option':
      return reading.value.option;
    case 'date':
      return reading.value.start;
    default:
      return null;
  }
}
