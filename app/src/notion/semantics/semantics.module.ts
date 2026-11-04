import { Module } from '@nestjs/common';
import { NotionBindingModule } from '../binding/binding.module';
import { NotionClientModule } from '../client/client.module';
import { SchemaMappingReader } from './schema-mapping.reader';
import { SemanticAdapter } from './semantic.adapter';

@Module({
  imports: [NotionBindingModule, NotionClientModule],
  providers: [SemanticAdapter, SchemaMappingReader],
  exports: [SemanticAdapter, SchemaMappingReader],
})
export class NotionSemanticsModule {}
