import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApprovalsModule } from '../../approvals/approvals.module';
import { AttentionModule } from '../../attention/attention.module';
import { NotionClientModule } from '../../notion/client/client.module';
import { NotionSemanticsModule } from '../../notion/semantics/semantics.module';
import { RunRowsModule } from '../../runs/run-rows.module';
import { IntakeReceiptsModule } from '../receipts/receipts.module';
import { NotionAuthorship } from './authorship';
import { evaluationWindowConfig } from './evaluation-window.config';
import { EvaluationWindowRepository } from './evaluation-window.repository';
import { EvaluationWindowRunSource } from './evaluation-window.run-source';
import { NotionIntake } from './notion-intake';
import { notionWebhookConfig } from './notion-webhook.config';
import { NotionWebhookController } from './notion-webhook.controller';
import { RelevanceGate } from './relevance.gate';

/**
 * Notion's inbound perimeter. It covers the signature, idempotency, the author, the reply in the
 * system's thread, the relevance gate and the window, together with the run source over due
 * windows. The module exports the source that takes due windows into a run and prunes closed ones,
 * and the window store that channel intake folds its events into. There is one window per page,
 * whatever opened it.
 */
@Module({
  imports: [
    ConfigModule.forFeature(evaluationWindowConfig),
    ConfigModule.forFeature(notionWebhookConfig),
    RunRowsModule,
    IntakeReceiptsModule,
    NotionSemanticsModule,
    NotionClientModule,
    AttentionModule,
    ApprovalsModule,
  ],
  controllers: [NotionWebhookController],
  providers: [
    NotionIntake,
    NotionAuthorship,
    RelevanceGate,
    EvaluationWindowRepository,
    EvaluationWindowRunSource,
  ],
  exports: [EvaluationWindowRunSource, EvaluationWindowRepository],
})
export class NotionIntakeModule {}
