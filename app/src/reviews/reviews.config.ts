import { registerAs, type ConfigType } from '@nestjs/config';
import { optional } from '../platform/config/env-value';
import { parseSchedule, type Schedule } from '../platform/time/schedule';
import type { ReviewMode } from '../runs/trigger-envelope';

/**
 * The schedule of each review when the environment variable is not set: `contracts/canonical.yaml`,
 * key `review_schedules`.
 */
export const REVIEW_SCHEDULE_DEFAULTS: Readonly<Record<ReviewMode, string>> = {
  daily_control: 'daily 08:30',
  weekly_control_review: 'weekly sun 18:00',
  strategic_review: 'monthly 1 10:00',
  deep_review: 'off',
};

/**
 * Review schedules, parsed **at startup**: a bad value stops startup together with the rest of the
 * configuration instead of blowing up every minute in the occurrence producer (ADR 0036).
 *
 * An empty value is the same as an absent one: the review follows its default schedule. Only `off`
 * disables a review.
 */
export const reviewsConfig = registerAs('reviews', () => ({
  schedules: {
    daily_control: parseSchedule(
      optional(process.env.REVIEW_DAILY_CONTROL) ?? REVIEW_SCHEDULE_DEFAULTS.daily_control,
    ),
    weekly_control_review: parseSchedule(
      optional(process.env.REVIEW_WEEKLY_CONTROL) ?? REVIEW_SCHEDULE_DEFAULTS.weekly_control_review,
    ),
    strategic_review: parseSchedule(
      optional(process.env.REVIEW_STRATEGIC) ?? REVIEW_SCHEDULE_DEFAULTS.strategic_review,
    ),
    deep_review: parseSchedule(
      optional(process.env.REVIEW_DEEP) ?? REVIEW_SCHEDULE_DEFAULTS.deep_review,
    ),
  } satisfies Readonly<Record<ReviewMode, Schedule>>,
  /** How often the producer checks whether a period has begun. */
  tickSeconds: 60,
}));

export type ReviewsConfig = ConfigType<typeof reviewsConfig>;
