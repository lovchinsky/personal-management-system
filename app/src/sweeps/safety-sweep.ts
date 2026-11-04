import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { subHours } from 'date-fns';
import { ApprovalsService } from '../approvals/approvals.service';
import { appConfig, type AppConfig } from '../config/app.config';
import { ContinuationsService } from '../continuations/continuations.service';
import { SweepRule } from '../generated/prisma/enums';
import { EvaluationWindowRepository } from '../intake/notion/evaluation-window.repository';
import { startOfLocalDay } from '../platform/time/local-day';
import { RunGates } from '../runs/run-gates';
import { RunTraces } from '../runs/run-traces';
import { SweepMarkRepository } from './sweep-mark.repository';
import { sweepConfig, type SweepConfig } from './sweep.config';
import { Candidate, SweepFinder } from './sweep.finder';

/**
 * The order of the rules under the tick and day limits: deadlines first, then the check date, then
 * structural situations. It is a `Record` over all the rules, so a new rule with no place is a
 * compile error.
 */
const RULE_ORDER: Readonly<Record<SweepRule, number>> = {
  deadline_signal: 0,
  check_date_reached: 1,
  project_closure: 2,
  paused_commitment: 3,
  project_path: 4,
  dependency_contradiction: 5,
};

/** The origin of the run the sweep wakes, passed to the run gates when the sweep asks them. */
const SWEEP_WAKE = { origin: 'scheduled_check', reasonCode: 'safety_recheck' } as const;

function byUrgency(one: Candidate, other: Candidate): number {
  return (
    RULE_ORDER[one.rule] - RULE_ORDER[other.rule] || one.since.getTime() - other.since.getTime()
  );
}

/**
 * Returns a hash of the basis: equality is preserved, and `app_db` does not store domain values
 * (`INV-017`).
 */
function hashOf(basis: string): string {
  return createHash('sha256').update(basis).digest('hex');
}

/**
 * The periodic safety sweep wakes a situation that arose with the passage of time or without an
 * event, using a `safety_recheck` continuation that has no thread. The sweep asserts nothing about
 * the domain (`docs/2-system.md` § “Periodic safety sweep”, ADR 0037).
 *
 * A candidate is not woken if:
 * - the situation arose earlier than the recency threshold: a review will bring it up;
 * - it has already been woken on the same basis;
 * - the page is already being dealt with: a continuation, an evaluation window or a proposal is
 *   open on it;
 * - a run has already seen the situation: after it arose, a run reached a conclusion about one of
 *   its pages.
 *
 * The rest are woken within the tick and day limits, in the order of `RULE_ORDER`. The tick does
 * not proceed when the run gates of an autonomous run are closed (a wake that cannot start today
 * would only join the queue) or when the daily limit is used up, in which case the tick does not
 * read Notion.
 */
@Injectable()
export class SafetySweep {
  private readonly logger = new Logger(SafetySweep.name);

  constructor(
    private readonly finder: SweepFinder,
    private readonly marks: SweepMarkRepository,
    private readonly continuations: ContinuationsService,
    private readonly approvals: ApprovalsService,
    private readonly windows: EvaluationWindowRepository,
    private readonly traces: RunTraces,
    private readonly gates: RunGates,
    @Inject(sweepConfig.KEY) private readonly config: SweepConfig,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /** Runs one pass and returns how many pages were woken. */
  async sweep(now = new Date()): Promise<number> {
    const closed = await this.gates.check(SWEEP_WAKE);

    if (closed) {
      this.logger.log(`sweep skipped: ${closed.denial}`);

      return 0;
    }

    const horizon = subHours(now, this.config.recencyHours);

    await this.marks.forgetBefore(horizon);

    const today = await this.marks.wokeSince(startOfLocalDay(this.app.timeZone, now));
    const room = Math.min(this.config.wakesPerTick, this.config.wakesPerDay - today);

    // The daily limit is used up: nobody can be woken, so there is no point in reading Notion.
    if (room <= 0) return 0;

    const candidates = (await this.finder.find(now, horizon))
      .filter((candidate) => candidate.since >= horizon)
      .sort(byUrgency);
    let woken = 0;

    for (const candidate of candidates) {
      if (woken >= room) break;

      const wake = {
        pageId: candidate.pageId,
        rule: candidate.rule,
        basisHash: hashOf(candidate.basis),
      };

      if (await this.marks.has(wake)) continue;
      if (await this.followedThrough(candidate.pageId)) continue;
      if (await this.traces.concludedAbout(candidate.pages, candidate.since)) continue;

      await this.continuations.requestSafetyRecheck({ notionPageId: candidate.pageId });
      await this.marks.mark(wake);
      woken += 1;
    }

    if (woken > 0) this.logger.log(`sweep woke ${woken} page(s)`);

    return woken;
  }

  /**
   * Checks whether the page is already being dealt with: a continuation, an evaluation window or a
   * proposal is open.
   */
  private async followedThrough(pageId: string): Promise<boolean> {
    return (
      (await this.continuations.hasOpenOnPage(pageId)) ||
      (await this.windows.hasOpenOn(pageId)) ||
      (await this.approvals.hasOpenOnPage(pageId))
    );
  }
}
