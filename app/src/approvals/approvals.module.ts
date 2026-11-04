import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotionClientModule } from '../notion/client/client.module';
import { NotionSemanticsModule } from '../notion/semantics/semantics.module';
import { optionalPort } from '../platform/di/optional-port';
import { ApprovalsService } from './approvals.service';
import { PendingActionRepository } from './contracts/pending-action.repository';
import { ActionExecutor } from './executor/action.executor';
import { executorConfig } from './executor/executor.config';
import { ExecutorWorker } from './executor/executor.worker';
import { PreconditionEvaluator } from './preconditions/precondition.evaluator';
import {
  AbsentProposalNotice,
  PROPOSAL_NOTICE,
  PROPOSAL_NOTICE_ADAPTER,
  type ProposalNotice,
} from './proposal-notice';
import { ProposalPublisher } from './publication/proposal.publisher';
import { PublicationWorker } from './publication/publication.worker';

/**
 * Pending approval: the proposal contract, the preconditions, the executor.
 *
 * The executor writes an approved change as a system write, through `NotionWriter` and the
 * semantic adapter (`docs/2-system.md` § “Approval-required writes”). A separate loop
 * publishes the proposal's fate (ADR 0043) in a trail in its thread and through the
 * `ProposalNotice` port, because the message that showed the proposal must say how it ended.
 */
@Module({
  imports: [ConfigModule.forFeature(executorConfig), NotionClientModule, NotionSemanticsModule],
  providers: [
    ApprovalsService,
    PendingActionRepository,
    PreconditionEvaluator,
    ActionExecutor,
    ExecutorWorker,
    ProposalPublisher,
    PublicationWorker,
    optionalPort<ProposalNotice>(
      PROPOSAL_NOTICE,
      PROPOSAL_NOTICE_ADAPTER,
      () => new AbsentProposalNotice(),
    ),
  ],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
