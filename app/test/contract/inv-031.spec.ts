import { profileFor } from '../../src/claude/run-profile';
import { MODES, optionsFor } from '../fixtures/runner-options.fixture';

/**
 * `INV-031` `model` and `effort` are set explicitly in the options of every run and are not left
 * on the CLI default: the default drifts with the version of the SDK package.
 *
 * The options builder is checked, with no model and no live run. Which canonical model a run
 * actually got is a fact about the run, and `INV-033` checks it.
 */
describe('INV-031', () => {
  it.each(MODES)("the options for %s name the profile's model and effort", (mode) => {
    const options = optionsFor(mode);
    const profile = profileFor(mode);

    expect(options.model).toBe(profile.model);
    expect(options.effort).toBe(profile.effort);
    expect(options.thinking).toEqual({ type: profile.thinking });
  });
});
