import { WorkflowMode } from '../generated/prisma/enums';

/**
 * The profile of one App-triggered run; it mirrors `contracts/canonical.yaml`, key `run_profile`
 * (ADR 0012).
 *
 * The profile's `toolBudgets` are not part of this interface, because they are not an SDK option.
 * The Skill and the run trace hold them (`contracts/canonical.yaml`, key `retrieval_budgets`).
 */
export interface RunProfile {
  readonly model: string;
  readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly thinking: 'adaptive';
  readonly maxTurns: number;
  readonly maxBudgetUsd: number;
}

export const DEFAULT_RUN_PROFILE: RunProfile = {
  model: 'claude-opus-5-5',
  effort: 'high',
  thinking: 'adaptive',
  maxTurns: 25,
  maxBudgetUsd: 5,
};

/**
 * How the profile of a mode differs from the shared one. A review's turn ceiling is derived from
 * its reads budget (ADR 0036); the model, effort and `maxBudgetUsd` are shared, and the M10
 * calibration differentiates them.
 */
const PER_MODE: Readonly<Partial<Record<WorkflowMode, Partial<RunProfile>>>> = {
  daily_control: { maxTurns: 35 },
  weekly_control_review: { maxTurns: 60 },
  strategic_review: { maxTurns: 60 },
  deep_review: { maxTurns: 45 },
};

/**
 * Returns the profile of a run of a mode. `model` overrides the profile's model, for a run that has
 * its own.
 */
export function profileFor(mode: WorkflowMode, model?: string): RunProfile {
  return { ...DEFAULT_RUN_PROFILE, ...PER_MODE[mode], ...(model ? { model } : {}) };
}
