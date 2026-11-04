import { Module } from '@nestjs/common';
import { NotionClientModule } from '../client.module';
import { BodyReader } from './body.reader';

@Module({
  imports: [NotionClientModule],
  providers: [BodyReader],
  exports: [BodyReader],
})
export class NotionBodyModule {}
