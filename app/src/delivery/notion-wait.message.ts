import type { NotionWait } from '../runs/notion-wait-notice';
import type { NoticeTexts } from '../texts/texts';
import { Delivery } from './delivery.schema';
import { pageLink } from './notion-link';

type NotionWaitTexts = NoticeTexts['notionWait'];

/**
 * Builds the notice to a person who replied in the channel while Notion is unavailable
 * (ADR 0045). The window for their reply waits for Notion: “I will answer as soon as Notion is
 * back”.
 *
 * The key is built from the window in its own `notion-wait:` space, not from the run (`event:`,
 * ADR 0025), because the real reply after recovery has a run key and must not be dropped as a
 * repeat of this notice. A window can wait any number of times, but there is a single notice.
 */
export function notionWaitingDelivery(wait: NotionWait, texts: NotionWaitTexts): Delivery {
  return delivery(`notion-wait:${wait.windowId}`, wait, texts.waiting);
}

/**
 * Builds the notice that the window for the person's reply waited for Notion for a day and no
 * longer waits. There will be no answer, and the person will send their message again, as a reply
 * to this notice, so that it lands in the same thread.
 */
export function notionGaveUpDelivery(wait: NotionWait, texts: NotionWaitTexts): Delivery {
  return delivery(`notion-gave-up:${wait.windowId}`, wait, texts.gaveUp);
}

function delivery(
  idempotencyKey: string,
  wait: NotionWait,
  texts: NotionWaitTexts['waiting'],
): Delivery {
  return {
    idempotencyKey,
    channel: 'telegram',
    discussionId: wait.discussionId,
    message: {
      noticed: texts.noticed,
      whyItMatters: texts.whyItMatters,
      ask: texts.ask,
      link: pageLink(wait.pageId),
    },
  };
}
