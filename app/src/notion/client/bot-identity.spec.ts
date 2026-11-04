import { Logger } from '@nestjs/common';
import { Client, type UserObjectResponse } from '@notionhq/client';
import { INTEGRATION_BOT } from '../../../test/fixtures/notion-bot';
import { BotIdentity } from './bot-identity';
import { BotIdentityUnknownError } from './notion.error';

/** The integration bot, as `users.me` returns it. */
const BOT: UserObjectResponse = {
  object: 'user',
  id: INTEGRATION_BOT,
  name: 'Personal Management System',
  avatar_url: null,
  type: 'bot',
  bot: {},
};

/** A real Notion client whose `users.me` answers whatever the test says. */
function clientAnswering(me: () => Promise<UserObjectResponse>): Client {
  const client = new Client({ auth: 'secret_test' });

  jest.spyOn(client.users, 'me').mockImplementation(me);

  return client;
}

describe('BotIdentity', () => {
  let warned: jest.SpyInstance;

  beforeEach(() => {
    warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('asks Notion who we are and remembers the answer', async () => {
    const identity = new BotIdentity(clientAnswering(() => Promise.resolve(BOT)));

    await expect(identity.resolve()).resolves.toBe(INTEGRATION_BOT);
  });

  it('does not ask Notion a second time', async () => {
    const me = jest.fn(() => Promise.resolve(BOT));
    const identity = new BotIdentity(clientAnswering(me));

    await identity.resolve();
    await identity.resolve();

    expect(me).toHaveBeenCalledTimes(1);
  });

  /**
   * Notion is not a hard dependency of startup: an application that failed to start because Notion
   * is unavailable would not do even the things that do not need Notion.
   */
  it('an unavailable Notion does not fail startup and leaves a log entry', async () => {
    const identity = new BotIdentity(
      clientAnswering(() => Promise.reject(new Error('unauthorized'))),
    );

    await expect(identity.resolve()).resolves.toBeUndefined();
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('bot identity unknown'));
  });

  it('after a failure the attempt is retried and can succeed', async () => {
    const me = jest
      .fn<Promise<UserObjectResponse>, []>()
      .mockRejectedValueOnce(new Error('network reset'))
      .mockResolvedValueOnce(BOT);

    const identity = new BotIdentity(clientAnswering(me));

    await expect(identity.resolve()).resolves.toBeUndefined();
    await expect(identity.resolve()).resolves.toBe(INTEGRATION_BOT);
  });

  /** Startup neither waits for the answer nor fails because of it. */
  it('startup does not throw even when Notion refuses', () => {
    const identity = new BotIdentity(
      clientAnswering(() => Promise.reject(new Error('unauthorized'))),
    );

    expect(() => identity.onApplicationBootstrap()).not.toThrow();
  });

  /**
   * The system would not recognize a write as its own if there were nothing to check its author
   * against.
   */
  it('require() refuses with a reason without an identity, so writing is impossible', async () => {
    const unknown = new BotIdentity(clientAnswering(() => Promise.reject(new Error('down'))));
    const known = new BotIdentity(clientAnswering(() => Promise.resolve(BOT)));

    await expect(unknown.require()).rejects.toThrow(BotIdentityUnknownError);
    await expect(known.require()).resolves.toBe(INTEGRATION_BOT);
  });
});
