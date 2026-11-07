import type { LocalDate } from '../platform/time/local-day';
import { periodOfKey, type KeyedPeriod } from '../platform/time/schedule';
import type { ReviewMode } from '../runs/trigger-envelope';
import type { Language } from '../texts/language';
import { spokenDay, spokenDays } from '../texts/spoken-dates';
import type { NoticeTexts } from '../texts/texts';
import { Delivery } from './delivery.schema';

/** How much of the failure reason the notice shows: the person finds the rest in the run trace. */
const REASON_CHARS = 280;

/**
 * An occurrence of a review that did not take place: which review, which period and why, as the
 * row records it.
 */
export interface ReviewFailure {
  readonly mode: ReviewMode;
  readonly occurrenceKey: string;
  readonly reason: string | null;
}

type ReviewFailureTexts = NoticeTexts['reviewFailure'];

/**
 * Builds the notice about a review occurrence that did not take place, both after exhausted
 * attempts and when retired past the window. There is no catching up on reviews (ADR 0036), and a
 * packet with no findings is silent too, so without this notice the person could not tell
 * “nothing was found” from “the review did not take place”.
 *
 * The delivery key is the review and the period: the same occurrence yields the same key, so a
 * retry after a failure does not enqueue a second message (`INV-105`).
 */
export function reviewFailureDelivery(
  failure: ReviewFailure,
  texts: ReviewFailureTexts,
  language: Language,
  today: LocalDate,
): Delivery {
  const reason = failure.reason?.trim();
  const period = periodLabel(periodOfKey(failure.occurrenceKey), texts, language, today);

  return {
    idempotencyKey: `review-failed:${failure.mode}:${failure.occurrenceKey}`,
    channel: 'telegram',
    message: {
      noticed: texts.noticed(failure.mode, period),
      whyItMatters: texts.whyItMatters(failure.mode),
      ...(reason ? { context: texts.reason(reason.slice(0, REASON_CHARS)) } : {}),
      ask: texts.ask(failure.mode),
    },
  };
}

/**
 * Returns the period in the person's words (ADR 0046). A day and a week are written as days in
 * the language's format, “27 жовтня” (October 27) and “20–26 жовтня” (October 20 – 26). A month is
 * written with its year the same way, and a quarter comes from the catalog, because `Intl` does
 * not know quarters.
 */
function periodLabel(
  period: KeyedPeriod,
  texts: ReviewFailureTexts,
  language: Language,
  today: LocalDate,
): string {
  switch (period.kind) {
    case 'daily':
      return spokenDay(period.date, language, today);
    case 'weekly':
      return spokenDays(period.first, period.last, language, today);
    case 'monthly':
      return new Intl.DateTimeFormat(language, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(Date.UTC(period.year, period.month - 1, 1));
    case 'quarterly':
      return texts.quarter(period.quarter, period.year);
  }
}
