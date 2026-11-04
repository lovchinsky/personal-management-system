import { RunOutcome } from '../../src/runs/run-outcome';
import { AdmittedRun, Readiness, RunLauncher } from '../../src/runs/run.launcher';
import { TriggerEnvelope } from '../../src/runs/trigger-envelope';
import { completed } from '../fixtures/run-outcome.fixture';

/**
 * A stub for the model run that the test supplies. It records what it was given and answers with
 * what the test put in `outcome`.
 */
export class RecordingLauncher implements RunLauncher {
  available = true;

  /** What `readiness` answers: a test makes the runner unready by changing this field. */
  ready: Readiness = { ready: true };

  outcome: RunOutcome = completed();
  readonly runs: AdmittedRun[] = [];
  readonly launched: TriggerEnvelope[] = [];

  /** Holds the run inside `launch` until the test lets it go. */
  hold?: Promise<void>;

  /** Called on entry to `launch`, for tests that check the order of steps. */
  onLaunch?: () => void;

  private entered?: () => void;

  /**
   * Returns a barrier on the **next** entry into `launch`, not on the first one in the object's
   * lifetime.
   *
   * The launcher is built once in `beforeAll`, so a field-initializer barrier would resolve on
   * the first launch of the first test in the file. In all later launches `await` would return
   * immediately. Concurrency tests would then be decided by timing and order: run on their own
   * they would wait, run in the full lane they would not.
   *
   * Called **before** the run that needs to be caught inside.
   */
  nextLaunch(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.entered = resolve;
    });
  }

  /**
   * Returns the launcher to the “just created” state. **All** state is reset, not only the one
   * that was mentioned: the launcher lives from `beforeAll`, and a `hold` left over from a test
   * that fell over midway would turn the rest of the file into a cascade of timeouts that hides
   * the real cause.
   */
  reset(): void {
    this.available = true;
    this.ready = { ready: true };
    this.outcome = completed();
    this.runs.length = 0;
    this.launched.length = 0;
    this.hold = undefined;
    this.onLaunch = undefined;
    this.entered = undefined;
  }

  readiness(): Promise<Readiness> {
    return Promise.resolve(this.ready);
  }

  async launch(run: AdmittedRun): Promise<RunOutcome> {
    this.runs.push(run);
    this.launched.push(run.envelope);
    this.onLaunch?.();
    this.entered?.();

    if (this.hold) await this.hold;

    return this.outcome;
  }
}
