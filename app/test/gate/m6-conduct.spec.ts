import type { RunProvenance } from '../../src/runs/provenance';
import { DEADLINE_REACHED } from '../../src/runs/run.launcher';
import { good, goodChain, idOf, trace, type Chain } from '../fixtures/m6-evidence.fixture';
import { HarnessError, InfrastructureError, UnreachedRunError } from './gate-attempts';
import { emptyResidue, type Residue } from './gate-cleanup';
import type { World } from './m5-scenarios';
import {
  chainConductors,
  conductAll,
  conductAttempt,
  type Planned,
  type Runnable,
  type ScenarioPort,
} from './m6-conduct';
import type { Evidence6 } from './m6-evidence';
import {
  memoryOf,
  SCENARIOS,
  SINGLE_RUNS,
  tagOf,
  variantNumber,
  type AttemptId,
  type ScenarioId,
  type ScenarioInfo,
} from './m6-scenarios';
import { isPlanted, type EditTrigger, type MemoryPage, type ReplyTrigger } from './scenario-kit';
import type { Ids } from './scenario-world';

function info(id: ScenarioId): ScenarioInfo {
  const found = SCENARIOS.find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`no scenario ${id}`);

  return found;
}

/**
 * What the fake port cannot do: where it throws. The name of the call and how many times it has
 * been called.
 */
interface Script {
  readonly fail?: (call: string, count: number, scenario: ScenarioId) => Error | undefined;
  /** `none` means the first run wrote no continuation, so there is nothing to wake. */
  readonly recheck?: 'woken' | 'none';
  readonly tag?: string;
}

/**
 * A port without Notion and the model: it returns evidence of “everything as it must be” and
 * records its calls, so the conduct itself is checked: the order of steps, attempts, retries,
 * stopping, cleanup.
 */
class FakePort implements ScenarioPort {
  readonly calls: string[] = [];
  readonly cleaned: Residue[] = [];
  readonly built: { readonly scenario: ScenarioId; readonly name: string }[] = [];
  readonly planted: MemoryPage[][] = [];
  readonly replied: AttemptId[] = [];
  /** Each event on a page: the step, the page and slots that fired it, and the world ids. */
  readonly edits: { readonly step: string; readonly trigger: EditTrigger; readonly ids: Ids }[] =
    [];
  /** The page on which the continuation was woken. */
  readonly rechecked: string[] = [];
  private scenario: ScenarioId = 'N1_free_path';
  private tag: string;
  private readonly counts = new Map<string, number>();
  private readonly chain: Chain = goodChain();

  constructor(private readonly script: Script = {}) {
    this.tag = script.tag ?? '';
  }

  private step<T>(call: string, make: () => T): Promise<T> {
    this.calls.push(call);

    const count = (this.counts.get(call) ?? 0) + 1;

    this.counts.set(call, count);

    const error = this.script.fail?.(call, count, this.scenario);

    return error === undefined ? Promise.resolve(make()) : Promise.reject(error);
  }

  begin(): Residue {
    this.calls.push('begin');

    return emptyResidue();
  }

  build(pages: World, scenario: ScenarioInfo): Promise<Ids> {
    this.built.push({ scenario: scenario.id, name: pages[0]?.name ?? '' });

    return this.step('build', () => {
      this.scenario = scenario.id;

      return Object.fromEntries(pages.map((page) => [page.key, idOf(page.key)]));
    });
  }

  plant(pages: readonly MemoryPage[]): Promise<void> {
    return this.step('plant', () => {
      this.planted.push([...pages]);
    });
  }

  awaitFindable(): Promise<void> {
    return this.step('findable', () => undefined);
  }

  edit(ids: Ids, trigger: EditTrigger, step: string): Promise<Evidence6> {
    return this.step(`edit:${step}`, () => {
      this.edits.push({ step, trigger, ids });

      if (this.scenario !== 'W1_dependency_chain') return good(this.scenario, this.tag);

      return step === 'W1' ? this.chain.detection : this.chain.repeated;
    });
  }

  reply(_ids: Ids, _trigger: ReplyTrigger, id: AttemptId): Promise<Evidence6> {
    return this.step('reply', () => {
      this.replied.push(id);

      return good(this.scenario, tagOf(id));
    });
  }

  recheck(_ids: Ids, task: string): Promise<Evidence6 | null> {
    return this.step('recheck', () => {
      this.rechecked.push(task);

      return this.script.recheck === 'none' ? null : this.chain.recheck;
    });
  }

  clean(residue: Residue): Promise<readonly string[]> {
    return this.step('clean', () => {
      this.cleaned.push(residue);

      return [];
    });
  }
}

/** Builds run gates that remember which origin they were asked about and refuse at `refuseOn`. */
function gateThat(refuseOn?: number): Runnable & { readonly asked: (RunProvenance | undefined)[] } {
  const asked: (RunProvenance | undefined)[] = [];

  return {
    asked,
    assertRunnable: (provenance) => {
      asked.push(provenance);

      return asked.length === refuseOn
        ? Promise.reject(new Error('runs are held: plan_quota'))
        : Promise.resolve();
    },
  };
}

const id = (scenario: ScenarioId, trial = 1, attempt = 0): AttemptId => ({
  run: '4821',
  scenario,
  trial,
  attempt,
});

describe('conductAttempt: one attempt', () => {
  it('conducts an event on a page: world, event, claim, and cleanup; the run artifact is recorded', async () => {
    const port = new FakePort();
    const attempt = await conductAttempt(
      info('N1_free_path'),
      port,
      chainConductors(port),
      id('N1_free_path'),
    );

    expect(port.calls).toEqual(['begin', 'build', 'plant', 'edit:run', 'clean']);
    expect(attempt.kind).toBe('judged');
    expect(attempt.kind === 'judged' && attempt.claim.ok).toBe(true);
    expect(attempt.artifacts).toHaveLength(1);
    expect(port.cleaned).toHaveLength(1);
  });

  it("conducts the person's reply and passes the port the attempt tag that picks the variant of words and name", async () => {
    const port = new FakePort();
    const attempt = await conductAttempt(
      info('U1_commitment'),
      port,
      chainConductors(port),
      id('U1_commitment', 2),
    );

    expect(port.replied).toEqual([id('U1_commitment', 2)]);
    expect(attempt.kind).toBe('judged');
  });

  /**
   * The equivalent must be found by the search, not skipped, because the run is judged on the
   * Skill, not on the index.
   */
  it('U2 waits before the run until the Notion search returns the equivalent', async () => {
    const port = new FakePort();

    await conductAttempt(
      info('U2_commitment_tracked'),
      port,
      chainConductors(port),
      id('U2_commitment_tracked'),
    );

    expect(port.calls).toEqual(['begin', 'build', 'plant', 'findable', 'reply', 'clean']);
  });

  it('treats a search that did not return the equivalent as an infrastructure failure, so no run starts', async () => {
    const port = new FakePort({
      fail: (call) =>
        call === 'findable'
          ? new InfrastructureError('Notion search does not name the page')
          : undefined,
    });
    const attempt = await conductAttempt(
      info('U2_commitment_tracked'),
      port,
      chainConductors(port),
      id('U2_commitment_tracked'),
    );

    expect(attempt).toMatchObject({ kind: 'error', cause: 'infrastructure' });
    expect(port.calls).not.toContain('reply');
  });

  it("plants the scenario's memory with the attempt's tag and variant, so the lesson changes", async () => {
    const attempt = id('F1_lesson_applies', 2);
    const port = new FakePort({ tag: tagOf(attempt) });

    await conductAttempt(info('F1_lesson_applies'), port, chainConductors(port), attempt);

    expect(port.planted[0]).toEqual(
      memoryOf('F1_lesson_applies', tagOf(attempt), variantNumber(attempt)),
    );
    const [first] = (port.planted[0] ?? []).filter(isPlanted);

    expect(first?.title).toContain(tagOf(attempt));
  });

  it('yields the artifacts of three runs for the chain of event, repeat and recheck', async () => {
    const port = new FakePort();
    const attempt = await conductAttempt(
      info('W1_dependency_chain'),
      port,
      chainConductors(port),
      id('W1_dependency_chain'),
    );

    expect(port.calls).toEqual(['begin', 'build', 'edit:W1', 'edit:R1', 'recheck', 'clean']);
    expect(attempt.kind === 'judged' && attempt.claim.ok).toBe(true);
    expect(attempt.artifacts).toHaveLength(3);
  });

  /**
   * The event and the recheck of the chain concern the page that waits for an external reply, not
   * the Project or a neighboring page. Otherwise the chain would measure a different situation, and
   * the port would not notice.
   */
  it('wakes the Task that waits: both events on it with the date slot, and the recheck on it too', async () => {
    const port = new FakePort();

    await conductAttempt(
      info('W1_dependency_chain'),
      port,
      chainConductors(port),
      id('W1_dependency_chain'),
    );

    expect(port.edits.map(({ step, trigger }) => [step, trigger.page, trigger.slots])).toEqual([
      ['W1', 'waiting', ['task.date']],
      ['R1', 'waiting', ['task.date']],
    ]);
    expect(port.rechecked).toEqual([idOf('waiting')]);
    expect(port.edits[0]?.ids).toMatchObject({
      waiting: idOf('waiting'),
      project: idOf('project'),
    });
  });

  /** The event of a single-run scenario is the catalog's own, on a page of its world. */
  it.each(
    SCENARIOS.flatMap((scenario) => {
      const spec = SINGLE_RUNS[scenario.id];

      return spec?.trigger.kind === 'edit' ? [[scenario.id, spec.trigger] as const] : [];
    }),
  )('%s: the catalog event is applied to a world page', async (scenario, trigger) => {
    const port = new FakePort();

    await conductAttempt(info(scenario), port, chainConductors(port), id(scenario));

    expect(port.edits).toHaveLength(1);
    expect(port.edits[0]?.trigger).toEqual(trigger);
    expect(Object.keys(port.edits[0]?.ids ?? {})).toContain(trigger.page);
  });

  it('a chain without a continuation has no recheck, and no observations of it either', async () => {
    const port = new FakePort({ recheck: 'none' });
    const attempt = await conductAttempt(
      info('W1_dependency_chain'),
      port,
      chainConductors(port),
      id('W1_dependency_chain'),
    );

    expect(attempt.artifacts).toHaveLength(2);
    expect(
      attempt.kind === 'judged' &&
        attempt.claim.observations.some((item) => item.item.startsWith('R2: ')),
    ).toBe(false);
  });

  it('turns a world failure into an attempt without a conclusion, with a cause, and still cleans up', async () => {
    const port = new FakePort({
      fail: (call) => (call === 'build' ? new InfrastructureError('Notion is slow') : undefined),
    });
    const attempt = await conductAttempt(
      info('N1_free_path'),
      port,
      chainConductors(port),
      id('N1_free_path'),
    );

    expect(attempt).toEqual({
      kind: 'error',
      tag: tagOf(id('N1_free_path')),
      cause: 'infrastructure',
      error: 'Notion is slow',
      artifacts: [],
    });
    expect(port.cleaned).toHaveLength(1);
  });

  /**
   * A run that did not reach a conclusion (deadline, deferred) yields no evidence, but it had a
   * cost and took time, so its artifact stays and efficiency sees it.
   */
  it('leaves an artifact with a cause for a run without a conclusion, so efficiency sees it', async () => {
    const run = trace({
      id: 'run-late',
      status: 'failed',
      reason: DEADLINE_REACHED,
      durationMs: 900_000,
      toolCalls: [{ server: 'notion', tool: 'notion-fetch', ok: true }],
    });
    const port = new FakePort({
      fail: (call) =>
        call === 'edit:run'
          ? new UnreachedRunError('run: the run did not reach a verdict', 'run', run)
          : undefined,
    });
    const attempt = await conductAttempt(
      info('N1_free_path'),
      port,
      chainConductors(port),
      id('N1_free_path'),
    );

    expect(attempt).toMatchObject({ kind: 'error', cause: 'infrastructure' });
    expect(attempt.artifacts).toHaveLength(1);
    expect(attempt.artifacts[0]).toMatchObject({
      run: 'run-late',
      status: 'failed',
      reason: DEADLINE_REACHED,
      durationMs: 900_000,
      step: 'run',
    });
  });

  it('leaves the artifacts of the runs that already happened on a failure in the middle of the chain', async () => {
    const port = new FakePort({
      fail: (call) =>
        call === 'edit:R1' ? new InfrastructureError('the run was denied') : undefined,
    });
    const attempt = await conductAttempt(
      info('W1_dependency_chain'),
      port,
      chainConductors(port),
      id('W1_dependency_chain'),
    );

    expect(attempt.kind).toBe('error');
    expect(attempt.artifacts).toHaveLength(1);
    expect(port.cleaned).toHaveLength(1);
  });

  it.each([
    [
      'a harness fault in the scenario description',
      new HarnessError('the world does not read as designed'),
      'harness',
    ],
    ['an infrastructure failure', new InfrastructureError('denied'), 'infrastructure'],
    ['an unknown exception', new Error('TypeError: x is undefined'), 'unexpected'],
  ])('%s gets its own cause in the attempt', async (_, error, cause) => {
    const port = new FakePort({ fail: (call) => (call === 'plant' ? error : undefined) });
    const attempt = await conductAttempt(
      info('N1_free_path'),
      port,
      chainConductors(port),
      id('N1_free_path'),
    );

    expect(attempt).toMatchObject({ kind: 'error', cause, error: error.message });
  });
});

describe('conductAll: trial by trial', () => {
  const plan = (...entries: [ScenarioId, number][]): Planned[] =>
    entries.map(([scenario, trials]) => ({ info: info(scenario), trials }));
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
  };

  it('conducts the first trial of all scenarios first, then the second', async () => {
    const port = new FakePort();

    await conductAll(
      plan(['N1_free_path', 2], ['A1_area_of_focus_quiet', 2], ['Q1_quiet_edit', 1]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );

    expect(port.built.map((item) => item.scenario)).toEqual([
      'N1_free_path',
      'A1_area_of_focus_quiet',
      'Q1_quiet_edit',
      'N1_free_path',
      'A1_area_of_focus_quiet',
    ]);
  });

  it('numbers the trials and combines them per scenario', async () => {
    const port = new FakePort();
    const { repetitions, stopped } = await conductAll(
      plan(['N1_free_path', 3]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );

    expect(stopped).toBeNull();
    expect(repetitions['N1_free_path']?.map((item) => item.number)).toEqual([1, 2, 3]);
  });

  it('retries an infrastructure failure once under a new tag, and the retry stays beside the failure', async () => {
    const port = new FakePort({
      fail: (call, count) =>
        call === 'build' && count === 1 ? new InfrastructureError('slow') : undefined,
    });
    const { repetitions } = await conductAll(
      plan(['N1_free_path', 1]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );
    const attempts = repetitions['N1_free_path']?.[0]?.attempts ?? [];

    const first = tagOf({ run: '4821', scenario: 'N1_free_path', trial: 1, attempt: 0 });
    const retry = tagOf({ run: '4821', scenario: 'N1_free_path', trial: 1, attempt: 1 });

    expect(attempts.map((item) => item.kind)).toEqual(['error', 'judged']);
    expect(first).not.toBe(retry);
    expect(port.built[0]?.name).toContain(first);
    expect(port.built[1]?.name).toContain(retry);
  });

  /**
   * A harness fault in the description is not fixed by a retry, which would only spend one more
   * model run.
   */
  it('does not retry a harness fault in the scenario description', async () => {
    const port = new FakePort({
      fail: (call) =>
        call === 'build' ? new HarnessError('the world does not read as designed') : undefined,
    });
    const { repetitions } = await conductAll(
      plan(['N1_free_path', 1]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );

    expect(repetitions['N1_free_path']?.[0]?.attempts).toHaveLength(1);
    expect(port.built).toHaveLength(1);
  });

  /**
   * The verdict stub of a stopped gate contains nothing that was conducted, so the operator sees
   * the cause of a failure in the log.
   */
  it('logs every attempt without a conclusion with the tag, the cause and the failure text', async () => {
    const said: string[] = [];
    const port = new FakePort({
      fail: (call, count) =>
        call === 'build' && count === 1
          ? new InfrastructureError('Notion\nanswered 502')
          : undefined,
    });

    await conductAll(
      plan(['N1_free_path', 1]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      (line) => said.push(line),
    );

    const first = tagOf({ run: '4821', scenario: 'N1_free_path', trial: 1, attempt: 0 });

    expect(said).toEqual([
      `N1_free_path trial 1: ${first} infrastructure error: Notion answered 502`,
      'N1_free_path trial 1: judged',
    ]);
  });

  it('stops the gate when the run gates close, and what was conducted stays', async () => {
    const port = new FakePort();
    const { repetitions, stopped } = await conductAll(
      plan(['N1_free_path', 2], ['A1_area_of_focus_quiet', 2]),
      port,
      chainConductors(port),
      gateThat(3),
      '4821',
      log,
    );

    expect(stopped).toBe('runs are held: plan_quota');
    expect(Object.keys(repetitions)).toEqual(['N1_free_path', 'A1_area_of_focus_quiet']);
    expect(repetitions['N1_free_path']).toHaveLength(1);
    expect(lines.at(-1)).toContain('stopped before N1_free_path trial 2');
  });

  it('asks the run gates before each trial, and for the chain also with the autonomous origin', async () => {
    const gate = gateThat();

    const port = new FakePort();

    await conductAll(
      plan(['N1_free_path', 1], ['W1_dependency_chain', 1]),
      port,
      chainConductors(port),
      gate,
      '4821',
      log,
    );

    expect(gate.asked).toEqual([
      undefined,
      { origin: 'scheduled_check', reasonCode: 'await_external_event' },
    ]);
  });

  const environment = (
    call: string,
    count: number,
    failing: readonly number[],
  ): Error | undefined =>
    call === 'build' && failing.includes(count)
      ? new InfrastructureError('Notion is down')
      : undefined;

  it('stops the gate on two consecutive trials without a conclusion because of the environment', async () => {
    const port = new FakePort({
      fail: (call, count) => environment(call, count, [1, 2, 3, 4, 5, 6]),
    });
    const { repetitions, stopped } = await conductAll(
      plan(['N1_free_path', 3]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );

    expect(stopped).toContain('2 trials in a row');
    expect(repetitions['N1_free_path']).toHaveLength(2);
    expect(port.built).toHaveLength(4);
  });

  it('resets the counter on a conclusion about behavior, so failure, conclusion, failure does not stop the gate', async () => {
    const port = new FakePort({ fail: (call, count) => environment(call, count, [1, 2, 4, 5]) });
    const { repetitions, stopped } = await conductAll(
      plan(['N1_free_path', 3]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );

    expect(stopped).toBeNull();
    expect(repetitions['N1_free_path']).toHaveLength(3);
  });

  it("leaves the counter unchanged on a harness fault in one scenario's description, because the other scenarios do not depend on that fault", async () => {
    const port = new FakePort({
      fail: (call) =>
        call === 'build' ? new HarnessError('the world does not read as designed') : undefined,
    });
    const { repetitions, stopped } = await conductAll(
      plan(['N1_free_path', 3]),
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );

    expect(stopped).toBeNull();
    expect(repetitions['N1_free_path']).toHaveLength(3);
  });

  /**
   * A failure of something only some of the scenarios depend on (GBrain, the channel) does not mean
   * the rest will fail. The scenarios with that dependency are skipped, and the rest continue.
   */
  describe('a dependency that broke in the middle of a gate run', () => {
    const memoryDown = (call: string, _count: number, scenario: ScenarioId): Error | undefined =>
      call === 'plant' && ['F1_lesson_applies', 'F2_lesson_elsewhere'].includes(scenario)
        ? new Error('gbrain put_page: 502')
        : undefined;

    it('skips two memory scenarios in a row after GBrain fails on them, and the rest continue', async () => {
      const port = new FakePort({ fail: memoryDown });
      const { repetitions, skipped, stopped } = await conductAll(
        plan(['F1_lesson_applies', 3], ['F2_lesson_elsewhere', 3], ['A1_area_of_focus_quiet', 3]),
        port,
        chainConductors(port),
        gateThat(),
        '4821',
        log,
      );

      expect(stopped).toBeNull();
      expect(repetitions['F1_lesson_applies']).toHaveLength(1);
      expect(repetitions['F2_lesson_elsewhere']).toHaveLength(1);
      expect(repetitions['A1_area_of_focus_quiet']).toHaveLength(3);
      expect(skipped['F1_lesson_applies']).toBe('GBrain failed in 2 trials in a row');
      expect(skipped['F2_lesson_elsewhere']).toBe('GBrain failed in 2 trials in a row');
      expect(skipped['A1_area_of_focus_quiet']).toBeUndefined();
    });

    it('skips all reply scenarios when the channel does not answer two of them in a row', async () => {
      const port = new FakePort({
        fail: (call, _count, scenario) =>
          call === 'reply' && ['U1_commitment', 'U2_commitment_tracked'].includes(scenario)
            ? new InfrastructureError('the webhook answered 502')
            : undefined,
      });
      const { repetitions, skipped, stopped } = await conductAll(
        plan(
          ['U1_commitment', 2],
          ['U2_commitment_tracked', 2],
          ['U4_commitment_intent', 2],
          ['N1_free_path', 2],
        ),
        port,
        chainConductors(port),
        gateThat(),
        '4821',
        log,
      );

      expect(stopped).toBeNull();
      expect(Object.keys(skipped).sort()).toEqual([
        'U1_commitment',
        'U2_commitment_tracked',
        'U4_commitment_intent',
      ]);
      expect(repetitions['N1_free_path']).toHaveLength(2);
    });

    it('stops the gate on failures of different dependencies in a row, because something unknown is wrong', async () => {
      const port = new FakePort({
        fail: (call, _count, scenario) =>
          call === 'build' && ['F1_lesson_applies', 'A1_area_of_focus_quiet'].includes(scenario)
            ? new InfrastructureError('Notion is down')
            : undefined,
      });
      const { stopped } = await conductAll(
        plan(['F1_lesson_applies', 3], ['A1_area_of_focus_quiet', 3]),
        port,
        chainConductors(port),
        gateThat(),
        '4821',
        log,
      );

      expect(stopped).toContain('2 trials in a row');
    });

    it('resets the streak on a conclusion between two failures of one dependency', async () => {
      const port = new FakePort({
        fail: (call, _count, scenario) =>
          call === 'plant' && scenario === 'F1_lesson_applies'
            ? new Error('gbrain put_page: 502')
            : call === 'plant' && scenario === 'F2_lesson_elsewhere'
              ? new Error('gbrain put_page: 502')
              : undefined,
      });
      const { skipped, stopped } = await conductAll(
        plan(['F1_lesson_applies', 1], ['N1_free_path', 1], ['F2_lesson_elsewhere', 1]),
        port,
        chainConductors(port),
        gateThat(),
        '4821',
        log,
      );

      expect(stopped).toBeNull();
      expect(skipped).toEqual({});
    });
  });

  it('conducts nothing and does not stop on an empty plan', async () => {
    const port = new FakePort();
    const { repetitions, stopped } = await conductAll(
      [],
      port,
      chainConductors(port),
      gateThat(),
      '4821',
      log,
    );

    expect(repetitions).toEqual({});
    expect(stopped).toBeNull();
  });
});
