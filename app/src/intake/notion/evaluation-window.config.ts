import { registerAs, type ConfigType } from '@nestjs/config';

/**
 * The evaluation window settings: how long to wait for the next edit, the window's ceiling and
 * how long the window stays news.
 */
export const evaluationWindowConfig = registerAs('evaluationWindow', () => ({
  /**
   * How long to wait for silence after an event before evaluating the page.
   *
   * A person editing a page makes several edits in a row; a run per edit would mean several runs
   * about one thought. The number is a calibration value: the corpus treats calibrating
   * thresholds as a separate decision, so it lives here and not in the contract.
   */
  debounceSeconds: 60,
  /**
   * The window's ceiling, measured from when it opens
   * (`contracts/canonical.yaml`, key `evaluation_window`).
   */
  maxWindowSeconds: 300,
  /**
   * How long the window stays news. The reason for the limit is in
   * `contracts/canonical.yaml`, key `evaluation_window`.
   *
   * Seven days rests on two independent justifications. A receipt is kept just as long, so beyond
   * seven days a window would be older than the evidence of its own origin. And a change nobody
   * has looked at for a week belongs to the Weekly Control Review, not to a wake.
   *
   * The limit is a number of its own, not the receipt retention period
   * (`maintenance.receiptRetentionDays`). The retention period is derived from the provider's
   * behavior, and if Notion changed its redelivery period, the policy for aging out windows would
   * move with it for no reason at all.
   */
  maxAgeDays: 7,
}));

export type EvaluationWindowConfig = ConfigType<typeof evaluationWindowConfig>;
