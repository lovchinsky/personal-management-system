import { BotIdentity } from '../../src/notion/client/bot-identity';
import { BotIdentityUnknownError } from '../../src/notion/client/notion.error';
import {
  A_PERSON,
  buildIntakeHarness,
  IntakeHarness,
  OUR_BOT,
  propertyEvent,
  WireEvent,
} from './intake.harness';

/**
 * `INV-087` Intake classifies an event by its authors: when all authors are the integration bot
 * with its id, the event is the system's own write; anything else is a person's change. While the
 * bot's identity is unknown, classification refuses and the provider redelivers.
 */
describe('INV-087', () => {
  describe('the author is known', () => {
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

    const authorsOf: [string, WireEvent['authors'], 'rejected' | 'absorbed'][] = [
      ['only our bot', [{ id: OUR_BOT, type: 'bot' }], 'rejected'],
      [
        'our bot twice',
        [
          { id: OUR_BOT, type: 'bot' },
          { id: OUR_BOT, type: 'bot' },
        ],
        'rejected',
      ],
      [
        'our bot and a person',
        [
          { id: OUR_BOT, type: 'bot' },
          { id: A_PERSON, type: 'person' },
        ],
        'absorbed',
      ],
      ['a person', [{ id: A_PERSON, type: 'person' }], 'absorbed'],
      ['a foreign bot', [{ id: 'someone-elses-bot', type: 'bot' }], 'absorbed'],
      ['a bot with no id', [{ type: 'bot' }], 'absorbed'],
      ['our id as a person', [{ id: OUR_BOT, type: 'person' }], 'absorbed'],
      ['no authors', [], 'absorbed'],
    ];

    it.each(authorsOf)('%s', async (_, authors, expected) => {
      const outcome = await harness.intake.accept(propertyEvent({ authors }));

      expect(outcome.kind).toBe(expected);
    });
  });

  /**
   * There is nothing to classify with, so the event is not lost and is not blindly treated as a
   * person's. The receipt stays `failed`, and the provider's redelivery carries it through.
   */
  describe('the author is unknown', () => {
    let harness: IntakeHarness;

    const unknown: Pick<BotIdentity, 'require'> = {
      require: () => Promise.reject(new BotIdentityUnknownError()),
    };

    beforeAll(async () => {
      harness = await buildIntakeHarness(undefined, unknown);
    });

    afterAll(async () => {
      await harness.close();
    });

    it('the receipt stays `failed` and there is no window', async () => {
      await harness.reset();

      await expect(
        harness.intake.accept(propertyEvent({ authors: [{ id: A_PERSON, type: 'person' }] })),
      ).rejects.toThrow(BotIdentityUnknownError);

      const receipt = await harness.prisma.webhookReceipt.findFirstOrThrow();

      expect(receipt.status).toBe('failed');
      await expect(harness.prisma.evaluationWindow.count()).resolves.toBe(0);
    });
  });
});
