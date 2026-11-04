/**
 * Verdict items that every scenario gets in the same way. They belong to no scenario, so the
 * comparison does not count them in the recognition pools (twenty-one identical items would
 * outweigh the rest) and reads each item in its own scenario separately.
 */

/**
 * The label of a mode that the run of an event or a check does not raise is not raised. The item is
 * set for every scenario.
 */
export const LABELS_NOT_RAISED = 'no label of a mode the run does not raise is raised';

export const EVERY_SCENARIO_ITEMS: readonly string[] = [LABELS_NOT_RAISED];
