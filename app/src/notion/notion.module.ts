import { Module } from '@nestjs/common';
import { NotionAuditModule } from './binding/audit/audit.module';
import { NotionBindingModule } from './binding/binding.module';
import { NotionBodyModule } from './client/body/body.module';
import { NotionClientModule } from './client/client.module';
import { NotionRecordQuery } from './semantics/record-query';
import { NotionRecordReader } from './semantics/record.reader';
import { NotionSemanticsModule } from './semantics/semantics.module';

/**
 * The whole App → Notion REST path: the binding and its check, record reads and queries, the page
 * body, decoding and encoding, the system's writes.
 */
@Module({
  imports: [
    NotionBindingModule,
    NotionClientModule,
    NotionBodyModule,
    NotionSemanticsModule,
    NotionAuditModule,
  ],
  providers: [NotionRecordReader, NotionRecordQuery],
  exports: [
    NotionRecordReader,
    NotionRecordQuery,
    NotionSemanticsModule,
    NotionClientModule,
    NotionBodyModule,
  ],
})
export class NotionModule {}
