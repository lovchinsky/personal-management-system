import { addDays, subDays } from 'date-fns';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { RunActor } from '../../src/runs/actor';
import { TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import { buildIntakeHarness, commentEvent, IntakeHarness, propertyEvent } from './intake.harness';

/** A run without the person that noticed a change and commented in a thread. */
const NOTICED: RunActor = {
  kind: 'run',
  runId: 'run-1',
  mode: 'event_evaluation',
  provenance: { origin: 'evaluation_window' },
  startedAt: new Date(),
};

/** A conversation in the channel: the system commented in the thread from a `dialogue` run. */
const TALKING: RunActor = {
  kind: 'run',
  runId: 'run-2',
  mode: 'dialogue',
  provenance: { origin: 'channel_inbound' },
  startedAt: new Date(),
};

/** Weekly Control Review: a run without the person that also writes on Inbox items. */
const REVIEWING: RunActor = {
  ...NOTICED,
  runId: 'run-3',
  mode: 'weekly_control_review',
  provenance: { origin: 'review_schedule' },
};

const PAGE = 'page-1';

/**
 * `INV-089` The system manages a discussion if it has commented in it or if a continuation or
 * proposal is open on it; a person's reply in a managed discussion is a `managed_discussion_reply`
 * run, and a comment outside a managed discussion is an ordinary page change.
 */
describe('INV-089', () => {
  let harness: IntakeHarness;

  beforeAll(async () => {
    harness = await buildIntakeHarness();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** Opens a thread with a comment from the system, as in a real run. */
  const opened = async (actor: RunActor = NOTICED): Promise<string> => {
    const written = await harness.attention.comment(actor, {
      pageId: PAGE,
      text: 'Задача чекає на відповідь постачальника вже тиждень',
    });

    return written.discussionId;
  };

  const envelopeOfRipe = async (): Promise<TriggerEnvelope> => {
    const [candidate] = await harness.ripe();
    const claimed = candidate && (await harness.windowRuns.claim(candidate.id));

    if (!claimed) {
      throw new Error('no ripe window to claim');
    }

    return claimed.request.envelope;
  };

  describe("a person's reply to the system", () => {
    it('in a thread where the system commented is a reply run', async () => {
      const thread = await opened();

      await harness.intake.accept(commentEvent(thread));

      const candidates = await harness.ripe();

      expect(candidates.map((candidate) => candidate.provenance)).toEqual([
        { origin: 'managed_discussion_reply' },
      ]);
    });

    it('in a thread with an open continuation is a reply run', async () => {
      const thread = '5b6a4978-8a9b-4c1d-9e2f-3a4b5c6d7e8f';

      await harness.moduleRef.get(ContinuationsService).schedule(NOTICED, {
        discussionId: thread,
        notionPageId: PAGE,
        runAt: addDays(new Date(), 1),
        reasonCode: 'await_external_event',
      });
      await harness.intake.accept(commentEvent(thread));

      await expect(harness.prisma.evaluationWindow.findFirstOrThrow()).resolves.toMatchObject({
        personReplied: true,
      });
    });

    it('in a thread with an open closure is a reply run', async () => {
      const thread = '7d8e9f0a-1b2c-4d3e-9f4a-5b6c7d8e9f0a';

      await harness.moduleRef
        .get(ContinuationsService)
        .requestClosure({ discussionId: thread, notionPageId: PAGE });
      await harness.intake.accept(commentEvent(thread));

      await expect(harness.prisma.evaluationWindow.findFirstOrThrow()).resolves.toMatchObject({
        personReplied: true,
      });
    });

    it('in a thread with an open proposal is a reply run', async () => {
      const thread = '6c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f';

      await harness.prisma.pendingAction.create({
        data: {
          discussionId: thread,
          proposedByRunId: 'run-1',
          notionPageId: '7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a',
          fingerprint: 'fingerprint-1',
          effects: [],
          preconditions: [],
        },
      });
      await harness.intake.accept(commentEvent(thread));

      await expect(harness.prisma.evaluationWindow.findFirstOrThrow()).resolves.toMatchObject({
        personReplied: true,
      });
    });

    /**
     * A thread id from an event may arrive in another form. The translation happens once, at
     * ingress, so the window, and with it the envelope, hold the thread in the same form as the
     * registry.
     */
    it('the thread is recognized by an id without hyphens too, and the window holds the canonical form', async () => {
      const thread = await opened();

      await harness.intake.accept(commentEvent(thread.replaceAll('-', '').toUpperCase()));

      await expect(harness.prisma.evaluationWindow.findFirstOrThrow()).resolves.toMatchObject({
        personReplied: true,
        discussionId: thread,
      });
    });
  });

  describe('a comment that does not reply to the system', () => {
    it("in someone else's thread is an ordinary page change", async () => {
      await harness.intake.accept(commentEvent('7d8e9f0a-1b2c-4d3e-9f4a-5b6c7d8e9f0a'));

      const candidates = await harness.ripe();

      expect(candidates.map((candidate) => candidate.provenance)).toEqual([
        { origin: 'evaluation_window' },
      ]);
    });

    /**
     * A conversation in which the system has been silent for half a year is no longer its own: a
     * reply in it is an ordinary change if no continuation or proposal holds the thread.
     */
    it('in an old thread with no continuation or proposal is an ordinary change', async () => {
      const thread = await opened();

      await harness.prisma.systemDiscussion.update({
        where: { discussionId: thread },
        data: { lastWrittenAt: subDays(new Date(), 200) },
      });
      await expect(harness.attention.pruneStale(180)).resolves.toBe(1);
      await harness.intake.accept(commentEvent(thread));

      await expect(harness.prisma.evaluationWindow.findFirstOrThrow()).resolves.toMatchObject({
        personReplied: false,
      });
    });
  });

  /**
   * The window source returns candidates for each origin: an older window of an autonomous change
   * does not hide a person's fresh reply from the scheduler.
   */
  it("a person's reply is not hidden behind an older change window", async () => {
    await harness.intake.accept(propertyEvent({ entity: { id: 'page-2', type: 'page' } }));

    const thread = await opened();

    await harness.intake.accept(commentEvent(thread));

    const candidates = await harness.ripe();

    expect(candidates.map((candidate) => candidate.provenance)).toEqual(
      expect.arrayContaining([
        { origin: 'managed_discussion_reply' },
        { origin: 'evaluation_window' },
      ]),
    );
  });

  it("a later edit of the page does not cancel a person's reply", async () => {
    const thread = await opened();

    await harness.intake.accept(commentEvent(thread));
    await harness.intake.accept(propertyEvent());

    await expect(harness.prisma.evaluationWindow.findFirstOrThrow()).resolves.toMatchObject({
      personReplied: true,
    });
  });

  describe('the reply envelope', () => {
    it('contains the thread in which the person spoke', async () => {
      const thread = await opened();

      await harness.intake.accept(commentEvent(thread));

      const envelope = await envelopeOfRipe();

      expect(envelope).toMatchObject({
        mode: 'event_evaluation',
        trigger: { type: 'comment.created', page_id: PAGE, discussion_id: thread },
      });
    });

    /** A thread the system managed in a conversation continues as a conversation. */
    it('continues the mode in which the system managed the thread', async () => {
      const thread = await opened(TALKING);

      await harness.intake.accept(commentEvent(thread));

      await expect(envelopeOfRipe()).resolves.toMatchObject({ mode: 'dialogue' });
    });

    /** A reply about an Inbox item is its processing, whoever opened the thread. */
    it('a review thread on an Inbox item continues as a conversation', async () => {
      harness.notion.place(PAGE, VALID_BINDING_FILE.data_sources.inbox_item);

      const thread = await opened(REVIEWING);

      await harness.intake.accept(commentEvent(thread));

      await expect(envelopeOfRipe()).resolves.toMatchObject({ mode: 'dialogue' });
    });

    it('a review thread on a Task continues as an evaluation', async () => {
      harness.notion.place(PAGE, VALID_BINDING_FILE.data_sources.task);

      const thread = await opened(REVIEWING);

      await harness.intake.accept(commentEvent(thread));

      await expect(envelopeOfRipe()).resolves.toMatchObject({ mode: 'event_evaluation' });
    });

    /** The first write sets a thread's mode: a later write from another run does not change it. */
    it('a write by another run in a conversation thread leaves it a conversation', async () => {
      const thread = await opened(TALKING);

      await harness.attention.comment(NOTICED, { pageId: PAGE, discussionId: thread, text: 'x' });
      await harness.intake.accept(commentEvent(thread));

      await expect(envelopeOfRipe()).resolves.toMatchObject({ mode: 'dialogue' });
    });

    it('a change without a comment contains no thread', async () => {
      await harness.intake.accept(propertyEvent());

      const envelope = await envelopeOfRipe();

      expect(Object.keys(envelope.trigger)).not.toContain('discussion_id');
    });
  });
});
