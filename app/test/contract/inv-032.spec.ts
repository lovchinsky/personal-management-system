import { profileFor } from '../../src/claude/run-profile';
import { RunObserver } from '../../src/claude/runner/run-observer';
import { PLUGIN_DIR } from '../fixtures/claude-stream.fixture';
import { MODES, optionsFor } from '../fixtures/runner-options.fixture';

/**
 * `INV-032` There is no fallback to another model. When the model is unavailable, the run fails
 * with no partial effects and is retried with the same profile.
 *
 * The model axis is checked, and only that, because lowering `effort` to a supported level is an
 * SDK resolution on a different axis.
 */
describe('INV-032', () => {
  it.each(MODES)('the options for %s name no fallback model', (mode) => {
    expect(optionsFor(mode)).not.toHaveProperty('fallbackModel');
  });

  /**
   * A retry takes the same profile, because the profile is a function of the mode, not of the
   * state.
   */
  it.each(MODES)('the profile for %s is the same on every call', (mode) => {
    expect(profileFor(mode)).toEqual(profileFor(mode));
  });

  it('a fallback that the CLI would make on its own aborts the run', () => {
    const stopped: string[] = [];
    const observer = new RunObserver(
      () => [],
      (reason) => stopped.push(reason),
      PLUGIN_DIR,
    );

    observer.see({
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'claude-opus-5-5',
      fallback_model: 'claude-sonnet-5',
    });

    expect(stopped).toEqual([expect.stringContaining('INV-032')]);
  });
});
