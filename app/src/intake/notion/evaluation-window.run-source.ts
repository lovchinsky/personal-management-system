import { Inject, Injectable } from '@nestjs/common';
import { AttentionService } from '../../attention/attention.service';
import { EvaluationWindow } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/db/prisma.service';
import { RunRowSource } from '../../runs/run-row-source';
import { RunRowPolicy } from '../../runs/run-row.policy';
import { evaluationWindowConfig, type EvaluationWindowConfig } from './evaluation-window.config';
import { evaluationWindowRows } from './evaluation-window.rows';

/**
 * A due change evaluation window is a source of runs.
 *
 * The run budget is consulted when the window is due and the scheduler takes it into a run, not
 * at event intake. At intake there is nothing to launch yet, because the next edit of the same
 * page is absorbed into the same window. The rules for a run row are shared by all queues
 * (`RunRowSource`), so the class only passes on the queue's description.
 */
@Injectable()
export class EvaluationWindowRunSource extends RunRowSource<EvaluationWindow> {
  constructor(
    prisma: PrismaService,
    @Inject(evaluationWindowConfig.KEY) config: EvaluationWindowConfig,
    policy: RunRowPolicy,
    attention: AttentionService,
  ) {
    super(prisma, policy, evaluationWindowRows(prisma, config, attention));
  }
}
