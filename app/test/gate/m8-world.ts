import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { subHours } from 'date-fns';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { AttentionService } from '../../src/attention/attention.service';
import { keyboardFor, renderMessage } from '../../src/delivery/channels/telegram/telegram.renderer';
import { outboundMessageSchema } from '../../src/delivery/port/channel.port';
import { ChannelRegistry } from '../../src/delivery/port/channel.registry';
import { packetFor } from '../../src/delivery/port/packet';
import type { WorkflowMode } from '../../src/generated/prisma/enums';
import { canonicalNotionId } from '../../src/notion/client/notion-id';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { occurrenceAt, occurrenceBefore } from '../../src/platform/time/schedule';
import { ReviewOccurrenceRepository } from '../../src/reviews/review-occurrence.repository';
import { ReviewOccurrenceRunSource } from '../../src/reviews/review-occurrence.run-source';
import { reviewsConfig, type ReviewsConfig } from '../../src/reviews/reviews.config';
import type { RunActor } from '../../src/runs/actor';
import type { TraceView } from '../../src/runs/run-traces';
import type { ReviewMode, TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { ResolutionReconciler } from '../../src/sweeps/resolution.reconciler';
import { SafetySweep } from '../../src/sweeps/safety-sweep';
import { sweepConfig, type SweepConfig } from '../../src/sweeps/sweep.config';
import { SweepFinder } from '../../src/sweeps/sweep.finder';
import { textsOf } from '../../src/texts/texts';
import { HarnessError, InfrastructureError } from './gate-attempts';
import type { GateName } from './gate-boot';
import type { Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import type { ScenarioInfo } from './m6-scenarios';
import { M6World } from './m6-world';
import { buildVerified } from './m6-world-check';
import { foreignIn } from './m8-environment';
import type {
  ClaimedWindow,
  DeliveredPacket,
  Evidence8,
  M8Port,
  OpenedThread,
  ReconcileTick,
  ThreadMemory,
  Woken,
} from './m8-evidence';
import {
  fixtureProblems,
  Fixtures,
  later,
  readyAt,
  type FixtureKey,
  type FixtureRegistry,
} from './m8-fixtures';
import { D1_PROPOSAL_QUESTION, d1ProposalOf } from './m8-scenarios';
import type { MemoryStates } from './memory-evidence';
import { NotionAllowance } from './notion-allowance';
import type { MemoryPage } from './scenario-kit';
import { pageOf, type Ids } from './scenario-world';

/**
 * All the ways gate M8 touches the environment beyond what gate M6 can do: review occurrences,
 * sweep and reconciliation ticks, ingress events, the person's words in a page body, seeded items.
 * Each step takes the path the App takes in normal operation: an occurrence through its row and the
 * run source, a tick through the same service as in normal operation, an event through the same
 * ingress as the webhook.
 */
export class M8World extends M6World implements M8Port {
  private readonly fixtures: Fixtures;
  private readonly registry: FixtureRegistry;

  constructor(app: INestApplicationContext, gate: GateName) {
    super(app, gate);
    this.fixtures = new Fixtures(app);
    this.registry = this.fixtures.registry();
  }

  /** Returns the seeded items by key. The claims will not find pages that do not exist. */
  fixturePages(): Readonly<Record<FixtureKey, string>> {
    return {
      plain: this.registry.inbox.plain?.page ?? '',
      asked: this.registry.inbox.asked?.page ?? '',
    };
  }

  /**
   * Lists how the seeded state currently differs from the declared one. An empty list means the
   * seeded state is ready for the reviews.
   */
  async fixtureProblems(): Promise<string[]> {
    return fixtureProblems(this.registry, await this.fixtures.observe(this.registry), new Date());
  }

  /** Lists what is foreign in the gate environment: pages and rows that were not seeded. */
  foreign(): Promise<string[]> {
    return foreignIn(this.app, this.registry);
  }

  /** Returns the candidates of the real sweep finder over the whole workspace: page and rule. */
  async finderCandidates(): Promise<{ readonly pageId: string; readonly rule: string }[]> {
    const now = new Date();
    const { recencyHours } = this.app.get<SweepConfig>(sweepConfig.KEY);
    const candidates = await this.app.get(SweepFinder).find(now, subHours(now, recencyHours));

    return candidates.map((candidate) => ({
      pageId: canonicalNotionId(candidate.pageId),
      rule: candidate.rule,
    }));
  }

  /**
   * Determines where the person's reply in a thread opened by a run of mode `mode` is routed: the
   * thread, the reply in the channel and a window closed without a run. Returns the mode of the
   * window.
   */
  async replyRoute(pageId: string, mode: WorkflowMode, residue: Residue): Promise<WorkflowMode> {
    const actor: RunActor = {
      kind: 'run',
      runId: `gate-${this.gate}-route-${randomUUID()}`,
      mode,
      provenance: { origin: 'review_schedule' },
      startedAt: new Date(),
    };
    const thread = await this.opened(pageId, 'Gate: система питає про цей запис', actor, residue);
    const eventId = await this.personReplies(thread.discussionId, 'Preflight reply', residue);
    const window = await this.claimWindowFor(eventId);

    await window.conclude();

    return window.envelope.mode;
  }

  awaitAllowance(mode: WorkflowMode): Promise<void> {
    return this.app.get(NotionAllowance).ready(mode, () => this.assertRunning());
  }

  /**
   * Checks the environment before an attempt: nothing but what was seeded, and the seeded items in
   * the declared state. Whether they are already stale does not matter here. Staleness is a
   * condition of the scenarios, which the model-free check enforces by blocking them, not a state
   * of the environment.
   */
  async assertIsolated(): Promise<void> {
    const foreign = await foreignIn(this.app, this.registry);
    const defects =
      Object.keys(this.registry.inbox).length === 0
        ? []
        : fixtureProblems(
            this.registry,
            await this.fixtures.observe(this.registry),
            later(readyAt(this.registry), new Date()),
          );

    if (foreign.length > 0 || defects.length > 0) {
      throw new InfrastructureError(
        `the gate environment is not as declared: ${[...foreign, ...defects].join('; ')}`,
      );
    }
  }

  buildWorld(pages: World, info: ScenarioInfo, residue: Residue): Promise<Ids> {
    return buildVerified(this, info, pages, residue);
  }

  plant(pages: readonly MemoryPage[], ids: Ids, residue: Residue): Promise<void> {
    return this.plantMemory(pages, ids, residue);
  }

  /**
   * Conducts a review run on the occurrence row of the current period by the gate schedule, claimed
   * by the run source the way the scheduler claims it. `since` is the prior occurrence. The review
   * runs for the first time.
   */
  async review(mode: ReviewMode, ids: Ids, step: string, residue: Residue): Promise<Evidence8> {
    this.assertRunning();

    const schedule = this.app.get<ReviewsConfig>(reviewsConfig.KEY).schedules[mode];
    const now = new Date();
    const occurrence = occurrenceAt(schedule, this.timeZone(), now);

    if (occurrence === null || occurrence.closesAt <= now) {
      throw new HarnessError(`the gate schedule of ${mode} has no open occurrence now`);
    }

    const since = occurrenceBefore(schedule, this.timeZone(), occurrence)?.at ?? occurrence.at;
    const placed = await this.app.get(ReviewOccurrenceRepository).place({
      mode,
      occurrenceKey: occurrence.key,
      dueAt: occurrence.at,
      closesAt: occurrence.closesAt,
      sinceAt: since,
    });

    if (!placed) {
      throw new InfrastructureError(
        `the ${mode} occurrence ${occurrence.key} is placed already: an earlier attempt left it`,
      );
    }

    const row = await this.app.get(PrismaService).reviewOccurrence.findFirstOrThrow({
      where: { mode, occurrenceKey: occurrence.key },
    });

    residue.occurrences.push(row.id);

    const claimed = await this.app.get(ReviewOccurrenceRunSource).claim(row.id);

    if (!claimed) throw new InfrastructureError(`the occurrence ${row.id} could not be claimed`);

    await claimed.recordAttempt();

    return this.ran(step, ids, residue, claimed.request.envelope, async (envelope) => {
      const trace = await this.run(envelope, claimed.request.provenance, residue);

      // A gate run reads the real Notion, so it reached Notion.
      await claimed.conclude(true);

      return trace;
    });
  }

  /**
   * Plants a proposal that an evaluation run placed earlier: a thread with the explanation and the
   * proposal in it.
   */
  async plantProposal(ids: Ids, key: string, residue: Residue): Promise<string> {
    const pageId = pageOf(ids, key);
    const actor = this.evaluationActor('proposal');
    const thread = await this.opened(pageId, D1_PROPOSAL_QUESTION, actor, residue);
    const approvals = this.app.get(ApprovalsService);
    const proposal = await approvals.check(
      actor,
      d1ProposalOf(pageId, this.statusProperty(), thread.discussionId),
    );
    const row = await approvals.record(actor, proposal);

    residue.proposals.push(row.id);

    return row.id;
  }

  /**
   * Creates a system thread and the person's reply to it in the channel. The window that the reply
   * opened is closed without a run.
   */
  async personAnswers(
    ids: Ids,
    key: string,
    question: string,
    answer: string,
    residue: Residue,
  ): Promise<void> {
    const thread = await this.opened(
      pageOf(ids, key),
      question,
      this.evaluationActor('question'),
      residue,
    );
    const eventId = await this.personReplies(thread.discussionId, answer, residue);
    const window = await this.claimWindowFor(eventId);

    await window.conclude();
  }

  /** Creates a system thread on a page of the world on behalf of an evaluation run. */
  systemThread(ids: Ids, key: string, text: string, residue: Residue): Promise<OpenedThread> {
    return this.opened(pageOf(ids, key), text, this.evaluationActor('thread'), residue);
  }

  /**
   * Performs a sweep tick through the service used in normal operation and returns the wakes it
   * placed.
   */
  async sweepTick(residue: Residue): Promise<readonly Woken[]> {
    this.assertRunning();

    const prisma = this.app.get(PrismaService);
    const earlier = await prisma.scheduledCheck.findMany({
      where: { reasonCode: 'safety_recheck' },
      select: { id: true },
    });

    await this.app.get(SafetySweep).sweep();

    const rows = await prisma.scheduledCheck.findMany({
      where: {
        reasonCode: 'safety_recheck',
        discussionId: null,
        id: { notIn: earlier.map((row) => row.id) },
      },
      orderBy: { createdAt: 'asc' },
    });

    residue.continuations.push(...rows.map((row) => row.id));

    return rows.map((row) => ({ checkId: row.id, pageId: canonicalNotionId(row.notionPageId) }));
  }

  /** Conducts a run of the wake the sweep placed, claimed by id the way the scheduler claims it. */
  async wake(checkId: string, ids: Ids, step: string, residue: Residue): Promise<Evidence8> {
    const check = await this.claimCheck(checkId);

    return this.ran(step, ids, residue, check.envelope, async (envelope) => {
      const trace = await this.run(envelope, check.provenance, residue);

      await check.conclude();

      return trace;
    });
  }

  /**
   * Performs a reconciliation tick through the same service as in normal operation and returns the
   * closure requests it placed, and its memory.
   */
  async reconcileTick(threads: readonly string[], residue: Residue): Promise<ReconcileTick> {
    this.assertRunning();

    const prisma = this.app.get(PrismaService);
    const earlier = await prisma.scheduledCheck.findMany({
      where: { reasonCode: 'resolution_reconciliation' },
      select: { id: true },
    });

    await this.app.get(ResolutionReconciler).reconcile();

    const rows = await prisma.scheduledCheck.findMany({
      where: {
        reasonCode: 'resolution_reconciliation',
        id: { notIn: earlier.map((row) => row.id) },
      },
      orderBy: { createdAt: 'asc' },
    });
    const canonical = threads.map(canonicalNotionId);
    const memory = await prisma.discussionReconciliation.findMany({
      where: { discussionId: { in: [...threads, ...canonical] } },
    });

    residue.continuations.push(...rows.map((row) => row.id));

    return {
      closures: rows.map((row) => ({
        checkId: row.id,
        discussionId: canonicalNotionId(row.discussionId ?? ''),
      })),
      memory: Object.fromEntries(
        memory.map((row): [string, ThreadMemory] => [
          canonicalNotionId(row.discussionId),
          {
            seenOpenAt: row.seenOpenAt?.toISOString() ?? null,
            closureRequestedAt: row.closureRequestedAt?.toISOString() ?? null,
            goneAt: row.goneAt?.toISOString() ?? null,
          },
        ]),
      ),
    };
  }

  /** The person resolves a thread in Notion: the gate calls the operator and waits. */
  personResolves(ids: Ids, key: string, discussionId: string): Promise<boolean> {
    return this.awaitResolved(pageOf(ids, key), discussionId);
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.app.get(Client).comments.delete({ comment_id: commentId });
  }

  /**
   * The person writes to the page body with a personal token, so the author of the block is the
   * person, as in the event that will report the edit.
   */
  async writeNote(ids: Ids, key: string, paragraphs: readonly string[]): Promise<void> {
    await this.writeBody(pageOf(ids, key), paragraphs, this.personalClient());
  }

  async personMovesDeadline(ids: Ids, key: string, inDays: number): Promise<void> {
    await this.moveDeadline(pageOf(ids, key), inDays);
  }

  /** Claims a window made up of events, once it is due, the way the scheduler claims it. */
  async claimWindow(eventId: string): Promise<ClaimedWindow> {
    const window = await this.claimWindowFor(eventId);
    const { trigger } = window.envelope;
    const eventTypes = 'event_types' in trigger ? trigger.event_types : [];

    return {
      mode: window.envelope.mode,
      eventTypes,
      type: trigger.type,
      pageId: window.pageId,
      run: (ids, step, residue) =>
        this.ran(step, ids, residue, window.envelope, async (envelope) => {
          const trace = await this.run(envelope, window.provenance, residue);

          await window.conclude();

          return trace;
        }),
    };
  }

  /** Cleans up the attempt and returns the seeded items to the declared state. */
  override async clean(residue: Residue): Promise<readonly string[]> {
    const left = await super.clean(residue);

    return [...left, ...(await this.fixtures.restore(this.registry))];
  }

  /**
   * Conducts a run and gathers its evidence: snapshots of the world and the memory state before
   * the run, the thread registry before the run (new threads are those that were not there) and,
   * after the run, what it wrote and its packets as the person will see them.
   */
  private async ran(
    step: string,
    ids: Ids,
    residue: Residue,
    envelope: TriggerEnvelope,
    go: (envelope: TriggerEnvelope) => Promise<TraceView>,
  ): Promise<Evidence8> {
    const prisma = this.app.get(PrismaService);
    const [before, memoryBefore, threadsBefore] = await Promise.all([
      this.snapshots(ids, false),
      this.memoryStates(residue),
      prisma.systemDiscussion.findMany({ select: { discussionId: true } }),
    ]);
    const trace = await go(envelope);
    const after = await this.memoryStates(residue);
    const memory: MemoryStates = {
      slugs: after.slugs,
      before: memoryBefore.states,
      after: after.states,
    };
    const fixtures = this.fixturePages();
    const base = await this.evidenceFor(
      step,
      trace,
      ids,
      before,
      null,
      memory,
      Object.values(fixtures).filter((id) => id.length > 0),
    );
    const known = new Set(threadsBefore.map((row) => canonicalNotionId(row.discussionId)));
    const newThreads = [
      ...new Set(base.written.comments.map((comment) => canonicalNotionId(comment.discussionId))),
    ].filter((thread) => !known.has(thread));

    for (const thread of newThreads) residue.threads.push(thread);

    return { ...base, packets: await this.packetsOf(trace), newThreads, fixtures };
  }

  /**
   * Builds the packets of a run from the outbox rows, with the thread, as the channel renders
   * them.
   */
  private async packetsOf(trace: TraceView): Promise<DeliveredPacket[]> {
    const ids = (trace.runtimeEffects ?? [])
      .filter((effect) => effect.kind === 'delivery')
      .map((effect) => effect.id);
    const rows = await this.app
      .get(PrismaService)
      .notificationOutbox.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
    const channel = this.app.get(ChannelRegistry).find('telegram');

    if (channel === undefined) {
      throw new HarnessError('the gate has no Telegram channel: the packets cannot be rendered');
    }

    const texts = textsOf(this.language()).telegram;

    return rows.map((row) => {
      const message = outboundMessageSchema.parse(row.payload);
      const packet = packetFor(channel, message);

      return {
        notice: {
          noticed: message.noticed,
          whyItMatters: message.whyItMatters,
          ask: message.ask,
          link: message.link,
          ...(message.context === undefined ? {} : { context: message.context }),
          ...(message.prepared === undefined ? {} : { prepared: message.prepared }),
          ...(message.proposals === undefined ? {} : { proposals: message.proposals }),
        },
        discussionId: row.discussionId === null ? null : canonicalNotionId(row.discussionId),
        text: renderMessage(packet, texts),
        buttons: keyboardFor(packet, texts).map((buttons) => buttons.map((button) => button.text)),
      };
    });
  }

  /**
   * Opens a system thread on behalf of a run and returns the ids of the thread and of the comment
   * by which the reconciliation recognizes it.
   */
  private async opened(
    pageId: string,
    text: string,
    actor: RunActor,
    residue: Residue,
  ): Promise<OpenedThread> {
    this.assertRunning();

    const written = await this.app.get(AttentionService).comment(actor, { pageId, text });
    const discussionId = canonicalNotionId(written.discussionId);

    residue.threads.push(discussionId);

    return { discussionId, commentId: canonicalNotionId(written.commentId) };
  }
}
