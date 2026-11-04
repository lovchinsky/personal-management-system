import { AUTONOMOUS_MIN_LEAD_MINUTES } from '../../src/continuations/continuations.service';
import { SAFETY_RECHECK_MAX_AGE_DAYS } from '../../src/continuations/scheduled-check.rows';
import { runsConfig } from '../../src/runs/runs.config';
import { canonical } from './contracts';

/**
 * The continuation limits in the code and in the contract are the same.
 *
 * The running App does not read contracts, so continuations keep their numbers as constants. A
 * number that diverged from the contract would silently change how often a run without the
 * person can wake itself and how long a wake without a thread waits.
 */
describe('continuations and the contract', () => {
  it('the autonomous step limit matches the contract', () => {
    expect(AUTONOMOUS_MIN_LEAD_MINUTES).toBe(
      canonical.scheduledCheck().autonomous_min_lead_minutes,
    );
  });

  it('the age of a wake without a thread matches the contract', () => {
    expect(SAFETY_RECHECK_MAX_AGE_DAYS).toBe(
      canonical.scheduledCheck().safety_recheck_max_age_days,
    );
  });

  /**
   * A number that diverged would silently change how often a row tries Notion and how long it
   * waits for it.
   */
  it('the pause and the limit of the Notion hold match the contract', () => {
    const declared = canonical.scheduledCheck().notion_hold;
    const implemented = runsConfig();

    expect(implemented.notionHoldMinMinutes).toBe(declared.min_minutes);
    expect(implemented.notionHoldMaxMinutes).toBe(declared.max_minutes);
    expect(implemented.notionHoldLimitHours).toBe(declared.limit_hours);
  });
});
