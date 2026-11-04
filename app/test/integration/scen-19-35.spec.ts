import { IntakeOutcome } from '../../src/intake/notion/notion-intake';
import {
  A_PERSON,
  buildIntakeHarness,
  IntakeHarness,
  OUR_BOT,
  propertyEvent,
  WATCHED_PROPERTY,
} from './intake.harness';

/** What intake says about the system's own write. */
const OWN: IntakeOutcome = {
  kind: 'rejected',
  reason: 'own write of the system: every author is the integration bot',
};

/**
 * `SCEN-19-35` A system write that produced a webhook does not create a self-loop.
 * `INV-018` A person's change is not suppressed: only an event whose authors are all the
 * integration bot is the system's own write.
 *
 * The pair is deliberately in one file: a rule that suppresses too much satisfies the first and
 * breaks the second, so the two cannot be verified apart from each other. The difference rests
 * on the author: the system writes only through the App and REST, and Notion attributes this to
 * the integration bot (ADR 0017).
 */
describe("the system's own write and a person's edit", () => {
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

  it('a system write does not wake a run', async () => {
    const outcome = await harness.intake.accept(
      propertyEvent({ authors: [{ id: OUR_BOT, type: 'bot' }] }),
    );

    expect(outcome).toEqual(OWN);
    await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(0);
  });

  /**
   * The same property, the same page, the same time — and still a person's edit: the author
   * sets it apart.
   */
  it("a person's edit of the same property after a system write is taken up", async () => {
    await harness.intake.accept(propertyEvent({ authors: [{ id: OUR_BOT, type: 'bot' }] }));

    const outcome = await harness.intake.accept(
      propertyEvent({
        authors: [{ id: A_PERSON, type: 'person' }],
        data: { updated_properties: [WATCHED_PROPERTY] },
      }),
    );

    expect(outcome.kind).toBe('absorbed');
  });

  /**
   * Notion combines a person's write and the following system write into one event with two
   * authors. The rule “our bot is among the authors → suppress” would discard the person's
   * genuine action together with ours.
   */
  it('mixed authorship counts as a change by the person', async () => {
    const outcome = await harness.intake.accept(
      propertyEvent({
        authors: [
          { id: A_PERSON, type: 'person' },
          { id: OUR_BOT, type: 'bot' },
        ],
      }),
    );

    expect(outcome.kind).toBe('absorbed');
  });
});
