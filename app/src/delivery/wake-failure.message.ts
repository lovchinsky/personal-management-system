import type { WakeFailure } from '../continuations/wake-failure-notice';
import type { Gender } from '../texts/gender';
import type { Language } from '../texts/language';
import { spokenMoment } from '../texts/spoken-dates';
import type { NoticeTexts } from '../texts/texts';
import { runDeliveryKey } from './delivery-key';
import { Delivery } from './delivery.schema';
import { pageLink } from './notion-link';

/**
 * Builds the notice about a wake whose time the person named and that did not take place
 * (`INV-108`).
 *
 * The delivery key is the one the run of this wake would have set: a reminder the run managed to
 * queue before it failed stays the only one, and a retry after a failure between the delivery
 * queue and the mark yields no second message. The notice includes the wake's thread, as the
 * reminder would have: a reply to it continues the same conversation.
 *
 * The notice includes no technical reason, because the reason is of no use to the person. The
 * evidence stays on the row and in the run trace.
 */
export function wakeFailureDelivery(
  failure: WakeFailure,
  texts: NoticeTexts['wakeFailure'],
  installation: { readonly language: Language; readonly timeZone: string; readonly gender: Gender },
  now: Date,
): Delivery {
  const moment = spokenMoment(failure.runAt, installation.language, installation.timeZone, now);

  return {
    idempotencyKey: runDeliveryKey(failure.cause),
    channel: 'telegram',
    ...(failure.discussionId === null ? {} : { discussionId: failure.discussionId }),
    message: {
      noticed: texts.noticed(failure.reasonCode, moment, installation.gender),
      whyItMatters: texts.whyItMatters(failure.reasonCode, installation.gender),
      ask: texts.ask,
      link: pageLink(failure.pageId),
    },
  };
}
