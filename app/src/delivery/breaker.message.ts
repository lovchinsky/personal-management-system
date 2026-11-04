import { BreakerOpening } from '../runs/breaker-notice';
import type { NoticeTexts } from '../texts/texts';
import { Delivery } from './delivery.schema';
import { pageLink, WORKSPACE_LINK } from './notion-link';

/** How much of the failure reason the notice shows: the person finds the rest in the run trace. */
const REASON_CHARS = 280;

/**
 * Builds the notice about an open breaker. The notice has no request that a button could settle:
 * five consecutive failures mean the run path is broken, and it is the person who fixes it, not
 * a decision in the notice.
 *
 * The delivery key is derived from the last failed run: the same opening yields the same key, so
 * a process restart or a repeated notification queues no second notice, while a new failure after
 * the breaker closes is a different opening and a different notice.
 */
export function breakerDelivery(opening: BreakerOpening, texts: NoticeTexts['breaker']): Delivery {
  const reason = opening.reason?.trim();

  return {
    idempotencyKey: `breaker:${opening.lastFailedRunId}`,
    channel: 'telegram',
    message: {
      noticed: texts.noticed(opening.failures),
      whyItMatters: texts.whyItMatters,
      ...(reason ? { context: texts.reason(reason.slice(0, REASON_CHARS)) } : {}),
      ask: texts.ask,
      // The run that opened the breaker might not name a page.
      link: opening.pageId === null ? WORKSPACE_LINK : pageLink(opening.pageId),
    },
  };
}
