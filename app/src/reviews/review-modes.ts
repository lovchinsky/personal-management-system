import type { ReviewMode } from '../runs/trigger-envelope';

/**
 * Scheduled reviews, in order of frequency. The `Record` is keyed by all of them, so a review with
 * no entry does not compile.
 */
const ORDER: Readonly<Record<ReviewMode, number>> = {
  daily_control: 0,
  weekly_control_review: 1,
  strategic_review: 2,
  deep_review: 3,
};

export const REVIEW_MODES: readonly ReviewMode[] = Object.keys(ORDER)
  .filter(isReviewMode)
  .sort((one, other) => ORDER[one] - ORDER[other]);

export function isReviewMode(mode: string): mode is ReviewMode {
  return Object.hasOwn(ORDER, mode);
}
