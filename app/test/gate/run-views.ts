import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RUN_TAP, type AttemptView, type RunTap } from '../../src/claude/runner/run-tap';
import { gateConfig, type GateConfig } from './gate.config';
import { NOT_OBSERVED } from './m6-evidence';
import { NotionAllowance } from './notion-allowance';
import { notionReadsOf, type NotionRead } from './run-reads';

/**
 * What the runner reported about the runs of this gate process: the Skill files read, the reasons
 * the result was rejected, GBrain calls and Notion reads. The run trace does not hold this
 * (`GAP-07`), so the gate collects it in memory while the run is fresh, and the verdict takes it
 * from here. A run that did not reach the runner reported nothing.
 *
 * The gate writes the whole attempt stream (the model's text, every call with its arguments and
 * the response to it) to a file `<run id>.jsonl` in the transcripts directory, not to memory or
 * into the verdict, because the file shows why the run reached its conclusion. The gate derives
 * the Notion reads from the stream (`run-reads.ts`). Without the directory the stream is written
 * nowhere.
 */
@Injectable()
export class RunViews implements RunTap {
  private readonly views = new Map<string, AttemptView>();
  private readonly reads = new Map<string, readonly NotionRead[]>();

  constructor(@Inject(gateConfig.KEY) private readonly config: GateConfig) {}

  /**
   * Records an attempt of a run. A retry after `init` drift is a second attempt of the same run,
   * and its record replaces the first.
   */
  attempted(runId: string, view: AttemptView): void {
    // Memory first: a failure to write the file (the runner swallows it) must not deprive the
    // evidence of what the runner reported.
    this.reads.set(runId, notionReadsOf(view.transcript));
    this.views.set(runId, { ...view, transcript: [] });

    const dir = this.config.transcriptsDir;

    if (dir !== undefined) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${runId}.jsonl`),
        view.transcript.map((message) => JSON.stringify(message)).join('\n') + '\n',
      );
    }
  }

  /**
   * Returns the record of a run; an unknown run yields an empty one. The record stays: reading
   * does not remove it.
   */
  of(runId: string): AttemptView {
    return this.views.get(runId) ?? NOT_OBSERVED;
  }

  /** Returns the Notion reads of a run; an unknown run has no reads. */
  readsOf(runId: string): readonly NotionRead[] {
    return this.reads.get(runId) ?? [];
  }
}

/**
 * Subscribes the collector to the runner: the App in normal operation does not have this module,
 * and its runner reports to nobody.
 */
@Global()
@Module({
  imports: [ConfigModule.forFeature(gateConfig)],
  providers: [RunViews, { provide: RUN_TAP, useExisting: RunViews }, NotionAllowance],
  exports: [RunViews, RUN_TAP, NotionAllowance],
})
export class RunViewsModule {}
