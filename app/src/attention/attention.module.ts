import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ContinuationsModule } from '../continuations/continuations.module';
import { NotionClientModule } from '../notion/client/client.module';
import { NotionSemanticsModule } from '../notion/semantics/semantics.module';
import { AttentionService } from './attention.service';
import { SystemDiscussionRepository } from './system-discussion.repository';

/**
 * The system's attention in Notion: a comment in the system's voice and the registry of the
 * threads it manages (`docs/2-system.md` § “System-managed attention episodes”).
 *
 * The system also manages a thread when a continuation or proposal is open on it, so the module
 * asks the continuation and proposal capabilities about them rather than reading their tables.
 */
@Module({
  imports: [NotionClientModule, NotionSemanticsModule, ContinuationsModule, ApprovalsModule],
  providers: [AttentionService, SystemDiscussionRepository],
  exports: [AttentionService],
})
export class AttentionModule {}
