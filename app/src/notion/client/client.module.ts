import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Client } from '@notionhq/client';
import { BotIdentity } from './bot-identity';
import { CommentsReader } from './comments.reader';
import { DataSourceQuery } from './data-source-query';
import { LiveSchema } from './live-schema';
import { notionClientProvider } from './notion-client.provider';
import { notionConfig } from './notion.config';
import { NotionWriter } from './notion.writer';
import { PageReader } from './page.reader';

/**
 * Notion over REST. The module reads pages, queries data sources, reads comments and the schema,
 * and provides the bot identity and the single boundary of the system's writes (`docs/2-system.md`
 * § “System writes to Notion”).
 */
@Module({
  imports: [ConfigModule.forFeature(notionConfig)],
  providers: [
    notionClientProvider,
    PageReader,
    DataSourceQuery,
    CommentsReader,
    BotIdentity,
    LiveSchema,
    NotionWriter,
  ],
  exports: [
    Client,
    PageReader,
    DataSourceQuery,
    CommentsReader,
    BotIdentity,
    LiveSchema,
    NotionWriter,
  ],
})
export class NotionClientModule {}
