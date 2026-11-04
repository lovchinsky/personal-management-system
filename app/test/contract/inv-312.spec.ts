import { REPLY, replyOver, THREAD } from '../fixtures/channel-reply-world';
import { repoFile } from './contracts';

/**
 * `INV-312` A person's reply in the channel to a system message is written to Notion — as a
 * quoting comment by the bot in the thread the message belongs to — before any step of the model,
 * and only then is the evaluation window opened. Neither the run's trigger envelope nor `app_db`
 * carries the content of the reply. Text that is not a reply to a system message is not accepted:
 * the channel is meant only for a dialogue that the system starts.
 *
 * The reply consumer runs against fakes of the thread and the window store. The Notion write
 * precedes the window, and only identifiers go into the window. The consumer does not import the
 * model, so the absence of a runner does not lose the reply.
 */
describe('INV-312', () => {
  it('the comment in the thread precedes the window', async () => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD });

    await reply.reply(REPLY, receipt());

    expect(log.steps.indexOf('quote')).toBeGreaterThanOrEqual(0);
    expect(log.steps.indexOf('quote')).toBeLessThan(log.steps.indexOf('window'));
  });

  /** The window knows what happened and where; what the person said lives only in Notion. */
  it('the window gets identifiers and flags, but not the content of the reply', async () => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD });

    await reply.reply(REPLY, receipt());

    expect(log.absorbed).toHaveLength(1);
    expect(JSON.stringify(log.absorbed)).not.toContain(REPLY.text);
  });

  /**
   * A Notion write failure does not open the window, because the run has nothing to process. A
   * failure that clears on its own is reported to the person at once (ADR 0045); any other is
   * retried on redelivery.
   */
  it('a failed write opens no window and swallows no error', async () => {
    const { reply, log, receipt } = await replyOver({ thread: THREAD, quoteFails: true });

    await expect(reply.reply(REPLY, receipt())).rejects.toThrow('Notion is down');

    expect(log.absorbed).toHaveLength(0);
  });

  /** A reply that leads to no thread is not accepted and writes nothing. */
  it('a reply to a message with no thread writes nothing', async () => {
    const { reply, log, receipt } = await replyOver({ thread: null });

    await expect(reply.reply(REPLY, receipt())).resolves.toMatchObject({ kind: 'unconsumed' });

    expect(log.steps).toEqual([]);
  });

  /**
   * Without the model the reply is not lost: the consumer does not depend on the runner, the App
   * MCP or a run.
   */
  it('the reply consumer imports nothing from the model', () => {
    const source = repoFile('app/src/intake/channel/channel-reply.ts');
    const imported = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

    expect(
      imported.filter((path) => /\/(claude|mcp)\/|run\.(dispatcher|launcher)/.test(path)),
    ).toEqual([]);
    expect(imported.length).toBeGreaterThan(0);
  });

  /** `app_db` holds none of the reply's content, in either the window row or the receipt. */
  it('the window and receipt tables have no column for the reply text', () => {
    const schema = repoFile('app/prisma/schema.prisma');
    const columns = ['EvaluationWindow', 'WebhookReceipt'].flatMap((name) => {
      const model = new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`).exec(schema)?.[0] ?? '';

      return [...model.matchAll(/^\s+(\w+)\s+\S+/gm)].map((match) => match[1]);
    });

    expect(columns).toEqual(expect.arrayContaining(['channelInbound', 'diagnostics']));
    expect(columns.filter((column) => /^(text|body|content|message)$/i.test(column))).toEqual([]);
  });
});
