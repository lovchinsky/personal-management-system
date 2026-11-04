import { Inject, Injectable, Logger } from '@nestjs/common';
import { messageOf } from '../platform/error/message-of';
import { BREAKER_NOTICE, type BreakerNotice } from './breaker-notice';
import { budgetConfig, type BudgetConfig } from './budget.config';
import { budgetClassOf, RunProvenance } from './provenance';
import { AutonomousDenial, RunBudget } from './run-budget';
import { RunTraceRepository } from './run-trace.repository';
// `import type` is required because the interface appears in a decorated constructor signature,
// and `emitDecoratorMetadata` together with `isolatedModules` requires a type that does not exist
// at runtime to be marked as a type.
import { NO_RUNNER, RUN_LAUNCHER, type RunLauncher } from './run.launcher';

/**
 * Why the run gates are closed.
 *
 * A union, not a string: otherwise a new reason would silently fall into the `else` of every
 * consumer instead of causing a compile error.
 */
export type GateDenial = 'runner_absent' | 'runner_not_ready' | 'plan_quota' | AutonomousDenial;

/**
 * How to report that the run gates are closed. An absent runner and the daily limit are ordinary
 * states, and saying so is enough; the rest mean something is wrong.
 */
const LOG_LEVEL: Readonly<Record<GateDenial, 'log' | 'warn'>> = {
  runner_absent: 'log',
  runner_not_ready: 'warn',
  plan_quota: 'warn',
  breaker: 'warn',
  daily_limit: 'log',
};

/**
 * Checks whether the autonomous gates face a run. They face only a run the person did not ask for.
 */
function facesAutonomousGates(provenance: RunProvenance): boolean {
  return budgetClassOf(provenance) === 'budgeted';
}

/** A closed gate: why, a detail for the log, and until when, if that is known in advance. */
export interface ClosedGate {
  readonly denial: GateDenial;
  readonly detail?: string;
  readonly until?: Date;
}

/**
 * The gate state is the scheduler's state, not the rows' state (`docs/2-system.md` § “Run
 * priority”).
 */
export interface GateState {
  /** The gates before every run: the runner with its readiness, and the plan quota. */
  readonly all?: ClosedGate;
  /** The gates before autonomous work only: the breaker and the daily limit. */
  readonly autonomous?: ClosedGate;
  /** How many runs can currently start. */
  readonly freeSlots: number;
}

/** Returns the gate closed to a run with this origin; `undefined` means open. */
export function deniedBy(state: GateState, provenance: RunProvenance): ClosedGate | undefined {
  return state.all ?? (facesAutonomousGates(provenance) ? state.autonomous : undefined);
}

/**
 * The run gates decide whether a run can currently start.
 *
 * The order matters. The runner and its readiness come first, because a missing dependency is
 * neither a cost nor a failure, and the budget is not even asked about it (`INV-309`). The plan
 * quota, which every run faces, comes next. Only then come the breaker and the daily limit, for
 * autonomous work only. The slot is left to admission. The ticket in the ledger holds it, and here
 * it is only counted, so that the scheduler does not take rows that will have no slot.
 */
@Injectable()
export class RunGates {
  private readonly logger = new Logger(RunGates.name);

  /** What was closed last time, so that only transitions are logged. */
  private seen: { readonly all?: GateDenial; readonly autonomous?: GateDenial } = {};

  /**
   * Which breaker opening the person has already been told about. It is kept in process memory
   * only: after a restart the notice goes out again, but the delivery key is the same, so the
   * queue will not enqueue a second notice.
   */
  private noticed: string | undefined;

  constructor(
    @Inject(RUN_LAUNCHER) private readonly launcher: RunLauncher,
    private readonly budget: RunBudget,
    private readonly traces: RunTraceRepository,
    @Inject(budgetConfig.KEY) private readonly limits: BudgetConfig,
    @Inject(BREAKER_NOTICE) private readonly notice: BreakerNotice,
  ) {}

  /**
   * Checks whether the wiring has a runner. Without one there will never be a run, not “for the
   * time being”, because having no runner is a choice of the installation (`RUNNER_ENABLED`), not
   * a passing state like a grant or the plan quota.
   */
  get runnerWired(): boolean {
    return this.launcher.available;
  }

  /**
   * Computes the gate state for the scheduler. A transition, a gate closing or opening, is logged
   * once.
   */
  async state(): Promise<GateState> {
    const all = await this.forAll();
    const state: GateState = all
      ? { all, freeSlots: 0 }
      : {
          autonomous: await this.forAutonomous(),
          freeSlots: Math.max(0, this.limits.concurrency - (await this.traces.occupiedSlots())),
        };

    this.observe(state);

    if (state.autonomous?.denial === 'breaker') {
      await this.noticeBreaker();
    }

    return state;
  }

  /** Checks the gates for a single run, before its admission; `undefined` means open. */
  async check(provenance: RunProvenance): Promise<ClosedGate | undefined> {
    const all = await this.forAll();

    if (all || !facesAutonomousGates(provenance)) return all;

    return this.forAutonomous();
  }

  private async forAll(): Promise<ClosedGate | undefined> {
    if (!this.launcher.available) {
      return { denial: 'runner_absent', detail: NO_RUNNER };
    }

    const readiness = await this.launcher.readiness();
    if (!readiness.ready) {
      return { denial: 'runner_not_ready', detail: readiness.reason };
    }

    const quotaUntil = await this.budget.quotaBlockedUntil();

    return quotaUntil ? { denial: 'plan_quota', until: quotaUntil } : undefined;
  }

  private async forAutonomous(): Promise<ClosedGate | undefined> {
    return (await this.budget.autonomousHold()) ?? undefined;
  }

  /**
   * Tells the person that the breaker has opened, once per opening.
   *
   * The opening is identified by the last failed run: a new failure after the breaker has closed
   * is already a different opening. A notification failure does not change the gate state,
   * because the breaker denies autonomous runs whether or not the news of the opening got
   * through. The next tick will try again.
   */
  private async noticeBreaker(): Promise<void> {
    const last = await this.traces.lastFinished();

    if (!last || last.id === this.noticed) return;

    try {
      await this.notice.opened({
        lastFailedRunId: last.id,
        reason: last.reason,
        pageId: last.pageId,
        failures: this.limits.breakerConsecutiveFailures,
      });
      this.noticed = last.id;
    } catch (error) {
      this.logger.warn(`the breaker notice was not queued, will retry: ${messageOf(error)}`);
    }
  }

  /** Records a gate transition at the level `LOG_LEVEL` assigns to its reason. */
  private observe(state: GateState): void {
    this.report('runs', this.seen.all, state.all);

    // While the gates are closed to everyone, the autonomous gates are not asked: their state is
    // unknown, not open, so there is nothing to log a transition from.
    if (state.all) {
      this.seen = { ...this.seen, all: state.all.denial };
      return;
    }

    this.report('autonomous runs', this.seen.autonomous, state.autonomous);
    this.seen = { autonomous: state.autonomous?.denial };
  }

  private report(what: string, before: GateDenial | undefined, gate?: ClosedGate): void {
    if (before === gate?.denial) return;

    if (!gate) {
      this.logger.log(`${what} resumed`);

      return;
    }

    const message =
      `${what} held: ${gate.denial}` +
      (gate.detail ? ` — ${gate.detail}` : '') +
      (gate.until ? ` until ${gate.until.toISOString()}` : '');

    this.logger[LOG_LEVEL[gate.denial]](message);
  }
}
