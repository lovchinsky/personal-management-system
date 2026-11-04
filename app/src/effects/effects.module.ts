import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AttentionModule } from '../attention/attention.module';
import { CaptureModule } from '../capture/capture.module';
import { ContinuationsModule } from '../continuations/continuations.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { MemoryModule } from '../memory/memory.module';
import { RunWrites } from './run-writes';

/**
 * Run writes cover when to apply what has been staged (ADR 0015). The capabilities that own the
 * writes stay with their services; the policy only holds what has been staged and applies it in the
 * order of kinds.
 */
@Module({
  imports: [
    CaptureModule,
    AttentionModule,
    ContinuationsModule,
    ApprovalsModule,
    DeliveryModule,
    MemoryModule,
  ],
  providers: [RunWrites],
  exports: [RunWrites],
})
export class EffectsModule {}
