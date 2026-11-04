import {
  artifact,
  both,
  claim,
  errored,
  judged,
  observation,
  trial,
} from '../fixtures/m6-verdict.fixture';
import { runCeilingUsd } from './gate-attempts';
import type { Observation } from './gate-claims';
import { optionsOf, selectionOf } from './m6-options';
import type { Check } from './m6-preflight';
import { SCENARIOS, type ScenarioId } from './m6-scenarios';
import {
  efficiencyOf,
  finalOf,
  recordOf,
  runsOf,
  shareOf,
  verdictOf,
  type Attempt6,
  type Repetition,
  type VerdictInput,
} from './m6-verdict';

describe('shareOf', () => {
  it('everything holds in all attempts: `proven`', () => {
    const shares = shareOf(
      [trial(1, both(true, true)), trial(2, both(true, true)), trial(3, both(true, true))],
      3,
    );

    expect(shares.status).toBe('proven');
    expect(shares.observations.map((item) => [item.item, item.held, item.of])).toEqual([
      ['no noise', 3, 3],
      ['raised', 3, 3],
    ]);
  });

  it('an effect violated once in three is a failure: a label may waver, an effect may not', () => {
    const shares = shareOf(
      [trial(1, both(true, true)), trial(2, both(false, true)), trial(3, both(true, true))],
      3,
    );

    expect(shares.status).toBe('failed');
    expect(shares.observations.find((item) => item.item === 'no noise')?.ok).toBe(false);
  });

  /**
   * The perimeter is guaranteed by the App: its violation is a stop just as an effect's is, not a
   * share.
   */
  it('a perimeter observation violated once in three fails the scenario', () => {
    const attempt = (ok: boolean): Attempt6 =>
      judged(claim([observation('statuses unchanged', 'perimeter', ok)]));
    const shares = shareOf(
      [trial(1, attempt(true)), trial(2, attempt(false)), trial(3, attempt(true))],
      3,
    );

    expect(shares.status).toBe('failed');
    expect(shares.observations[0]).toMatchObject({ kind: 'perimeter', held: 2, of: 3, ok: false });
  });

  it('the share of a recognition has a polarity, and the share of an effect or a perimeter has none', () => {
    const attempt = judged(
      claim([
        observation('no noise', 'effect', true),
        observation('statuses unchanged', 'perimeter', true),
        observation('raised', 'recognition', true, 'positive'),
        observation('not raised', 'recognition', true, 'negative'),
      ]),
    );
    const shares = shareOf([trial(1, attempt)], 1).observations;

    expect(shares.map((item) => [item.item, item.kind, item.polarity])).toEqual([
      ['no noise', 'effect', undefined],
      ['statuses unchanged', 'perimeter', undefined],
      ['raised', 'recognition', 'positive'],
      ['not raised', 'recognition', 'negative'],
    ]);
  });

  it('a recognition that holds in two of three is `proven`, in one of three a failure', () => {
    const two = shareOf(
      [trial(1, both(true, true)), trial(2, both(true, false)), trial(3, both(true, true))],
      3,
    );
    const one = shareOf(
      [trial(1, both(true, true)), trial(2, both(true, false)), trial(3, both(true, false))],
      3,
    );

    expect(two.status).toBe('proven');
    expect(one.status).toBe('failed');
  });

  it.each([
    [1, 1, true],
    [2, 1, false],
    [2, 2, true],
    [4, 2, false],
    [4, 3, true],
    [5, 3, false],
    [5, 4, true],
  ])(
    'with %i judged attempts a recognition needs at least two thirds; %i hold: %s',
    (of, held, ok) => {
      const trials = Array.from({ length: of }, (_, index) =>
        trial(index + 1, both(true, index < held)),
      );

      expect(shareOf(trials, of).status).toBe(ok ? 'proven' : 'failed');
    },
  );

  /**
   * The share of each observation alone describes the observations separately, but the person reads
   * them together. Three trials that each miss something different never once produced a correct
   * recognition as a whole.
   */
  it('each recognition holds in two of three but no trial is complete: a failure', () => {
    const missing = (index: number): Attempt6 =>
      judged(
        claim(
          ['seen', 'quoted', 'asked'].map((item, position) =>
            observation(item, 'recognition', position !== index),
          ),
        ),
      );
    const shares = shareOf([trial(1, missing(0)), trial(2, missing(1)), trial(3, missing(2))], 3);

    expect(shares.observations.every((item) => item.ok)).toBe(true);
    expect(shares.wholeTrials).toEqual({ held: 0, of: 3, ok: false });
    expect(shares.status).toBe('failed');
  });

  it('complete trials are counted separately: two of three is `proven`, and the number shows in the verdict', () => {
    const shares = shareOf(
      [trial(1, both(true, true)), trial(2, both(true, false)), trial(3, both(true, true))],
      3,
    );

    expect(shares.wholeTrials).toEqual({ held: 2, of: 3, ok: true });
    expect(shares.status).toBe('proven');
  });

  /**
   * One judged run of the three requested does not prove a share, and a recognition failure on it
   * is not yet a verdict.
   */
  it('with few judged trials, a recognition failure yields `not_proven` and an effect violation yields `failed`', () => {
    const lone = (effect: boolean, recognition: boolean): Repetition[] => [
      trial(1, both(effect, recognition)),
      trial(2, errored(), errored()),
    ];

    expect(shareOf(lone(true, false), 3).status).toBe('not_proven');
    expect(shareOf(lone(false, true), 3).status).toBe('failed');
  });

  /**
   * A step that does not happen in every trial (R2 without a continuation) has its share among the
   * trials where it occurred. Two thirds of the complete trials can hold while the step itself
   * fails in two judgments of three. The share of each observation is judged separately from the
   * complete trials.
   */
  it('an observation missing from some trials is judged by those where it was present', () => {
    const attempt = (...observations: Observation[]): Attempt6 => judged(claim(observations));
    const shares = shareOf(
      [
        trial(
          1,
          attempt(observation('A', 'recognition', true), observation('R2', 'recognition', true)),
        ),
        trial(
          2,
          attempt(observation('A', 'recognition', true), observation('R2', 'recognition', false)),
        ),
        trial(3, attempt(observation('A', 'recognition', true))),
      ],
      3,
    );

    expect(shares.wholeTrials).toEqual({ held: 2, of: 3, ok: true });
    expect(shares.observations.find((share) => share.item === 'R2')).toMatchObject({
      held: 1,
      of: 2,
      ok: false,
    });
    expect(shares.status).toBe('failed');
  });

  it('an infrastructure failure after a retry does not count as a judged trial but stays visible', () => {
    const shares = shareOf(
      [trial(1, both(true, true)), trial(2, errored(), errored()), trial(3, both(true, true))],
      3,
    );

    expect(shares.status).toBe('proven');
    expect(shares.trials).toEqual({ requested: 3, judged: 2, errored: 1, notRun: 0 });
  });

  it('a retry that succeeded after a failure becomes the conclusion of the trial', () => {
    const shares = shareOf([trial(1, errored(), both(true, true))], 1);

    expect(shares.status).toBe('proven');
    expect(shares.trials.errored).toBe(0);
  });

  it('no judged trial yields `error`, and no conducted trial yields `not_proven`', () => {
    expect(shareOf([trial(1, errored())], 1).status).toBe('error');
    expect(shareOf([], 3).status).toBe('not_proven');
  });

  it('a step not conducted or trials not conducted yield `not_proven`, and a violation yields `failed`', () => {
    const open = judged(claim([observation('raised', 'recognition', true)], ['R2: no follow-up']));
    const broke = judged(claim([observation('no noise', 'effect', false)], ['R2: no follow-up']));

    expect(shareOf([trial(1, open)], 1)).toMatchObject({
      status: 'not_proven',
      unobserved: ['R2: no follow-up'],
    });
    expect(shareOf([trial(1, both(true, true))], 3).status).toBe('not_proven');
    expect(shareOf([trial(1, broke)], 1).status).toBe('failed');
  });

  it('an observation absent from some attempts is counted among those where it was present', () => {
    const withExtra = judged(
      claim([
        observation('raised', 'recognition', true),
        observation('R2: raised', 'recognition', true),
      ]),
    );
    const without = judged(claim([observation('raised', 'recognition', true)]));
    const shares = shareOf([trial(1, withExtra), trial(2, without)], 2);

    expect(shares.observations.find((item) => item.item === 'R2: raised')).toMatchObject({
      held: 1,
      of: 1,
      ok: true,
    });
  });
});

describe('scenario verdict', () => {
  it('finalOf returns the last attempt of a trial and throws for a trial without attempts', () => {
    expect(finalOf(trial(1, errored(), both(true, true))).kind).toBe('judged');
    expect(() => finalOf(trial(1))).toThrow('has no attempt');
  });

  it('recordOf says what failed in this attempt and which failures came before it', () => {
    const record = recordOf(trial(2, errored('Notion refused'), both(false, true)));

    expect(record).toMatchObject({
      trial: 2,
      outcome: 'judged',
      failed: ['no noise'],
      attempts: [
        { attempt: 0, outcome: 'error', cause: 'infrastructure', error: 'Notion refused' },
        { attempt: 1, outcome: 'judged' },
      ],
    });
  });

  it('recordOf of a trial without a conclusion includes the error of the attempt and its cause', () => {
    expect(recordOf(trial(1, errored('boom', 'harness')))).toMatchObject({
      outcome: 'error',
      failed: [],
      attempts: [{ attempt: 0, outcome: 'error', cause: 'harness', error: 'boom' }],
    });
  });

  it('runsOf: the catalog states the number of model runs, three for the W1 chain and zero for a scenario without a model', () => {
    const of = (id: ScenarioId): number => {
      const found = SCENARIOS.find((candidate) => candidate.id === id);

      if (found === undefined) throw new Error(`the catalog has no ${id}`);

      return runsOf(found);
    };

    expect(of('W1_dependency_chain')).toBe(3);
    expect(of('U1_commitment')).toBe(1);
    expect(of('C1_resolution_reconciled')).toBe(0);
  });
});

describe('efficiencyOf', () => {
  /**
   * A failed run is cut off halfway: its duration and calls do not show what the work costs, so the
   * means are computed over completed runs and failed ones are only listed.
   */
  it('means are over completed runs, rejections and failed calls are over all of them', () => {
    const efficiency = efficiencyOf([
      artifact(),
      artifact({
        durationMs: 50_000,
        calls: { notion: 1, gbrain: 2 },
        rejectedResults: 2,
        failedNotionCalls: 1,
        turns: 31,
        metered: 4,
      }),
      artifact({
        status: 'failed',
        durationMs: null,
        calls: { notion: 9 },
        rejectedResults: 0,
        metered: 2,
        refusedQueries: 1,
      }),
    ]);

    expect(efficiency).toEqual({
      runs: 3,
      failedRuns: 1,
      meanDurationSeconds: 40,
      meanCalls: { notion: 2, app: 1, gbrain: 1 },
      rejectedResults: 2,
      runsWithRejection: 1,
      failedNotionCalls: 1,
      maxTurns: 31,
      maxMetered: 4,
      meanMetered: 2,
      refusedQueries: 1,
      maxPacketLength: 0,
    });
  });

  it('with no runs there is no duration', () => {
    expect(efficiencyOf([]).meanDurationSeconds).toBeNull();
  });
});

describe('shareOf: sufficiency of judged trials', () => {
  it('three requested and one judged is `not_proven`: one trial does not prove a share', () => {
    const shares = shareOf([trial(1, both(true, true)), trial(2, errored(), errored())], 3);

    expect(shares.status).toBe('not_proven');
    expect(shares.trials).toEqual({ requested: 3, judged: 1, errored: 1, notRun: 1 });
  });

  it('one requested and judged is `proven`, and so are two requested and two judged', () => {
    expect(shareOf([trial(1, both(true, true))], 1).status).toBe('proven');
    expect(shareOf([trial(1, both(true, true)), trial(2, both(true, true))], 2).status).toBe(
      'proven',
    );
  });

  it('all three conducted but one judged and two errored is `not_proven`', () => {
    const shares = shareOf(
      [trial(1, both(true, true)), trial(2, errored(), errored()), trial(3, errored(), errored())],
      3,
    );

    expect(shares.trials).toEqual({ requested: 3, judged: 1, errored: 2, notRun: 0 });
    expect(shares.status).toBe('not_proven');
  });

  it('two judged of three requested and one not conducted is `not_proven`', () => {
    expect(shareOf([trial(1, both(true, true)), trial(2, both(true, true))], 3).status).toBe(
      'not_proven',
    );
  });
});

describe('recordOf: all attempts of a trial are kept', () => {
  it('a retry does not hide runs that already used up quota', () => {
    const paid = artifact({ run: 'run-paid' });
    const failed: Attempt6 = {
      kind: 'error',
      tag: '1-failed',
      cause: 'infrastructure',
      error: 'Notion refused',
      artifacts: [paid],
    };
    const record = recordOf(trial(1, failed, both(true, true)));

    expect(record.attempts.map((item) => [item.attempt, item.outcome, item.cause])).toEqual([
      [0, 'error', 'infrastructure'],
      [1, 'judged', undefined],
    ]);
    expect(record.attempts[0]?.artifacts).toEqual([paid]);
  });

  it('each attempt has its own tag: the residue in Notion is looked up by it', () => {
    const record = recordOf(trial(1, errored(), both(true, true)));

    expect(record.attempts.map((item) => item.tag)).toEqual(['1-abc123', '1-abc123']);
  });
});

describe('verdictOf', () => {
  const OPTIONS = optionsOf(['--trials=3']);
  const NO_CHECKS: Check[] = [];
  const header = {
    at: new Date('2026-10-08T21:30:00.000Z'),
    timeZone: 'Europe/Kyiv',
    language: 'uk',
    skill: 'aaaaaaaaaaaa',
    schema: 'bbbbbbbbbbbb',
    gate: 'cccccccccccc',
    notionQueryAllowance: 10,
  };
  const cleanup = { clean: true, left: [], unmanaged: [] };
  const blockingIds = SCENARIOS.filter((info) => info.tier === 'blocking').map((info) => info.id);
  const everyone = (make: (id: ScenarioId) => Repetition[]): VerdictInput['conducted'] =>
    Object.fromEntries(SCENARIOS.map((info) => [info.id, make(info.id)]));
  const held = (): Repetition[] => [
    trial(1, both(true, true)),
    trial(2, both(true, true)),
    trial(3, both(true, true)),
  ];

  function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
    return {
      options: OPTIONS,
      selected: SCENARIOS,
      preflight: NO_CHECKS,
      conducted: everyone(held),
      skipped: {},
      stopped: null,
      cleanup,
      header,
      ...overrides,
    };
  }

  it('everything proven on three trials is `ok` and `accepted`', () => {
    const { document, result } = verdictOf(input());

    expect(result).toEqual({ ok: true, clean: true });
    expect(document).toMatchObject({ ok: true, accepted: true, partial: false, stopped: null });
  });

  it('the header contains the digests, the weekday in the time zone of the App and the date', () => {
    const { document } = verdictOf(input());

    expect(document).toMatchObject({
      gate: 'M6',
      at: '2026-10-08T21:30:00.000Z',
      weekday: 'Friday',
      timeZone: 'Europe/Kyiv',
      skill: 'aaaaaaaaaaaa',
      schema: 'bbbbbbbbbbbb',
      digest: 'cccccccccccc',
      trials: 3,
      recordedTrials: 1,
    });
  });

  it('the time zone of the App, not UTC, decides the weekday: in UTC it is already Friday evening, and in Kyiv Saturday night', () => {
    const { document } = verdictOf(
      input({ header: { ...header, at: new Date('2026-10-09T22:30:00.000Z') } }),
    );

    expect(document).toMatchObject({ weekday: 'Saturday' });
  });

  /**
   * A stopped gate keeps the scenarios it did not conduct in the verdict instead of removing them.
   */
  it('a stopped gate: every selected scenario is present, and one not conducted is `not_proven`', () => {
    const { document, result } = verdictOf(
      input({
        conducted: { U1_commitment: [trial(1, both(true, true))] },
        stopped: 'runs are held: plan_quota',
      }),
    );

    expect(Object.keys(document.scenarios)).toHaveLength(SCENARIOS.length);
    expect(document.scenarios.W1_dependency_chain).toMatchObject({
      status: 'not_proven',
      trials: { requested: 3, judged: 0, errored: 0, notRun: 3 },
    });
    expect(result.ok).toBe(false);
    expect(document).toMatchObject({ stopped: 'runs are held: plan_quota', accepted: false });
  });

  it('a check that failed stops only the scenarios it names and says which check it was', () => {
    const check: Check = {
      check: 'a GBrain page is written, found by the project id and removed',
      ok: false,
      detail: 'down',
      blocks: ['F1_lesson_applies', 'F2_lesson_elsewhere'],
    };
    const { document } = verdictOf(
      input({
        preflight: [check],
        conducted: everyone((id) =>
          id === 'F1_lesson_applies' || id === 'F2_lesson_elsewhere' ? [] : held(),
        ),
      }),
    );
    expect(document.scenarios.F1_lesson_applies).toMatchObject({
      status: 'not_proven',
      blockedBy: [check.check],
    });
    expect(document.scenarios.U1_commitment).toMatchObject({ status: 'proven', blockedBy: [] });
    expect(document.ok).toBe(false);
  });

  it('a scenario skipped because a dependency broke has the reason in `blockedBy`', () => {
    const { document } = verdictOf(
      input({
        conducted: everyone((id) =>
          id === 'F1_lesson_applies' || id === 'F2_lesson_elsewhere'
            ? [trial(1, both(true, true))]
            : held(),
        ),
        skipped: {
          F1_lesson_applies: 'GBrain failed in 2 trials in a row',
          F2_lesson_elsewhere: 'GBrain failed in 2 trials in a row',
        },
      }),
    );

    expect(document.scenarios.F1_lesson_applies).toMatchObject({
      status: 'not_proven',
      blockedBy: ['GBrain failed in 2 trials in a row'],
      trials: { requested: 3, judged: 1, notRun: 2 },
    });
    expect(document.ok).toBe(false);
  });

  it('a single trial or a partial run accepts nothing: `ok` without `accepted`', () => {
    const one = verdictOf(
      input({
        options: optionsOf(['--trials=1']),
        conducted: everyone((id) =>
          id === 'W1_dependency_chain' ? [] : [trial(1, both(true, true))],
        ),
      }),
    );
    const partial = verdictOf(
      input({
        options: optionsOf(['--only=U1', '--trials=3']),
        selected: SCENARIOS.filter((info) => info.id === 'U1_commitment'),
      }),
    );

    expect(one.document.accepted).toBe(false);
    expect(partial.document).toMatchObject({ ok: true, accepted: false, partial: true });
  });

  it('a violation in a recorded scenario does not break `ok`: it is only recorded', () => {
    const { document } = verdictOf(
      input({
        conducted: everyone((id) =>
          id === 'N2_deadline_passed' ? [trial(1, both(false, true))] : held(),
        ),
      }),
    );

    expect(document.ok).toBe(true);
  });

  it('the summary by tier: blocking and recorded separately', () => {
    const { document } = verdictOf(
      input({
        conducted: everyone((id) =>
          id === 'N2_deadline_passed' ? [trial(1, both(false, true))] : held(),
        ),
      }),
    );

    expect(document.summary).toEqual({
      blocking: { proven: blockingIds.length, failed: 0, error: 0, not_proven: 0 },
      recorded: {
        proven: SCENARIOS.length - blockingIds.length - 1,
        failed: 1,
        error: 0,
        not_proven: 0,
      },
    });
  });

  it('perimeter violations are listed separately as an App regression', () => {
    const broken = judged(claim([observation('statuses unchanged', 'perimeter', false)]));
    const { document } = verdictOf(
      input({
        conducted: everyone((id) => (id === 'U1_commitment' ? [trial(1, broken)] : held())),
      }),
    );

    expect(document.perimeterFailures).toEqual(['U1_commitment: statuses unchanged (0/1)']);
  });

  /**
   * An App regression is listed separately: a violated model choice is not one, and a passed
   * perimeter is not a violation.
   */
  it('neither a violated effect nor a passed perimeter goes into the perimeter list', () => {
    const mixed = judged(
      claim([
        observation('statuses unchanged', 'perimeter', true),
        observation('nothing is said', 'effect', false),
      ]),
    );
    const { document } = verdictOf(
      input({
        conducted: everyone((id) => (id === 'N1_free_path' ? [trial(1, mixed)] : held())),
      }),
    );

    expect(document.perimeterFailures).toEqual([]);
    expect(document.scenarios.N1_free_path?.status).toBe('failed');
  });

  it('--preflight: scenarios are not conducted, and `ok` means every check passed', () => {
    const failing: Check = { check: 'channel', ok: false, detail: 'x', blocks: [] };
    const passed = verdictOf(
      input({
        options: optionsOf(['--preflight']),
        conducted: {},
        preflight: [{ ...failing, ok: true }],
      }),
    );
    const failed = verdictOf(
      input({ options: optionsOf(['--preflight']), conducted: {}, preflight: [failing] }),
    );

    expect(passed.document.scenarios).toEqual({});
    expect(passed.result.ok).toBe(true);
    expect(failed.result.ok).toBe(false);
  });

  it('cleanup residue leaves `clean` false and does not touch `ok`', () => {
    const { result } = verdictOf(
      input({ cleanup: { clean: false, left: ['page x'], unmanaged: [] } }),
    );

    expect(result).toEqual({ ok: true, clean: false });
  });

  /**
   * A word without the context of a diagnosis proves nothing (“це не лінощі”, ‘this is not
   * laziness’), so it does not touch `ok`; but the texts a person will read stay unread until
   * someone has looked at them, so the run is not `accepted`.
   */
  it('a diagnostic word surfaces and revokes `accepted` but does not touch `ok`', () => {
    const flagged = artifact({ flags: ['лінь', 'лінь'], model: 'claude-opus-5-5' });
    const { document, result } = verdictOf(
      input({
        conducted: everyone((id) =>
          id === 'B1_behavior_miss'
            ? [
                trial(1, judged(claim([observation('no noise', 'effect', true)]), [flagged])),
                trial(2, judged(claim([observation('no noise', 'effect', true)]), [])),
                trial(3, judged(claim([observation('no noise', 'effect', true)]), [])),
              ]
            : held(),
        ),
      }),
    );

    expect(result.ok).toBe(true);
    expect(document).toMatchObject({ ok: true, accepted: false, flags: { лінь: 2 } });
  });

  it('without diagnostic words the flags are empty', () => {
    expect(verdictOf(input()).document.flags).toEqual({});
  });

  it('models, diagnostic words and efficiency are taken from the artifacts of all attempts', () => {
    const flagged = artifact({ flags: ['лінь'], model: 'claude-opus-5-5' });
    const { document } = verdictOf(
      input({
        selected: SCENARIOS.filter((info) => info.id === 'B1_behavior_miss'),
        options: optionsOf(['--only=B1']),
        conducted: {
          B1_behavior_miss: [
            trial(1, judged(claim([observation('no noise', 'effect', true)]), [flagged])),
          ],
        },
      }),
    );

    expect(document.models).toEqual(['claude-opus-5-5']);
    expect(document.scenarios.B1_behavior_miss?.flags).toEqual({ лінь: 1 });
  });
  /**
   * `every` on an empty list is true, so an empty check or an empty selection would call themselves
   * a success without reservation: `ok` needs something to have been checked and the gate to have
   * reached the end.
   */
  describe('`ok` is never empty', () => {
    const preflightOnly = optionsOf(['--preflight']);
    const passing: Check = { check: 'channel', ok: true, detail: null, blocks: [] };

    it('--preflight with the runner not ready: no check and the reason in `stopped` is not `ok`', () => {
      const { document, result } = verdictOf(
        input({
          options: preflightOnly,
          conducted: {},
          preflight: [],
          stopped: 'the runner is not ready: no grant',
        }),
      );

      expect(result.ok).toBe(false);
      expect(document).toMatchObject({ ok: false, stopped: 'the runner is not ready: no grant' });
    });

    it('--preflight with no check, even with no stop reason, is not `ok`', () => {
      expect(
        verdictOf(input({ options: preflightOnly, conducted: {}, preflight: [] })).result.ok,
      ).toBe(false);
    });

    it('--preflight with a passed check is `ok`, with a stop it is not', () => {
      const run = (stopped: string | null): boolean =>
        verdictOf(input({ options: preflightOnly, conducted: {}, preflight: [passing], stopped }))
          .result.ok;

      expect(run(null)).toBe(true);
      expect(run('a gate is already running')).toBe(false);
    });

    it('an empty selection of scenarios proves nothing', () => {
      expect(verdictOf(input({ selected: [], conducted: {} })).result.ok).toBe(false);
    });

    /**
     * A selection of recorded scenarios alone fails nothing, but a stopped launch that conducted
     * nothing is not a success.
     */
    it('recorded only: conducted is `ok`, stopped before starting is not `ok`', () => {
      const recorded = SCENARIOS.filter((info) => info.tier === 'recorded');
      const options = optionsOf(['--only=N2,P2']);
      const chosen = recorded.filter((info) => ['N2', 'P2'].includes(info.id.split('_')[0] ?? ''));
      const ran = verdictOf(
        input({
          options,
          selected: chosen,
          conducted: Object.fromEntries(
            chosen.map((info) => [info.id, [trial(1, both(true, true))]]),
          ),
        }),
      );
      const held = verdictOf(
        input({
          options,
          selected: chosen,
          conducted: {},
          stopped: 'runs are held: plan_quota',
        }),
      );

      expect(ran.result.ok).toBe(true);
      expect(held.result.ok).toBe(false);
    });

    it('a stopped gate is not `ok` even if everything conducted held', () => {
      const { result } = verdictOf(
        input({ stopped: 'two repetitions in a row ended without a verdict' }),
      );

      expect(result.ok).toBe(false);
    });
  });

  /** Acceptance is only the full suite on three judged trials: less is a check, not a verdict. */
  describe('`accepted` needs the full suite on three judged trials', () => {
    const complete = (args: readonly string[], selected: VerdictInput['selected']): boolean => {
      const options = optionsOf(args);

      return verdictOf(
        input({
          options,
          selected,
          conducted: Object.fromEntries(
            selected.map((info) => [info.id, held().slice(0, options.trials)]),
          ),
        }),
      ).document.accepted;
    };

    it('three trials and the full suite are accepted', () => {
      expect(complete(['--trials=3'], SCENARIOS)).toBe(true);
    });

    it('two trials are not accepted even though everything is proven', () => {
      const options = optionsOf(['--trials=2']);
      const { document } = verdictOf(
        input({
          options,
          conducted: everyone(() => held().slice(0, 2)),
        }),
      );

      expect(document).toMatchObject({ ok: true, accepted: false });
    });

    it('three requested but two judged (the third errored): `proven` but not `accepted`', () => {
      const { document } = verdictOf(
        input({
          conducted: everyone(() => [
            trial(1, both(true, true)),
            trial(2, both(true, true)),
            trial(3, errored(), errored()),
          ]),
        }),
      );

      expect(document).toMatchObject({ ok: true, accepted: false });
    });

    it.each([
      ['--without-held-out', ['--trials=3', '--without-held-out']],
      ['--only', ['--trials=3', '--only=U1,N1']],
    ])('%s makes the run partial: `ok` but not `accepted`', (_, args) => {
      const options = optionsOf(args);
      const chosen = selectionOf(options);
      const { document } = verdictOf(
        input({
          options,
          selected: chosen,
          conducted: Object.fromEntries(chosen.map((info) => [info.id, held()])),
        }),
      );

      expect(document).toMatchObject({ ok: true, partial: true, accepted: false });
    });

    it('--preflight makes the run partial and accepts nothing', () => {
      const { document } = verdictOf(
        input({
          options: optionsOf(['--preflight']),
          conducted: {},
          preflight: [{ check: 'channel', ok: true, detail: null, blocks: [] }],
        }),
      );

      expect(document).toMatchObject({ ok: true, partial: true, accepted: false });
    });
  });

  /**
   * The cost states both the runs and the retry after a failure, so the operator sees what it
   * costs before spending the quota.
   */
  describe('cost', () => {
    const cost = (args: readonly string[]): string => {
      const options = optionsOf(args);
      const chosen = selectionOf(options);

      return verdictOf(input({ options, selected: chosen, conducted: {} })).document.cost;
    };
    const ceiling = runCeilingUsd();

    it('is 55 runs for a full run with three trials, and twice as many in the worst case', () => {
      expect(cost(['--trials=3'])).toBe(
        `up to ${ceiling} USD of plan quota per run, 55 runs at best, at most 110 (a retry follows an infrastructure error only)`,
      );
    });

    it('depends on the number of trials: one trial takes 23 runs (the W1 chain takes three)', () => {
      expect(cost(['--trials=1'])).toContain('23 runs at best, at most 46');
    });

    it('recorded trials cost too', () => {
      expect(cost(['--trials=1', '--recorded-trials=2'])).toContain('30 runs at best, at most 60');
    });

    it('--preflight costs no model runs', () => {
      expect(cost(['--preflight'])).toContain('0 runs at best, at most 0');
    });
  });
});
