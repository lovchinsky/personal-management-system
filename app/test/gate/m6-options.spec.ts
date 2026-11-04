import { optionsOf, selectionOf, trialsFor } from './m6-options';
import { SCENARIOS, scenariosOf, shortOf } from './m6-scenarios';

describe('optionsOf (gate M6)', () => {
  it('without arguments: all scenarios of the suite, one trial', () => {
    expect(optionsOf([])).toEqual({
      suite: 'm6',
      only: null,
      trials: 1,
      recordedTrials: 1,
      preflight: false,
      withoutHeldOut: false,
      manual: false,
    });
  });

  it('--only names scenarios by prefix, --trials sets the trials', () => {
    expect(optionsOf(['--only=U1,W1', '--trials=3'])).toEqual({
      suite: 'm6',
      only: ['U1', 'W1'],
      trials: 3,
      recordedTrials: 1,
      preflight: false,
      withoutHeldOut: false,
      manual: false,
    });
  });

  /**
   * The step for the person exists only in M8: a flag the suite does not use is an error, not
   * silence.
   */
  it('--manual is accepted only by the M8 suite', () => {
    expect(optionsOf(['--manual'], 'm8').manual).toBe(true);
    expect(optionsOf([], 'm8').manual).toBe(false);
    expect(() => optionsOf(['--manual'])).toThrow('unknown argument --manual');
  });

  it('a model-free scenario is conducted once, however many trials are requested', () => {
    const options = optionsOf(['--trials=3'], 'm8');
    const trials = Object.fromEntries(
      scenariosOf('m8').map((info) => [shortOf(info.id), trialsFor(info, options)]),
    );

    expect(trials).toMatchObject({ C1: 1, D1: 3, W1: 3, SW1: 3 });
  });

  it('--recorded-trials says how many times to conduct recorded scenarios', () => {
    expect(optionsOf(['--trials=3', '--recorded-trials=3'])).toMatchObject({
      trials: 3,
      recordedTrials: 3,
    });
  });

  it('conducts blocking scenarios --trials times, recorded ones --recorded-trials times', () => {
    const options = optionsOf(['--trials=4', '--recorded-trials=2']);
    const counts = (tier: string): number[] =>
      scenariosOf('m6')
        .filter((info) => info.tier === tier)
        .map((info) => trialsFor(info, options));

    expect(new Set(counts('blocking'))).toEqual(new Set([4]));
    expect(new Set(counts('recorded'))).toEqual(new Set([2]));
  });

  /**
   * The limits run from one to nine inclusive: both ends are accepted, and anything beyond them is
   * refused.
   */
  it.each(['--trials', '--recorded-trials'])('%s: one and nine are accepted', (flag) => {
    const trialsOf = (value: number): number => {
      const options = optionsOf([`${flag}=${value}`]);

      return flag === '--trials' ? options.trials : options.recordedTrials;
    };

    expect(trialsOf(1)).toBe(1);
    expect(trialsOf(9)).toBe(9);
  });

  it('switches --without-held-out and --preflight on with their flags', () => {
    expect(optionsOf(['--preflight', '--without-held-out'])).toMatchObject({
      preflight: true,
      withoutHeldOut: true,
    });
  });

  it.each([
    ['an unknown scenario', ['--only=Z9'], 'gate M6: unknown scenario Z9'],
    ['a scenario of another suite', ['--only=H1'], 'gate M6: unknown scenario H1'],
    ['an empty list', ['--only='], '--only names no scenario'],
    ['an unknown argument', ['--fast'], 'unknown argument --fast'],
    ['--preflight together with --only', ['--preflight', '--only=U1'], 'exclude each other'],
    ['zero trials', ['--trials=0'], '--trials takes a whole number'],
    ['too many trials', ['--trials=10'], '--trials takes a whole number'],
    ['a fractional number', ['--trials=1.5'], '--trials takes a whole number'],
    ['zero recorded trials', ['--recorded-trials=0'], '--recorded-trials takes a whole number'],
    [
      'too many recorded trials',
      ['--recorded-trials=10'],
      '--recorded-trials takes a whole number',
    ],
    ['not a number', ['--trials=few'], '--trials takes a whole number'],
    [
      'a selection of only held-out scenarios together with --without-held-out',
      ['--only=U2,Q1', '--without-held-out'],
      'drops them',
    ],
  ])('%s is a launch error, not a silent run of everything', (_, args, message) => {
    expect(() => optionsOf(args)).toThrow(message);
  });
});

/** What is launched: it decides how much quota is spent and whether held-out is read. */
describe('selectionOf', () => {
  const short = (options: Parameters<typeof selectionOf>[0]): string[] =>
    selectionOf(options).map((info) => shortOf(info.id));

  it('without restrictions returns all scenarios of the suite in catalog order', () => {
    expect(selectionOf({ suite: 'm6', only: null, withoutHeldOut: false })).toEqual(
      scenariosOf('m6'),
    );
    expect(selectionOf({ suite: 'm7', only: null, withoutHeldOut: false })).toEqual(
      scenariosOf('m7'),
    );
  });

  it('keeps suites apart: each scenario belongs to exactly one', () => {
    expect(
      (['m6', 'm7', 'm8', 'm9'] as const).reduce(
        (sum, suite) => sum + scenariosOf(suite).length,
        0,
      ),
    ).toBe(SCENARIOS.length);
  });

  it('--only keeps the named ones', () => {
    expect(short({ suite: 'm6', only: ['W1', 'U1'], withoutHeldOut: false })).toEqual(['U1', 'W1']);
  });

  it('--without-held-out removes exactly those not read while the Skill is iterated on', () => {
    const left = new Set(short({ suite: 'm6', only: null, withoutHeldOut: true }));
    const held = scenariosOf('m6')
      .filter((info) => info.heldOut)
      .map((info) => shortOf(info.id));

    expect(held).toEqual(['U2', 'U4', 'X1', 'Q1', 'U5']);
    expect(held.every((name) => !left.has(name))).toBe(true);
    expect(left.size).toBe(scenariosOf('m6').length - held.length);
  });

  it('together: the named ones without held-out; a held-out one named explicitly drops out', () => {
    expect(short({ suite: 'm6', only: ['U1', 'U2', 'N1'], withoutHeldOut: true })).toEqual([
      'U1',
      'N1',
    ]);
  });

  it('--only=U2 without the flag keeps held-out: it is read when asked for directly', () => {
    expect(optionsOf(['--only=U2']).only).toEqual(['U2']);
    expect(short({ suite: 'm6', only: ['U2'], withoutHeldOut: false })).toEqual(['U2']);
  });
});

describe('optionsOf (gate M7)', () => {
  it('the M7 suite has H scenarios, and errors are labeled by suite', () => {
    expect(optionsOf(['--only=H1,H4'], 'm7')).toMatchObject({ suite: 'm7', only: ['H1', 'H4'] });
    expect(() => optionsOf(['--only=U1'], 'm7')).toThrow('gate M7: unknown scenario U1');
    expect(() => optionsOf(['--fast'], 'm7')).toThrow('gate M7: unknown argument --fast');
    expect(() => optionsOf(['--trials=0'], 'm7')).toThrow('gate M7: --trials takes a whole number');
  });

  it("--without-held-out in M7 removes its own held-out, not M6's", () => {
    const left = selectionOf(optionsOf(['--without-held-out'], 'm7')).map((info) =>
      shortOf(info.id),
    );

    expect(left).not.toContain('H5');
    expect(left).not.toContain('H7');
    expect(left).toContain('H1');
    expect(left).not.toContain('U1');
  });
});
