import { randomUUID } from 'node:crypto';
import { Type } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { addMilliseconds, isBefore, subSeconds } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { ActionExecutor } from '../../src/approvals/executor/action.executor';
import { effectsSchema } from '../../src/approvals/proposal.schema';
import { runnerConfig, type RunnerConfig } from '../../src/claude/runner/runner.config';
import {
  ClosureRequest,
  ContinuationsService,
} from '../../src/continuations/continuations.service';
import { ReasonClass, reasonsOf } from '../../src/continuations/reason-class';
import { ScheduledCheckRunSource } from '../../src/continuations/scheduled-check.run-source';
import { GbrainToken } from '../../src/credentials/gbrain/gbrain.token';
import type { PendingAction } from '../../src/generated/prisma/client';
import { notionEventSchema } from '../../src/intake/notion/notion-event.schema';
import { NotionIntake } from '../../src/intake/notion/notion-intake';
import { GbrainClient, type GbrainStore } from '../../src/memory/gbrain-client';
import { linkedPageIds } from '../../src/methodology/linked-pages';
import { isUndetermined } from '../../src/methodology/undetermined';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { notionConfig, type NotionConfig } from '../../src/notion/client/notion.config';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { PageReader } from '../../src/notion/client/page.reader';
import { PhysicalTypes } from '../../src/notion/client/property-write';
import { CanonicalWrite } from '../../src/notion/semantics/canonical-write';
import { FieldOf } from '../../src/notion/semantics/decoded-record';
import { Reading } from '../../src/notion/semantics/reading';
import { NotionRecordReader } from '../../src/notion/semantics/record.reader';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { instantOfLocalDate, wallClock, type Wall } from '../../src/platform/time/local-day';
import { CHAT, RunActor } from '../../src/runs/actor';
import { RunProvenance } from '../../src/runs/provenance';
import { TraceView } from '../../src/runs/run-traces';
import { eventEnvelope, TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { HarnessError, InfrastructureError, unreached, UnreachedRunError } from './gate-attempts';
import { Evidence, PageSnapshot, ProposalView, SeenComment } from './gate-claims';
import { pagesOutside, Residue } from './gate-cleanup';
import { needsPersonLine, personDoneLine } from './gate-signals';
import { plantAnchor, until, type Waiting } from './gbrain-fixture';
import { allComments, commentText, GateWorld, plain } from './m4-world';
import { World, WorldPage } from './m5-scenarios';
import { RunViews } from './run-views';

/** How long to wait for the operator to resolve the thread in Notion before giving up. */
const RESOLVE_TIMEOUT_MS = 10 * 60 * 1000;

/** How often to ask Notion whether the thread is resolved. */
const RESOLVE_POLL_MS = 10_000;

/** How long to wait for the Notion search to see a just-created page: up to two minutes. */
const SEARCH_WAITING: Waiting = {
  attempts: 24,
  pauseMs: 5_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** How many times and how often to ask whether the sync of the project's `Tasks` has arrived. */
const PROJECT_SYNC_TRIES = 10;
const PROJECT_SYNC_PAUSE_MS = 2_000;

/** The field that holds a page's name when it is not called `name`. */
const NAME_FIELD: Readonly<Record<string, string>> = {
  objective: 'desired_change',
  inbox_item: 'captured_title',
  behavior_system: 'behavior',
};

/**
 * A continuation claimed the way the scheduler takes it: the run request and the way to conclude
 * the row.
 */
interface ClaimedCheck {
  readonly envelope: TriggerEnvelope;
  readonly provenance: RunProvenance;
  readonly conclude: () => Promise<unknown>;
}

/** A scenario world created in Notion: the id of each page by the scenario key. */
export type Ids = Readonly<Record<string, string>>;

/**
 * A Notion event about a person's edit that the gate submits to the ingress: the person changed the
 * body or properties of a world page or commented in a thread on it. `page` is the page's key in
 * the world.
 */
export type NotionEventInput =
  | {
      readonly type: 'page.content_updated' | 'page.properties_updated';
      readonly page: string;
      /** The slots of the changed properties (`task.deadline`), for `page.properties_updated`. */
      readonly slots?: readonly string[];
    }
  | {
      readonly type: 'comment.created';
      readonly page: string;
      readonly discussionId: string;
      readonly commentId: string;
    };

/**
 * What the ingress did with the event: opened or extended a window, or rejected it with a reason.
 */
export interface IntakeView {
  readonly eventId: string;
  readonly windowed: boolean;
  readonly reason: string | null;
}

/**
 * Returns the id of a world page by key. A key the scenario did not create is a scenario error,
 * not an empty id.
 */
export function pageOf(ids: Ids, key: string): string {
  const id = ids[key];

  if (id === undefined) throw new Error(`the world has no page ${key}`);

  return id;
}

const text = (value: string): CanonicalWrite => ({ kind: 'text', text: value });
const option = (value: string): CanonicalWrite => ({ kind: 'option', option: value });
const links = (...pageIds: readonly string[]): CanonicalWrite => ({
  kind: 'links',
  pageIds: [...pageIds],
});

/**
 * Everything the scenario gates (M5, M6) touch in the world beyond what gate M4 can do: pages of
 * any type with their relations, page snapshots before and after a run, the run's proposals,
 * approval with the executor, thread closure.
 *
 * The gate is an operator command, not a part of the App: it talks to the App's services along the
 * same paths that normal operation uses.
 */
export class ScenarioWorld extends GateWorld {
  /** Creates the pages of the scenario world: what is in it, linked as described. */
  async build(world: World, residue: Residue): Promise<Ids> {
    const ids: Record<string, string> = {};

    for (const page of world) {
      ids[page.key] = await this.create(page, ids, residue);
    }

    await this.awaitProjectTasks(world, ids);

    return ids;
  }

  /**
   * Returns the GBrain through which the gate prepares its anchor page: the same client the runs
   * use.
   */
  gbrain(): GbrainStore {
    return GbrainClient.of(this.app.get(GbrainToken), this.app.get<RunnerConfig>(runnerConfig.KEY));
  }

  /**
   * Plants an anchor page in GBrain for the world's project, so the run has something to find by
   * the exact id. The world has exactly one project, and the anchor is that project's. The cleanup
   * deletes the page, through the register.
   */
  async plantAnchor(world: World, ids: Ids, residue: Residue): Promise<void> {
    const project = world.find((page) => page.type === 'project');

    if (project === undefined) throw new Error('the world has no project to anchor');
    if (project.anchor === undefined) {
      throw new Error(`the world's project ${project.key} says nothing of what its anchor holds`);
    }

    await plantAnchor(this.gbrain(), residue, {
      notionId: pageOf(ids, project.key),
      projectName: project.name,
      paragraphs: project.anchor,
    });
  }

  /**
   * The Tasks of a project are read from the project's own `Tasks` relation, which is the other
   * side of a two-way relation that Notion syncs, while the gate writes only on the Task's side.
   * Until the sync arrives, the rule says “there is nothing” over an incomplete list, so the gate
   * waits for it (bounded). A timeout is not an error: what is read will not match the design, and
   * the scenario will say so.
   */
  private async awaitProjectTasks(world: World, ids: Ids): Promise<void> {
    for (const owner of world) {
      if (owner.type !== 'project' && owner.type !== 'behavior_system') continue;

      const expected = world
        .filter(
          (page) =>
            page.type === 'task' &&
            (owner.type === 'project' ? page.project : page.behaviorSystem) === owner.key,
        )
        .map((page) => canonicalNotionId(pageOf(ids, page.key)));

      for (let attempt = 0; attempt < PROJECT_SYNC_TRIES && expected.length > 0; attempt += 1) {
        if (await this.tasksListed(owner.type, pageOf(ids, owner.key), expected)) break;

        await new Promise((resolve) => setTimeout(resolve, PROJECT_SYNC_PAUSE_MS));
      }
    }
  }

  /**
   * Checks whether the `Tasks` relation of a Project or Behavior System already lists all these
   * Tasks (canonical ids). A relation that does not read as a list is not fixed by waiting. `true`
   * means there is nothing to wait for, and the world check will name the binding problems.
   */
  private async tasksListed(
    type: 'project' | 'behavior_system',
    ownerId: string,
    expected: readonly string[],
  ): Promise<boolean> {
    const record = await this.recordReader().read(type, ownerId);
    const listed = linkedPageIds(record.readings.tasks);

    if (isUndetermined(listed)) return true;

    const have = listed.map(canonicalNotionId);

    return expected.every((id) => have.includes(id));
  }

  /**
   * Waits until the Notion search for this query returns the world page. The search lags behind
   * creation, and a run that looks for an equivalent would err: it would be judged by the index
   * rather than by the Skill. This is a check of what the model would find, not a fixed pause,
   * because a pause does not show that the index kept up.
   */
  async awaitSearchable(
    pageId: string,
    query: string,
    waiting: Waiting = SEARCH_WAITING,
  ): Promise<void> {
    const notion = this.app.get(Client);

    const named = await until(waiting, async () => {
      this.assertRunning();

      const found = await notion.search({
        query,
        filter: { property: 'object', value: 'page' },
        page_size: 25,
      });

      return found.results.some((page) => canonicalNotionId(page.id) === canonicalNotionId(pageId));
    });

    if (named) return;

    throw new InfrastructureError(
      `Notion search for ${query} does not name the page ${pageId} after ${waiting.attempts} attempts`,
    );
  }

  /**
   * Builds an event over a page: what woke it, composed the way a window would compose it.
   * `changed` holds the slots of the changed properties (`task.status`): the window includes their
   * ids, as the Notion event does.
   */
  trigger(pageId: string, changed: readonly string[] = []): TriggerEnvelope {
    return eventEnvelope('event_evaluation', {
      type: 'page.properties_updated',
      event_types: ['page.properties_updated'],
      // The model sees the event, so the identifier is ordinary, without a gate name (a real one
      // has none).
      event_id: randomUUID(),
      timestamp: new Date().toISOString(),
      entity_id: pageId,
      page_id: pageId,
      updated_property_ids: changed.map((slot) => this.propertyOf(slot)),
    });
  }

  /**
   * Sends the person's words in the channel as a reply to a system message in the system's thread,
   * with the same steps as in normal operation. Returns the event id: the window the reply opened
   * is found by that id.
   */
  async personReplies(discussionId: string, words: string, residue: Residue): Promise<string> {
    const messageId = await this.putSystemMessage(discussionId, residue);
    const updateId = this.telegramId();
    const answered = await this.sendUpdate(words, updateId, messageId);

    // The App accepts a reply to a system message in the system's thread silently: anything said
    // to the person in response means the words landed nowhere.
    if (answered.length > 0) {
      throw new Error(
        `the App did not take the reply in the channel: it answered «${answered.map((message) => message.text).join(' / ')}»`,
      );
    }

    return `telegram:${updateId}`;
  }

  /**
   * The person's reply in the channel reaches the gate's own window: the gate webhook, the system
   * thread and the evaluation window are the shared path of the channel scenarios, and the model
   * takes no part in it. `ok` means the window is opened over the same page the reply was made on.
   */
  async channelReaches(
    page: string,
    residue: Residue,
  ): Promise<{ readonly ok: boolean; readonly page: string; readonly mode: string }> {
    const discussionId = await this.openThread(page, residue);
    const eventId = await this.personReplies(discussionId, 'Preflight reply', residue);
    const window = await this.claimWindowFor(eventId);

    await window.conclude();

    return {
      ok: canonicalNotionId(window.pageId) === canonicalNotionId(page),
      page: window.pageId,
      mode: window.envelope.mode,
    };
  }

  /**
   * Returns the actor of an evaluation run. This way a thread that a run opens in normal operation
   * is opened by the run and not by the chat, and the person's reply in the thread continues in
   * evaluation mode.
   */
  evaluationActor(label: string): RunActor {
    return {
      kind: 'run',
      runId: `gate-${this.gate}-${label}-${randomUUID()}`,
      mode: 'event_evaluation',
      provenance: { origin: 'operator' },
      startedAt: new Date(),
    };
  }

  /** Returns the canonical id of the Task status property, by which proposal effects are read. */
  statusProperty(): string {
    return this.propertyOf('task.status');
  }

  /** Returns the canonical id of the Task `Date` property. */
  dateProperty(): string {
    return this.propertyOf('task.date');
  }

  /**
   * Returns a reader of records in canonical form, which the gate uses to check that the world
   * reads as designed.
   */
  recordReader(): NotionRecordReader {
    return this.app.get(NotionRecordReader);
  }

  /** Returns an App service through which the gate talks to the App as normal operation does. */
  service<T>(type: Type<T>): T {
    return this.app.get(type);
  }

  /**
   * Takes snapshots of the world's pages, by scenario key. Comments are read with a separate
   * request per page, so a world whose evidence takes the comments from the run's effects does not
   * ask for them in the snapshots.
   */
  async snapshots(ids: Ids, withComments = true): Promise<Record<string, PageSnapshot>> {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(ids).map(async ([key, id]): Promise<[string, PageSnapshot]> => [
          key,
          await this.snapshot(id, withComments),
        ]),
      ),
    );
  }

  /**
   * Returns the thread the system opened on the page during the run. `null` means the run said
   * nothing: there is nothing further to reply to.
   */
  async threadOn(pageId: string, residue: Residue): Promise<string | null> {
    const thread = await this.app.get(PrismaService).systemDiscussion.findFirst({
      where: { pageId: { in: [pageId, canonicalNotionId(pageId)] } },
      orderBy: { lastWrittenAt: 'desc' },
    });

    if (thread === null) return null;

    residue.threads.push(thread.discussionId);

    return thread.discussionId;
  }

  /**
   * Returns the evidence of one run: the run trace and the world before it and after. A run that
   * did not reach a conclusion about behavior (deferred on the plan quota, did not report) yields
   * no evidence. That is a conduct fault, not a violation, and the verdict reports it as one.
   */
  async evidenceOf(
    step: string,
    trace: TraceView,
    ids: Ids,
    before: Record<string, PageSnapshot>,
    discussionId?: string,
  ): Promise<Evidence> {
    return {
      ...(await this.evidenceBase(step, trace, before, await this.snapshots(ids))),
      continuations: discussionId === undefined ? [] : await this.continuationsOn(discussionId),
    };
  }

  /**
   * Builds the part of the evidence that is the same for every world. Each world reads
   * continuations in its own way: M5 from the thread, M6 from the run's effects.
   */
  protected async evidenceBase(
    step: string,
    trace: TraceView,
    before: Record<string, PageSnapshot>,
    after: Record<string, PageSnapshot>,
  ): Promise<Omit<Evidence, 'continuations'>> {
    const views = this.app.get(RunViews);
    const unfinished = unreached(trace, this.refusedQueries(trace.id));

    if (unfinished !== null) {
      throw new UnreachedRunError(
        `${step}: ${unfinished}`,
        step,
        trace,
        views.of(trace.id),
        views.readsOf(trace.id),
      );
    }

    return {
      step,
      trace,
      before,
      after,
      proposals: await this.proposalsOf(trace.id),
      gbrainWrites: this.gbrainWritesOf(trace),
      bot: await this.bot(),
      statusProperty: this.statusProperty(),
    };
  }

  /** Returns the proposals a run made, with their state in `pending_actions`. */
  async proposalsOf(runId: string): Promise<ProposalView[]> {
    const rows = await this.app
      .get(PrismaService)
      .pendingAction.findMany({ where: { proposedByRunId: runId }, orderBy: { createdAt: 'asc' } });

    return rows.map(proposalViewOf);
  }

  /**
   * Approves the proposal as the person and has the executor write it. The gate has no workers, so
   * the executor is called here, the way a loop would call it. Returns the state of the proposal.
   *
   * Approval takes effect in a real workspace, so the gate approves only a proposal that writes to
   * the gate's own pages: the model could propose a change on a foreign page, and the executor
   * would write it.
   */
  async approveAndExecute(proposalId: string, residue: Residue): Promise<string> {
    const prisma = this.app.get(PrismaService);
    const proposal = await prisma.pendingAction.findUniqueOrThrow({ where: { id: proposalId } });
    const outside = pagesOutside(
      residue,
      effectsSchema.parse(proposal.effects).map((effect) => effect.pageId),
    );

    if (outside.length > 0) {
      throw new Error(
        `refusing to approve the proposal ${proposalId}: it writes outside the pages the gate created (${outside.join(', ')})`,
      );
    }

    await this.app.get(ApprovalsService).approve(CHAT, proposalId);
    await this.app.get(ActionExecutor).execute(proposal);

    return (await prisma.pendingAction.findUniqueOrThrow({ where: { id: proposalId } })).status;
  }

  /**
   * Brings the thread continuation due immediately: the row is moved into the past, and the run
   * source takes it the way the scheduler does. A thread can have a wake and a closure together,
   * so the caller says which row class it wants. Returns the run request and the way to conclude
   * the row.
   */
  async claimCheckFor(discussionId: string, kind: ReasonClass): Promise<ClaimedCheck> {
    const check = await this.app.get(PrismaService).scheduledCheck.findFirstOrThrow({
      where: {
        discussionId: canonicalNotionId(discussionId),
        status: 'pending',
        reasonCode: { in: reasonsOf(kind) },
      },
    });

    return this.claimCheck(check.id);
  }

  /**
   * Does the same for a row identified by id: the continuation a run wrote is known from its
   * effects, and there is no need to look for it among the thread's rows. The row is claimed by
   * id, not among candidates: a candidate is only the head of a queue partition, and a
   * continuation that stands behind a foreign one (the owner's reply in the middle of a gate run)
   * would not be found.
   */
  async claimCheck(checkId: string): Promise<ClaimedCheck> {
    await this.app.get(PrismaService).scheduledCheck.update({
      where: { id: checkId },
      data: { runAt: subSeconds(new Date(), 1) },
    });

    const claimed = await this.app.get(ScheduledCheckRunSource).claim(checkId);

    if (!claimed) {
      throw new InfrastructureError(`the continuation ${checkId} could not be claimed`);
    }

    await claimed.recordAttempt();

    return {
      envelope: claimed.request.envelope,
      provenance: claimed.request.provenance,
      // A run in the gate reads the real Notion, so it did reach Notion.
      conclude: () => claimed.conclude(true),
    };
  }

  /**
   * Requests closure of a thread the App found resolved, the way the producer would do it.
   */
  requestClosure(thread: ClosureRequest): Promise<'requested' | 'already_requested'> {
    return this.app.get(ContinuationsService).requestClosure(thread);
  }

  /** Schedules a thread wake for later, the way the person sets it with “check back later”. */
  async scheduleWake(thread: ClosureRequest, runAt: Date): Promise<void> {
    await this.app.get(ContinuationsService).schedule(CHAT, {
      ...thread,
      runAt,
      reasonCode: 'await_external_event',
    });
  }

  /**
   * Waits until the operator resolves the thread in Notion: the API cannot resolve it. A thread is
   * resolved once it is absent from the page's comments. `false` means the wait timed out.
   *
   * The wrapper `infra/bin/gate` summons the operator with the signals of `gate-signals.ts`: a
   * request at the start of the wait, an all-clear when the thread is resolved or the time is up.
   */
  async awaitResolved(pageId: string, discussionId: string): Promise<boolean> {
    const thread = canonicalNotionId(discussionId);
    const deadline = addMilliseconds(new Date(), RESOLVE_TIMEOUT_MS);

    process.stderr.write(
      needsPersonLine(
        `${this.gate} gate: resolve the thread on https://www.notion.so/${pageId.replaceAll('-', '')} now — waiting up to ${RESOLVE_TIMEOUT_MS / 60_000} minutes`,
      ),
    );

    while (isBefore(new Date(), deadline)) {
      const stillOpen = await this.threadOpen(pageId, thread);

      if (stillOpen === false) {
        process.stderr.write(personDoneLine(`${this.gate} gate: the thread is resolved, going on`));

        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, RESOLVE_POLL_MS));
    }

    process.stderr.write(personDoneLine(`${this.gate} gate: the thread was not resolved in time`));

    return false;
  }

  /**
   * Checks whether this thread is still among the page's comments. A network drop in the middle of
   * the wait is not an answer: the polling goes on, and `null` says the check failed this time.
   */
  private async threadOpen(pageId: string, thread: string): Promise<boolean | null> {
    try {
      const results = await allComments(this.app.get(Client), pageId);

      return results.some((comment) => canonicalNotionId(comment.discussion_id) === thread);
    } catch (error) {
      process.stderr.write(
        `${this.gate} gate: could not read the comments, will try again: ${String(error)}\n`,
      );

      return null;
    }
  }

  /**
   * Returns the canonical id of the property that carries the slot (`task.status`): the Notion
   * event spells it that way.
   */
  propertyOf(slot: string): string {
    const [id] = [...this.app.get(SemanticAdapter).watchedPropertyIds([slot]).ids];

    if (id === undefined) throw new Error(`the binding has no carrier of ${slot}`);

    return String(id);
  }

  /**
   * Submits a Notion event about a person's edit to the same ingress as the webhook's. A page event
   * includes its parent database, as Notion sends it; a comment event includes the page and the
   * thread.
   */
  async notionEvent(ids: Ids, event: NotionEventInput): Promise<IntakeView> {
    this.assertRunning();

    const pageId = pageOf(ids, event.page);
    const eventId = randomUUID();
    const outcome = await this.app.get(NotionIntake).accept(
      notionEventSchema.parse({
        id: eventId,
        type: event.type,
        timestamp: new Date().toISOString(),
        entity:
          event.type === 'comment.created'
            ? { id: event.commentId, type: 'comment' }
            : { id: pageId, type: 'page' },
        authors: [{ id: randomUUID(), type: 'person' }],
        attempt_number: 1,
        data:
          event.type === 'comment.created'
            ? { page_id: pageId, discussion_id: event.discussionId }
            : await this.pageEventData(pageId, event.slots),
      }),
    );

    // The cleanup register removes a window on a world page through its page; the event receipt
    // stays (`UNMANAGED`).
    return {
      eventId,
      windowed: outcome.kind === 'absorbed',
      reason: outcome.kind === 'rejected' ? outcome.reason : null,
    };
  }

  /** Returns a Notion client in the person's name: the personal token of the gate workspace. */
  protected personalClient(): Client {
    const token = process.env.GATE_NOTION_PERSONAL_TOKEN;

    if (!token) {
      throw new HarnessError(
        'GATE_NOTION_PERSONAL_TOKEN is unset: a person-authored edit needs it',
      );
    }

    return new Client({
      auth: token,
      notionVersion: this.app.get<NotionConfig>(notionConfig.KEY).apiVersion,
    });
  }

  /**
   * Builds the data of a page event: the parent database and, for properties, their ids as Notion
   * sends them.
   */
  private async pageEventData(
    pageId: string,
    slots: readonly string[] | undefined,
  ): Promise<Record<string, unknown>> {
    const page = await this.app.get(PageReader).page(pageId);

    return {
      ...(page.dataSourceId === null
        ? {}
        : {
            parent: { id: page.dataSourceId, type: 'database', data_source_id: page.dataSourceId },
          }),
      ...(slots === undefined
        ? {}
        : {
            // On the wire the property ids are encoded as Notion sends them: the ingress decodes
            // them exactly once.
            updated_properties: slots.map((slot) => encodeURIComponent(this.propertyOf(slot))),
          }),
    };
  }

  /** Reads a page as the run left it: name, status, mode, dates, trash and comments. */
  private async snapshot(pageId: string, withComments: boolean): Promise<PageSnapshot> {
    const adapter = this.app.get(SemanticAdapter);
    const page = await this.app.get(PageReader).page(pageId);
    const type =
      page.dataSourceId === null ? undefined : adapter.typeOfDataSource(page.dataSourceId);
    const readings = new Map<string, Reading>(
      type === undefined ? [] : Object.entries(adapter.decode(type, page).readings),
    );
    const named = NAME_FIELD[type ?? 'task'] ?? 'name';

    return {
      id: pageId,
      name: plain(readings.get(named)),
      status: plain(readings.get('status')),
      mode: plain(readings.get('mode')),
      lifecycle: plain(readings.get('lifecycle')),
      date: plain(readings.get('date')),
      deadline: plain(readings.get('deadline')),
      inTrash: page.inTrash,
      comments: page.inTrash || !withComments ? [] : await this.seenComments(pageId),
      dataSource: page.dataSourceId === null ? null : canonicalNotionId(page.dataSourceId),
    };
  }

  /**
   * Returns a page's comments with the ids Notion assigns: by them a new comment is told apart
   * from an old one with the same text.
   */
  private async seenComments(pageId: string): Promise<SeenComment[]> {
    const results = await allComments(this.app.get(Client), pageId);

    return results.map((comment) => ({
      id: comment.id,
      text: commentText(comment),
      author: comment.created_by.id,
      discussionId: canonicalNotionId(comment.discussion_id),
    }));
  }

  /**
   * Creates a world page in Notion in the bot's name, with canonical values encoded by the live
   * schema.
   */
  private async create(
    page: WorldPage,
    ids: Record<string, string>,
    residue: Residue,
  ): Promise<string> {
    this.assertRunning();

    const adapter = this.app.get(SemanticAdapter);
    const dataSourceId = adapter.dataSourceOf(page.type);
    const types = await this.app.get(LiveSchema).typesOf(dataSourceId);
    const created = await this.app
      .get(NotionWriter)
      .createPage(dataSourceId, this.encoded(adapter, page, ids, types));

    residue.pages.push(created.id);

    if (page.body !== undefined) await this.writeBody(created.id, page.body);

    return created.id;
  }

  /**
   * Appends paragraphs to the end of the page body, in the name of the Notion client the world
   * writes with.
   */
  async writeBody(
    pageId: string,
    paragraphs: readonly string[],
    notion: Client = this.app.get(Client),
  ): Promise<void> {
    this.assertRunning();

    await notion.blocks.children.append({
      block_id: pageId,
      children: paragraphs.map((content) => ({
        type: 'paragraph' as const,
        paragraph: { rich_text: [{ type: 'text' as const, text: { content } }] },
      })),
    });
  }

  private encoded(
    adapter: SemanticAdapter,
    page: WorldPage,
    ids: Record<string, string>,
    types: PhysicalTypes,
  ): ReturnType<SemanticAdapter['encode']> {
    const linked = (keys: readonly string[] | undefined): readonly string[] =>
      (keys ?? []).map((key) => {
        const id = ids[key];

        if (id === undefined) throw new Error(`the world links ${key} before it exists`);

        return id;
      });

    switch (page.type) {
      case 'project':
        return adapter.encode(
          'project',
          {
            name: text(page.name),
            status: option(page.status),
            ...(page.keyResults === undefined
              ? {}
              : { key_results: links(...linked(page.keyResults)) }),
          },
          types,
        );

      case 'task': {
        const writes: Partial<Record<FieldOf<'task'>, CanonicalWrite>> = {
          name: text(page.name),
          status: option(page.status),
          ...(page.project === undefined ? {} : { project: links(...linked([page.project])) }),
          ...(page.blockedBy === undefined
            ? {}
            : { dependencies: links(...linked(page.blockedBy)) }),
          ...(page.areaOfFocus === undefined
            ? {}
            : { area_of_focus: links(...linked([page.areaOfFocus])) }),
          ...(page.behaviorSystem === undefined
            ? {}
            : { behavior_system: links(...linked([page.behaviorSystem])) }),
          ...(page.dateInDays === undefined
            ? {}
            : { date: this.dateIn(page.dateInDays, page.dateAt) }),
          ...(page.deadlineInDays === undefined
            ? {}
            : { deadline: this.dateIn(page.deadlineInDays) }),
        };

        return adapter.encode('task', writes, types);
      }

      case 'identity':
        return adapter.encode('identity', { name: text(page.name) }, types);

      case 'area_of_focus':
        return adapter.encode(
          'area_of_focus',
          {
            name: text(page.name),
            mode: option(page.mode),
            ...(page.identities === undefined
              ? {}
              : { identities: links(...linked(page.identities)) }),
          },
          types,
        );

      case 'objective':
        return adapter.encode(
          'objective',
          {
            desired_change: text(page.name),
            ...(page.areaOfFocus === undefined
              ? {}
              : { supports_area_of_focus: links(...linked([page.areaOfFocus])) }),
          },
          types,
        );

      // The capture time is the instant of the build, as Notion would set the creation time
      // (`workspace/capture-overlay.ts`).
      case 'inbox_item':
        return adapter.encode(
          'inbox_item',
          {
            captured_title: text(page.name),
            ...(page.text === undefined ? {} : { captured_text: text(page.text) }),
            captured_at: { kind: 'date', start: new Date().toISOString(), end: null },
          },
          types,
        );

      case 'key_result':
        return adapter.encode(
          'key_result',
          { name: text(page.name), objective: links(...linked([page.objective])) },
          types,
        );

      case 'behavior_system':
        return adapter.encode(
          'behavior_system',
          { behavior: text(page.name), lifecycle: option(page.lifecycle) },
          types,
        );
    }
  }

  /**
   * Returns the day `days` days from today in the App's zone: a date without a time, as a person
   * writes it, or the instant on that day when a time of day is named (`HH:MM`).
   */
  protected dateIn(days: number, at?: string): CanonicalWrite {
    const day = dayIn(wallClock(this.timeZone(), new Date()), days);

    if (at === undefined) return { kind: 'date', start: day, end: null };

    const [year, month, date] = day.split('-').map(Number);
    const [hours, minutes] = at.split(':').map(Number);
    const moment = instantOfLocalDate(
      this.timeZone(),
      { year: year ?? 0, month: month ?? 0, day: date ?? 0 },
      (hours ?? 0) * 60 + (minutes ?? 0),
    );

    return { kind: 'date', start: moment.toISOString(), end: null };
  }
}

/** Describes a proposal from a `pending_actions` row: state and effects in words. */
export function proposalViewOf(row: PendingAction): ProposalView {
  return {
    id: row.id,
    status: row.status,
    effects: effectsSchema.parse(row.effects).map((effect) => ({
      pageId: effect.pageId,
      propertyId: effect.propertyId,
      option: effect.value.kind === 'option' ? effect.value.option : null,
      value: valueOf(effect.value),
    })),
  };
}

/** Describes the value of a proposal in words: what the person is offered to have written. */
export function valueOf(value: CanonicalWrite): string {
  switch (value.kind) {
    case 'option':
      return value.option;

    case 'text':
      return `text: ${value.text.slice(0, 80)}`;

    case 'date':
      return value.end === null ? value.start : `${value.start}..${value.end}`;

    case 'links':
      return `links: ${value.pageIds.length}`;

    case 'clear':
      return 'clear';
  }
}

/**
 * Returns the calendar date `days` after the date `today`. It counts days, not hours: the day of a
 * switch to the other time lasts 23 or 25 hours, and shifting an instant by `days × 24` hours
 * would skip or repeat a day around the switch.
 */
export function dayIn(today: Pick<Wall, 'year' | 'month' | 'day'>, days: number): string {
  return new Date(Date.UTC(today.year, today.month - 1, today.day + days))
    .toISOString()
    .slice(0, 10);
}
