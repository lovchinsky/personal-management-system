import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { budgetConfig } from './budget.config';
import { RunRowPolicy } from './run-row.policy';
import { runsConfig } from './runs.config';

/**
 * Run-row rules for the owners of run queues (ADR 0018).
 *
 * The module is separate from `RunsModule` because a queue needs only the numbers of its row, not
 * the dispatcher, the run gates and the ledger. A queue's owner therefore imports this module
 * instead of all of `RunsModule`.
 */
@Module({
  imports: [ConfigModule.forFeature(runsConfig), ConfigModule.forFeature(budgetConfig)],
  providers: [RunRowPolicy],
  exports: [RunRowPolicy],
})
export class RunRowsModule {}
