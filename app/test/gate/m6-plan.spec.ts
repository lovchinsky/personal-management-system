import { optionsOf, selectionOf } from './m6-options';
import { autonomousRunsOf, planOf, startRefusalOf } from './m6-plan';
import type { Check } from './m6-preflight';
import { shortOf, type ScenarioId } from './m6-scenarios';

const check = (ok: boolean, blocks: readonly ScenarioId[]): Check => ({
  check: `blocks ${blocks.join(',')}`,
  ok,
  detail: null,
  blocks,
});

describe('planOf', () => {
  const options = optionsOf(['--trials=3', '--recorded-trials=2']);
  const selected = selectionOf(options);

  it('conducts every selected scenario with its own number of trials when no check has failed', () => {
    const plan = planOf(selected, [check(true, ['F1_lesson_applies'])], options);

    expect(plan.map((item) => item.info.id)).toEqual(selected.map((info) => info.id));
    expect(plan.map((item) => [shortOf(item.info.id), item.trials])).toContainEqual(['U1', 3]);
    expect(plan.map((item) => [shortOf(item.info.id), item.trials])).toContainEqual(['N2', 2]);
  });

  /**
   * A blocked scenario is not conducted at all, because a run on a broken dependency would prove
   * nothing.
   */
  it('removes only the scenarios a failed check names', () => {
    const plan = planOf(
      selected,
      [check(false, ['F1_lesson_applies', 'F2_lesson_elsewhere'])],
      options,
    );
    const names = plan.map((item) => shortOf(item.info.id));

    expect(names).not.toContain('F1');
    expect(names).not.toContain('F2');
    expect(names).toHaveLength(selected.length - 2);
  });

  it('blocks no scenario on a passed check, and failed checks are combined', () => {
    const plan = planOf(
      selected,
      [
        check(false, ['F1_lesson_applies']),
        check(true, ['U1_commitment']),
        check(false, ['N1_free_path']),
      ],
      options,
    );
    const names = plan.map((item) => shortOf(item.info.id));

    expect(names).toContain('U1');
    expect(names).not.toContain('F1');
    expect(names).not.toContain('N1');
  });

  it('plans no scenario under --preflight, because the model is not called', () => {
    const preflight = optionsOf(['--preflight']);

    expect(planOf(selectionOf(preflight), [check(true, [])], preflight)).toEqual([]);
  });
});

describe('startRefusalOf', () => {
  /** Builds a session that records its calls: whether it asked the run gates. */
  function session(
    failure: { ready?: string; gates?: string } = {},
    room = 40,
  ): {
    readonly asked: string[];
    readonly session: {
      ready(): Promise<void>;
      assertRunnable(): Promise<void>;
      autonomousRoom(): Promise<number>;
    };
  } {
    const asked: string[] = [];

    return {
      asked,
      session: {
        autonomousRoom: () => {
          asked.push('room');

          return Promise.resolve(room);
        },
        ready: () => {
          asked.push('ready');

          return failure.ready === undefined
            ? Promise.resolve()
            : Promise.reject(new Error(failure.ready));
        },
        assertRunnable: () => {
          asked.push('gates');

          return failure.gates === undefined
            ? Promise.resolve()
            : Promise.reject(new Error(failure.gates));
        },
      },
    };
  }

  it('everything is ready: no refusal', async () => {
    const { asked, session: ready } = session();

    expect(await startRefusalOf(ready, { preflight: false })).toBeNull();
    expect(asked).toEqual(['ready', 'gates']);
  });

  it('the runner is not ready: the reason, and the run gates are not asked', async () => {
    const { asked, session: notReady } = session({ ready: 'the runner is not ready: no grant' });

    expect(await startRefusalOf(notReady, { preflight: false })).toBe(
      'the runner is not ready: no grant',
    );
    expect(asked).toEqual(['ready']);
  });

  it('the run gates are closed: the reason', async () => {
    const { session: held } = session({ gates: 'runs are held: plan_quota' });

    expect(await startRefusalOf(held, { preflight: false })).toBe('runs are held: plan_quota');
  });

  it('does not ask the daily limit when there are no autonomous runs', async () => {
    const { asked, session: ready } = session({}, 0);

    expect(await startRefusalOf(ready, { preflight: false }, 0)).toBeNull();
    expect(asked).toEqual(['ready', 'gates']);
  });

  it('returns no refusal when the limit covers all autonomous runs of the launch', async () => {
    const { asked, session: ready } = session({}, 6);

    expect(await startRefusalOf(ready, { preflight: false }, 6)).toBeNull();
    expect(asked).toEqual(['ready', 'gates', 'room']);
  });

  /**
   * All gates of one local day share the limit, so a launch that would hit it midway does not
   * start.
   */
  it('refuses when the limit falls short, saying how much is left and how much is needed', async () => {
    const { session: short } = session({}, 4);

    expect(await startRefusalOf(short, { preflight: false }, 6)).toMatch(
      /leaves 4 for today, and this run needs 6/,
    );
  });

  it('autonomousRunsOf counts the autonomous runs of the suite scenarios over all trials and returns zero under --preflight', () => {
    const m8 = optionsOf(['--trials=3'], 'm8');

    expect(autonomousRunsOf(selectionOf(m8), m8)).toBe(6);
    expect(
      autonomousRunsOf(selectionOf(optionsOf(['--trials=3'])), optionsOf(['--trials=3'])),
    ).toBe(3);
    expect(
      autonomousRunsOf(
        selectionOf(optionsOf(['--preflight'], 'm8')),
        optionsOf(['--preflight'], 'm8'),
      ),
    ).toBe(0);
  });

  /** A model-free check spends no quota, so an exhausted plan quota does not hinder it. */
  it('--preflight does not ask the run gates, so the model-free check proceeds with the quota exhausted', async () => {
    const { asked, session: held } = session({ gates: 'runs are held: plan_quota' });

    expect(await startRefusalOf(held, { preflight: true })).toBeNull();
    expect(asked).toEqual(['ready']);
  });

  it('--preflight still refuses when the runner is not ready', async () => {
    const { session: notReady } = session({ ready: 'the runner is not ready: no grant' });

    expect(await startRefusalOf(notReady, { preflight: true })).toBe(
      'the runner is not ready: no grant',
    );
  });
});
