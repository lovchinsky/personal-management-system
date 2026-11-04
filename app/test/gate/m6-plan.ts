import { messageOf } from '../../src/platform/error/message-of';
import type { Planned } from './m6-conduct';
import { trialsFor, type GateOptions } from './m6-options';
import type { Check } from './m6-preflight';
import type { ScenarioInfo } from './m6-scenarios';

/**
 * What the launch asks the gate session before the first quota: whether the runner is ready,
 * whether the run gates are open and how many autonomous runs the daily limit still allows.
 */
interface Startable {
  ready(): Promise<void>;
  assertRunnable(): Promise<void>;
  autonomousRoom(): Promise<number>;
}

/** Counts the autonomous runs the launch spends in the best case: the daily limit counts them. */
export const autonomousRunsOf = (
  selected: readonly ScenarioInfo[],
  options: GateOptions,
): number =>
  options.preflight
    ? 0
    : selected.reduce((sum, info) => sum + info.budgeted * trialsFor(info, options), 0);

/**
 * Returns why the launch does not start: the runner is not ready, the run gates are closed or the
 * daily limit of autonomous runs will not cover this launch. `null` means it can start. All gate
 * runs of one local day share the limit, and a launch that hit it midway would record every
 * following trial as a failure. Under `--preflight` there are no runs, so the run gates do not
 * concern it. The model-free check runs even when the plan quota is exhausted.
 */
export async function startRefusalOf(
  session: Startable,
  options: Pick<GateOptions, 'preflight'>,
  autonomous = 0,
): Promise<string | null> {
  try {
    await session.ready();

    if (options.preflight) return null;

    await session.assertRunnable();

    const room = autonomous > 0 ? await session.autonomousRoom() : autonomous;

    return room < autonomous
      ? `the daily limit of autonomous runs leaves ${room} for today, and this run needs ${autonomous}: run it on another local day or with fewer trials`
      : null;
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Returns the scenarios that the checks before the launch did not block, with the number of trials
 * of each. A blocked scenario is not conducted at all, because a run over a world whose dependency
 * is broken would prove nothing and would cost quota.
 */
export function planOf(
  selected: readonly ScenarioInfo[],
  checks: readonly Check[],
  options: GateOptions,
): Planned[] {
  const blocked = new Set(checks.filter((check) => !check.ok).flatMap((check) => check.blocks));

  return options.preflight
    ? []
    : selected
        .filter((info) => !blocked.has(info.id))
        .map((info) => ({ info, trials: trialsFor(info, options) }));
}
