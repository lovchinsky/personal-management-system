import { optionsOf } from './m5-options';

describe('gate M5 arguments', () => {
  it('no arguments means all scenarios, without a person', () => {
    expect(optionsOf([])).toEqual({ only: null, preflight: false, manual: false });
  });

  it('`--only` and `--manual` together are both accepted', () => {
    expect(optionsOf(['--only=S1,T2b', '--manual'])).toEqual({
      only: ['S1', 'T2b'],
      preflight: false,
      manual: true,
    });
  });

  it('`--preflight` means a model-free check only', () => {
    expect(optionsOf(['--preflight'])).toEqual({ only: null, preflight: true, manual: false });
  });

  it('`--preflight` together with `--only` is refused, because one of the two would silently not apply', () => {
    expect(() => optionsOf(['--preflight', '--only=S1'])).toThrow('exclude each other');
  });

  /** A mistake in a scenario name must not select zero scenarios and call that a run. */
  it('an unknown scenario is refused', () => {
    expect(() => optionsOf(['--only=S9'])).toThrow('unknown scenario S9');
  });

  it.each(['--only=', '--only=,'])('`%s` names no scenario and is refused', (arg) => {
    expect(() => optionsOf([arg])).toThrow('names no scenario');
  });

  /** A mistake in an argument name must not silently conduct the gate with all the scenarios. */
  it('an unknown argument is refused', () => {
    expect(() => optionsOf(['--manul'])).toThrow('unknown argument --manul');
  });

  /** The gate prepares the anchor page itself, so the Project is not named in the arguments. */
  it('`--project` is an unknown argument', () => {
    expect(() => optionsOf(['--project=abc-123'])).toThrow('unknown argument --project=abc-123');
  });
});
