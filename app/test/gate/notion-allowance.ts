import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { WorkflowMode } from '../../src/generated/prisma/enums';
import { isReviewMode } from '../../src/reviews/review-modes';
import { gateConfig, type GateConfig } from './gate.config';
import { notionReadsOf, type NotionRead } from './run-reads';

/**
 * The Notion MCP query allowance is a resource of the gate environment. On a Free workspace `sql`
 * and `rows` share one allowance across all connections: runs and any other client of the same
 * workspace split it, and a refusal for exceeding it is not Skill behavior. The gate enforces
 * the rule “no more than `N` such calls in any 60 minutes”. The rule does not depend on where
 * Notion opens its window, because that window is also a 60-minute span. Before a run the gate
 * waits until what a run of this mode has already spent fits into the nearest span. After a
 * refusal it waits until the hour passes.
 */

/** The span in which Notion counts the workspace query allowance. */
export const ALLOWANCE_WINDOW_MS = 60 * 60 * 1000;

/**
 * The most metered calls a run that is not a review needs: the maximum measured on the gate
 * transcripts.
 */
const UNREVIEWED_NEED = 2;

/** How often the wait checks whether the gate was stopped. */
const WAIT_STEP_MS = 10_000;

/**
 * The ledger of metered calls and refusals: a pure rule over instants, with no clock and no files.
 * `limit` is the allowance per span; `null` means there is no allowance (a Business workspace).
 */
export class AllowanceLedger {
  private readonly calls: number[] = [];
  private exhaustedUntil = 0;
  private readonly needs = new Map<WorkflowMode, number>();

  constructor(readonly limit: number | null) {}

  /**
   * Returns how many calls a run of the mode needs: the most a run of this mode has already spent.
   * Before the first measurement it is the whole allowance for a review (its need is not measured
   * yet) and the maximum of event runs for the rest.
   */
  needOf(mode: WorkflowMode): number {
    const limit = this.limit ?? 0;

    return Math.min(this.needs.get(mode) ?? (isReviewMode(mode) ? limit : UNREVIEWED_NEED), limit);
  }

  /** Returns when a run of the mode fits into the allowance; `now` means it fits already. */
  readyAt(mode: WorkflowMode, now: number): number {
    if (this.limit === null) return now;

    const recent = this.calls.filter((at) => at > now - ALLOWANCE_WINDOW_MS).sort((a, b) => a - b);
    const excess = recent.length + this.needOf(mode) - this.limit;
    const aged = excess > 0 ? (recent[excess - 1] ?? now) + ALLOWANCE_WINDOW_MS : now;

    return Math.max(now, this.exhaustedUntil, aged);
  }

  /**
   * Records what a run of the mode spent. A refused call took no allowance but showed how much the
   * run needs: the need of the mode is all its metered calls. A refusal exhausts the span until an
   * hour after the refusal.
   */
  record(mode: WorkflowMode | null, reads: readonly NotionRead[], fallbackAt: number): void {
    const metered = reads.filter((read) => read.metered);
    const momentOf = (read: NotionRead): number =>
      read.at === null ? fallbackAt : new Date(read.at).getTime();

    for (const read of metered) {
      if (!read.refused) this.calls.push(momentOf(read));
    }

    for (const read of reads.filter((item) => item.refused)) {
      this.exhaustedUntil = Math.max(this.exhaustedUntil, momentOf(read) + ALLOWANCE_WINDOW_MS);
    }

    if (mode !== null) {
      this.needs.set(mode, Math.max(this.needs.get(mode) ?? 0, metered.length));
    }
  }
}

/**
 * The gate's allowance in one process: the ledger restored from the transcripts of the last hour
 * (an earlier gate run also spent the allowance of the same workspace), and the wait before a run.
 */
@Injectable()
export class NotionAllowance {
  readonly ledger: AllowanceLedger;

  constructor(@Inject(gateConfig.KEY) config: GateConfig) {
    this.ledger = new AllowanceLedger(config.notionQueryAllowance);
    this.restore(config.transcriptsDir, new Date().getTime());
  }

  /** The allowance per span as the verdict states it: a number or `unlimited`. */
  get described(): number | 'unlimited' {
    return this.ledger.limit ?? 'unlimited';
  }

  /**
   * Waits until a run of the mode fits into the allowance. `running` throws when the gate was
   * stopped, so a wait of an hour does not hold up the stop.
   */
  async ready(
    mode: WorkflowMode,
    running: () => void,
    log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  ): Promise<void> {
    let told = false;

    for (;;) {
      running();

      const now = new Date().getTime();
      const ready = this.ledger.readyAt(mode, now);

      if (ready <= now) return;

      if (!told) {
        log(
          `waiting until ${new Date(ready).toISOString()} for the Notion query allowance before a ${mode} run`,
        );
        told = true;
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(ready - now, WAIT_STEP_MS)));
    }
  }

  /** Records what a run spent: its reads from the attempt stream. */
  spent(mode: WorkflowMode, reads: readonly NotionRead[]): void {
    this.ledger.record(mode, reads, new Date().getTime());
  }

  /**
   * Restores the ledger of the last hour from the gate transcripts. The directory is shared by all
   * gate runs.
   */
  private restore(dir: string | undefined, now: number): void {
    if (dir === undefined) return;

    let names: string[];

    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
    } catch {
      return;
    }

    for (const name of names) {
      const file = join(dir, name);
      const modified = statSync(file).mtimeMs;

      if (modified <= now - ALLOWANCE_WINDOW_MS) continue;

      const messages = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .flatMap((line): unknown[] => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });

      this.ledger.record(null, notionReadsOf(messages), modified);
    }
  }
}
