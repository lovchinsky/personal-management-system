import type { NotionWait } from '../runs/notion-wait-notice';
import { textsOf } from '../texts/texts';
import { Delivery, deliverySchema } from './delivery.schema';
import { notionGaveUpDelivery, notionWaitingDelivery } from './notion-wait.message';
import { outboundMessageSchema } from './port/channel.port';

const PAGE = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const THREAD = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';

/** The window for the person's channel reply, which waits for Notion. */
const WAIT: NotionWait = { windowId: 'window-1', discussionId: THREAD, pageId: PAGE };

/** The notices in `uk`: the wording here is the specification of the Ukrainian catalog. */
const UK = textsOf('uk').notices.notionWait;

/** A notice to a person who replied in the channel while Notion is unavailable (ADR 0045). */
describe('notice about a reply that waits for Notion', () => {
  it('while the window waits, tells the person an answer will come, with the thread and the page', () => {
    const delivery: Delivery = {
      idempotencyKey: 'notion-wait:window-1',
      channel: 'telegram',
      discussionId: THREAD,
      message: {
        noticed: 'Твоя відповідь дійшла, але Notion зараз недоступний.',
        whyItMatters:
          'Без нього я не бачу ні справи, ні твоєї відповіді, тож відповісти поки не можу.',
        ask: 'Нічого робити не треба: відповім, щойно Notion запрацює.',
        link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
      },
    };

    expect(notionWaitingDelivery(WAIT, UK)).toEqual(delivery);
  });

  it('when the window no longer waits, asks the person to write again', () => {
    const delivery: Delivery = {
      idempotencyKey: 'notion-gave-up:window-1',
      channel: 'telegram',
      discussionId: THREAD,
      message: {
        noticed: 'Notion був недоступний добу, і відповісти на твоє повідомлення не вдалося.',
        whyItMatters:
          'Чекати далі я не буду, тож без нового повідомлення справа лишиться без відповіді.',
        ask: 'Напиши, будь ласка, ще раз — відповіддю на це повідомлення.',
        link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
      },
    };

    expect(notionGaveUpDelivery(WAIT, UK)).toEqual(delivery);
  });

  /**
   * The key is the window, not the run. A window can wait any number of times, but there is a
   * single notice. The real reply after recovery has a run key, so it is not dropped because of
   * this notice.
   */
  it('the key is the window in its own space, separate for each of the two notices', () => {
    const later: NotionWait = { ...WAIT, pageId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' };

    expect(notionWaitingDelivery(later, UK).idempotencyKey).toBe(
      notionWaitingDelivery(WAIT, UK).idempotencyKey,
    );
    expect(
      [notionWaitingDelivery(WAIT, UK), notionGaveUpDelivery(WAIT, UK)].map(
        (delivery) => delivery.idempotencyKey,
      ),
    ).toEqual(['notion-wait:window-1', 'notion-gave-up:window-1']);
  });

  it.each([
    ['waiting', notionWaitingDelivery(WAIT, UK)],
    ['no longer waiting', notionGaveUpDelivery(WAIT, UK)],
  ])(
    '%s: the packet passes the delivery and port schemas and has no reason or proposals',
    (_, delivery) => {
      expect(deliverySchema.safeParse(delivery).success).toBe(true);
      expect(outboundMessageSchema.safeParse(delivery.message).success).toBe(true);
      expect(delivery.message.context).toBeUndefined();
      expect(delivery.message.proposals).toBeUndefined();
    },
  );

  /** The same builder, a different catalog: the wording is the language's job, not the code's. */
  it('has the same parts in English', () => {
    const en = textsOf('en').notices.notionWait;
    const waiting: Delivery['message'] = {
      noticed: 'Your reply arrived, but Notion is unavailable right now.',
      whyItMatters:
        'Without it I can see neither the matter nor your reply, so I cannot answer yet.',
      ask: 'Nothing to do: I will answer as soon as Notion is back.',
      link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
    };
    const gaveUp: Delivery['message'] = {
      noticed: 'Notion was unavailable for a day, and your message went unanswered.',
      whyItMatters:
        'I will not wait any longer, so without a new message the matter stays unanswered.',
      ask: 'Please write again, as a reply to this message.',
      link: 'https://www.notion.so/1f2e3d4c5b6a49788a9b0c1d2e3f4a5b',
    };

    expect(notionWaitingDelivery(WAIT, en).message).toEqual(waiting);
    expect(notionGaveUpDelivery(WAIT, en).message).toEqual(gaveUp);
  });
});
