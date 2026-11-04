import { FactoryProvider } from '@nestjs/common';
import { ScheduledCheckRunSource } from '../continuations/scheduled-check.run-source';
import { EvaluationWindowRunSource } from '../intake/notion/evaluation-window.run-source';
import { ReviewOccurrenceRunSource } from '../reviews/review-occurrence.run-source';
import { RUN_SOURCES, RunSource } from '../runs/run-source';

/**
 * The list of run sources, one per application. It is explicit, not collected by a search: a new
 * source takes one line here (ADR 0011), and both readers of the list see it at once, the
 * scheduler and pruning.
 */
export const runSourcesProvider: FactoryProvider<readonly RunSource[]> = {
  provide: RUN_SOURCES,
  inject: [EvaluationWindowRunSource, ScheduledCheckRunSource, ReviewOccurrenceRunSource],
  useFactory: (
    windows: EvaluationWindowRunSource,
    checks: ScheduledCheckRunSource,
    reviews: ReviewOccurrenceRunSource,
  ): readonly RunSource[] => [windows, checks, reviews],
};
