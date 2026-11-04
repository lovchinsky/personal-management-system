import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApprovalsModule } from '../approvals/approvals.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { RunRowsModule } from '../runs/run-rows.module';
import { RunsModule } from '../runs/runs.module';
import { ReviewOccurrenceRepository } from './review-occurrence.repository';
import { ReviewOccurrenceRunSource } from './review-occurrence.run-source';
import { ReviewPlanner } from './review.planner';
import { reviewsConfig } from './reviews.config';

/**
 * Scheduled reviews: the schedules, the occurrences and the producer that places them. The module
 * exposes a source of runs over the occurrences, which the scheduler combines with the other
 * sources (ADR 0036).
 */
@Module({
  imports: [
    ConfigModule.forFeature(reviewsConfig),
    RunRowsModule,
    RunsModule,
    DeliveryModule,
    ApprovalsModule,
  ],
  providers: [ReviewOccurrenceRepository, ReviewOccurrenceRunSource, ReviewPlanner],
  exports: [ReviewOccurrenceRunSource],
})
export class ReviewsModule {}
