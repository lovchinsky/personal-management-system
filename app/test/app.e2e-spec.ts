import { randomInt } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { appConfig } from '../src/config/app.config';
import { TelegramUpdate } from '../src/intake/channel/telegram/telegram-update.schema';
import { PrismaService } from '../src/platform/db/prisma.service';
import { TelegramClient } from '../src/telegram/telegram.client';
import { textsOf } from '../src/texts/texts';
import { bootApp } from './boot-app';
import { buttonPress } from './fixtures/telegram';

describe("the App's HTTP perimeter (e2e)", () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    app = await bootApp();
  });

  it('/health answers with the state of the database', () => {
    const appDb = { app_db: { status: 'up' } };

    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', info: appDb, error: {}, details: appDb });
  });

  /**
   * The webhook limit is counted once per request. The global guard applies each profile to every
   * route that does not skip it; a guard attached to the controller as well would count the same
   * key a second time, and a batch of provider retries would be cut off at half of its limit.
   */
  describe('throttler', () => {
    const WEBHOOKS: string[] = ['/webhooks/notion', '/webhooks/telegram'];

    it.each(WEBHOOKS)('%s is counted in the webhooks profile once per request', async (path) => {
      const { headers } = await request(app.getHttpServer()).post(path).send({}).expect(401);

      expect(
        Number(headers['x-ratelimit-limit-webhooks']) -
          Number(headers['x-ratelimit-remaining-webhooks']),
      ).toBe(1);
      // Webhooks skip the `default` profile because a limit sized for a person would reject a
      // batch of provider retries.
      expect(headers['x-ratelimit-remaining']).toBeUndefined();
    });

    it('all other routes are counted in the default profile', async () => {
      const { headers } = await request(app.getHttpServer()).get('/health').expect(200);

      expect(headers['x-ratelimit-remaining']).toBeDefined();
    });
  });

  describe('Telegram webhook', () => {
    /** What the application is started with. `setup-e2e.ts` only sets the default values. */
    const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    const ALLOWED = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
    const FOREIGN = ALLOWED + 1;

    /**
     * Returns an update id that is new on every run of the lane. The e2e database is not cleaned
     * between runs, and intake would take a repeated id for a duplicate.
     */
    const freshUpdateId = (): number => randomInt(2 ** 47);

    /**
     * Builds a button press from chat `chatId`. The proposal id is a real uuid with no proposal
     * behind it.
     */
    const press = (chatId: number, updateId = freshUpdateId()): TelegramUpdate =>
      buttonPress(updateId, { chatId });

    /**
     * The guard enforces `INV-022`, and the guard is a controller decorator, so a check of the
     * guard on its own does not see that link. Here an update takes the same path as one from the
     * provider. Without the secret, or from a foreign chat, it gets 401 (not 404, because the
     * route exists), leaves no receipt and does not call the Bot API.
     */
    it('an update without the secret or from a foreign chat is dropped without a trace or a reply', async () => {
      const prisma = app.get(PrismaService);
      const client = app.get(TelegramClient);
      const answered = jest.spyOn(client, 'answerCallbackQuery');
      const sent = jest.spyOn(client, 'sendMessage');
      const before = await prisma.webhookReceipt.count();

      await request(app.getHttpServer())
        .post('/webhooks/telegram')
        .send(press(ALLOWED))
        .expect(401);
      await request(app.getHttpServer())
        .post('/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', SECRET)
        .send(press(FOREIGN))
        .expect(401);

      await expect(prisma.webhookReceipt.count()).resolves.toBe(before);
      expect(answered).not.toHaveBeenCalled();
      expect(sent).not.toHaveBeenCalled();
    });

    /**
     * Confirms that the refusal above really comes from the guard and not from a broken route: an
     * update with the secret from an allowed chat goes through the whole intake path to the reply
     * to the person. The network call to the Bot API is stubbed. Nothing else is substituted here.
     */
    it('an update with the secret from an allowed chat reaches the reply to the person', async () => {
      const prisma = app.get(PrismaService);
      const answered = jest
        .spyOn(app.get(TelegramClient), 'answerCallbackQuery')
        .mockResolvedValue({ ok: true });
      const updateId = freshUpdateId();

      await request(app.getHttpServer())
        .post('/webhooks/telegram')
        .set('x-telegram-bot-api-secret-token', SECRET)
        .send(press(ALLOWED, updateId))
        .expect(200);

      const receipt = await prisma.webhookReceipt.findUniqueOrThrow({
        where: { source_externalId: { source: 'telegram', externalId: String(updateId) } },
      });

      expect(receipt.status).toBe('processed');
      expect(answered).toHaveBeenCalledWith(
        `cb-${updateId}`,
        textsOf(appConfig().language).telegram.answers.notAwaiting,
        false,
      );
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
