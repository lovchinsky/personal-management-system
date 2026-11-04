import { APIErrorCode } from '@notionhq/client';
import {
  REPLY,
  replyOver,
  SENT_AT,
  THREAD,
  THREAD_PAGE,
} from '../../../test/fixtures/channel-reply-world';
import { notionAnswer } from '../../../test/fixtures/notion-answer.fixture';
import { CHANNEL_MESSAGE_EVENT, ReplyOutcome } from './channel-reply';

describe("a person's reply from the channel", () => {
  it("to a message about a thread goes into that thread, and the person's words open the window", async () => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD });

    await expect(reply.reply(REPLY, receipt())).resolves.toEqual({ kind: 'replied' });

    expect(log.steps).toEqual(['quote', 'record page', 'window']);
    expect(log.quoted).toEqual([[THREAD, 'Telegram', REPLY.text]]);
    expect(log.recorded).toEqual([THREAD_PAGE]);
    expect(log.absorbed).toEqual([
      {
        pageId: THREAD_PAGE,
        discussionId: THREAD,
        occurredAt: SENT_AT,
        personReplied: true,
        inboxItemCreated: false,
        channelInbound: true,
        eventId: 'telegram:17',
        eventType: CHANNEL_MESSAGE_EVENT,
      },
    ]);
  });

  /**
   * The channel serves a dialogue the system started, so a reply to a message that leads to no
   * thread has nothing to attach to. It becomes neither an Inbox item nor a comment anywhere.
   */
  it('to a message that leads to no thread is refused with a reason, and nothing is written', async () => {
    const { reply, log, receipt } = await replyOver({ thread: null });

    const outcome = await reply.reply(REPLY, receipt());

    expect(outcome).toMatchObject({ kind: 'unconsumed' });
    expect(log.steps).toEqual([]);
  });

  it('a redelivery does not write a second comment, because the receipt names the thread', async () => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD });

    await reply.reply(REPLY, receipt(THREAD_PAGE));

    expect(log.steps).toEqual(['window']);
    expect(log.absorbed.map((event) => event.pageId)).toEqual([THREAD_PAGE]);
  });

  it('a comment that fails opens no window and does not swallow the error', async () => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD, quoteFails: true });

    await expect(reply.reply(REPLY, receipt())).rejects.toThrow('Notion is down');

    expect(log.absorbed).toHaveLength(0);
    expect(log.recorded).toHaveLength(0);
  });

  /**
   * Notion is currently unavailable and the App does not store the text anywhere, so the person is
   * told to send the words later. No window is opened, because a run has nothing to process
   * (ADR 0045).
   */
  it.each<[string, Error]>([
    ['Notion answers that it is unavailable', notionAnswer(APIErrorCode.ServiceUnavailable, 503)],
    ['Notion does not answer in time', notionAnswer(APIErrorCode.GatewayTimeout, 504)],
    ['the network does not reach Notion', new TypeError('fetch failed')],
  ])('when %s, the words are not recorded and there is no window', async (_, refusal) => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD, quoteRefusal: refusal });
    const expected: ReplyOutcome = { kind: 'not_recorded' };

    await expect(reply.reply(REPLY, receipt())).resolves.toEqual(expected);

    expect(log.recorded).toHaveLength(0);
    expect(log.absorbed).toHaveLength(0);
  });

  /**
   * A refusal that does not clear on its own is an intake failure, not “send it later”, because
   * the refusal will be the same later.
   */
  it.each<[string, Error]>([
    ["the integration's access is not accepted", notionAnswer(APIErrorCode.Unauthorized, 401)],
    [
      'the thread the message leads to does not exist',
      notionAnswer(APIErrorCode.ObjectNotFound, 404),
    ],
  ])('when %s, the error propagates and there is no window', async (_, refusal) => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD, quoteRefusal: refusal });

    await expect(reply.reply(REPLY, receipt())).rejects.toBe(refusal);

    expect(log.absorbed).toHaveLength(0);
  });
});
