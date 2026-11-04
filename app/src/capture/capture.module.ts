import { Module } from '@nestjs/common';
import { AttentionModule } from '../attention/attention.module';
import { NotionClientModule } from '../notion/client/client.module';
import { NotionSemanticsModule } from '../notion/semantics/semantics.module';
import { CaptureService } from './capture.service';

/**
 * System intents over the Inbox (`docs/2-system.md` § “Direct interaction with Notion”).
 * The module writes through `NotionWriter`, while a comment the person replies to goes through
 * attention. It encodes through the adapter.
 */
@Module({
  imports: [NotionClientModule, NotionSemanticsModule, AttentionModule],
  providers: [CaptureService],
  exports: [CaptureService],
})
export class CaptureModule {}
