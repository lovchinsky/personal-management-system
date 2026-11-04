import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotionClientModule } from '../../client/client.module';
import { NotionBindingModule } from '../binding.module';
import { bindingAuditConfig } from './audit.config';
import { BindingDriftAuditor } from './binding-drift.auditor';
import { BindingDriftWorker } from './binding-drift.worker';

/** The daily binding check against the live workspace. */
@Module({
  imports: [ConfigModule.forFeature(bindingAuditConfig), NotionBindingModule, NotionClientModule],
  providers: [BindingDriftAuditor, BindingDriftWorker],
})
export class NotionAuditModule {}
