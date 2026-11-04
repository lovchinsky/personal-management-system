import { VALID_BINDING_FILE } from '../fixtures/notion-mapping.fixture';
import {
  buildIntakeHarness,
  IntakeHarness,
  OUR_BOT,
  pageCreatedEvent,
  propertyEvent,
} from './intake.harness';
import { fillDay } from './ledger-rows';

const INBOX = VALID_BINDING_FILE.data_sources.inbox_item;
const TASKS = VALID_BINDING_FILE.data_sources.task;

/**
 * An item the person put in the Inbox is a separate origin (`inbox_capture`). The run processes
 * each item separately, in mode `dialogue`, in the class “the person put an item”
 * and without the daily limit (`docs/2-system.md` § “Webhook intake”).
 */
describe('an item the person put in the Inbox', () => {
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

  it('becomes the processing of an Inbox item in a conversation', async () => {
    await harness.intake.accept(pageCreatedEvent(INBOX));

    const [candidate] = await harness.ripe();
    const claimed = candidate && (await harness.windowRuns.claim(candidate.id));

    expect(candidate?.provenance).toEqual({ origin: 'inbox_capture' });
    expect(claimed?.request.envelope).toMatchObject({
      mode: 'dialogue',
      trigger: { type: 'page.created', page_id: 'page-1' },
    });
  });

  it('a page created in another database is an ordinary change', async () => {
    await harness.intake.accept(pageCreatedEvent(TASKS));

    const candidates = await harness.ripe();

    expect(candidates.map((candidate) => candidate.provenance)).toEqual([
      { origin: 'evaluation_window' },
    ]);
  });

  /** An item the system itself put in is its own write: there is no one to process it. */
  it('an item parked by the system does not wake a run', async () => {
    const outcome = await harness.intake.accept(
      pageCreatedEvent(INBOX, { authors: [{ id: OUR_BOT, type: 'bot' }] }),
    );

    expect(outcome.kind).toBe('rejected');
    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(0);
  });

  /**
   * Processing comes ahead of autonomous work, and the daily limit does not stop it, because the
   * person put the item in. A limit exhausted by autonomous runs leaves a change window waiting,
   * while the item is processed.
   */
  it('processing does not wait behind the daily limit', async () => {
    await fillDay(harness.prisma);

    await harness.intake.accept(propertyEvent({ entity: { id: 'page-2', type: 'page' } }));
    await harness.intake.accept(pageCreatedEvent(INBOX));
    await harness.ripe();

    await harness.scheduler.runOnce();
    await harness.scheduler.runOnce();

    const trace = await harness.prisma.runTrace.findFirstOrThrow({
      where: { originKind: 'inbox_capture' },
    });

    expect(harness.launcher.launched.map((envelope) => envelope.mode)).toEqual(['dialogue']);
    expect(trace.budgetClass).toBe('exempt');
  });

  it('is processed ahead of autonomous work when the limit is open', async () => {
    await harness.intake.accept(propertyEvent({ entity: { id: 'page-2', type: 'page' } }));
    await harness.intake.accept(pageCreatedEvent(INBOX));
    await harness.ripe();

    await harness.scheduler.runOnce();

    expect(harness.launcher.launched.map((envelope) => envelope.mode)).toEqual(['dialogue']);
  });
});
