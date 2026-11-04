import { messageOf } from '../../src/platform/error/message-of';
import { artifact, claim, judged, observation, trial } from '../fixtures/m6-verdict.fixture';
import type { Observation } from './gate-claims';
import type { Artifact } from './m6-claims';
import {
  compare,
  compareArguments,
  compareExitCode,
  parseVerdict,
  renderComparison,
  statusOf,
  type Verdict,
} from './m6-compare';
import { LABELS_NOT_RAISED } from './m6-items';
import { optionsOf } from './m6-options';
import { SCENARIOS, type ScenarioId } from './m6-scenarios';
import { verdictOf, type Repetition } from './m6-verdict';

const NONE = { targets: [], confirmations: [] };
const CLEANUP = { clean: true, left: [], unmanaged: [] };

/** Builds the trials of a scenario; the caller supplies the observations and artifacts of each. */
function runs(
  count: number,
  observations: (index: number) => Observation[],
  artifacts: (index: number) => Artifact[] = () => [artifact()],
): Repetition[] {
  return Array.from({ length: count }, (_, index) =>
    trial(index + 1, judged(claim(observations(index)), artifacts(index))),
  );
}

interface Header {
  readonly digest?: string;
  readonly schema?: string;
  readonly at?: string;
  readonly skill?: string;
  readonly timeZone?: string;
  readonly language?: string;
  readonly args?: readonly string[];
  readonly allowance?: number | 'unlimited';
}

/**
 * Builds a verdict the way the gate issues it: assembled by `verdictOf`, passed through JSON and
 * parsed by the comparison.
 */
function verdict(
  conducted: Partial<Record<ScenarioId, Repetition[]>>,
  header: Header = {},
  trials = 3,
): Verdict {
  const selected = SCENARIOS.filter((info) => info.id in conducted);
  const { document } = verdictOf({
    options: optionsOf([`--trials=${trials}`, ...(header.args ?? [])]),
    selected,
    preflight: [],
    conducted,
    skipped: {},
    stopped: null,
    cleanup: CLEANUP,
    header: {
      at: new Date(header.at ?? '2026-10-08T10:00:00.000Z'),
      timeZone: header.timeZone ?? 'Europe/Kyiv',
      language: header.language ?? 'uk',
      skill: header.skill ?? 'aaaaaaaaaaaa',
      schema: header.schema ?? 'bbbbbbbbbbbb',
      gate: header.digest ?? 'cccccccccccc',
      notionQueryAllowance: header.allowance ?? 10,
    },
  });

  return parseVerdict(JSON.parse(JSON.stringify(document)), 'test');
}

const items = (
  count: number,
  kind: 'effect' | 'perimeter' | 'recognition',
  held: (index: number) => boolean,
  polarity: 'positive' | 'negative' = 'positive',
): Observation[] =>
  Array.from({ length: count }, (_, index) =>
    observation(`${kind} ${polarity} ${index}`, kind, held(index), polarity),
  );

const rule = (comparison: ReturnType<typeof compare>, start: string) =>
  comparison.rules.find((candidate) => candidate.rule.startsWith(start));

/** Builds a repeat of the candidate's scenario, passed to the comparison with a file name. */
const repeat = (given: Verdict, name = 'repeat.json') => ({ name, verdict: given });

describe('parseVerdict', () => {
  it('parses a verdict built by the gate', () => {
    const parsed = verdict({ N1_free_path: runs(3, () => items(2, 'effect', () => true)) });

    expect(Object.keys(parsed.scenarios)).toEqual(['N1_free_path']);
    expect(parsed.scenarios['N1_free_path']?.observations).toHaveLength(2);
    expect(parsed).toMatchObject({ partial: false, stopped: null });
  });

  it('treats JSON of another shape as an error naming the file, not an empty verdict', () => {
    expect(() => parseVerdict({ gate: 'M5' }, 'gate-m5.json')).toThrow(
      'gate-m5.json is not a verdict of a scenario gate',
    );
  });
});

describe('incomparable verdicts', () => {
  const clean = (header: Header = {}, count = 3): Verdict =>
    verdict({ N1_free_path: runs(count, () => items(1, 'effect', () => true)) }, header);
  const base = clean();

  it.each([
    ['gate', { digest: 'dddddddddddd' }, 'the gate differs'],
    ['result schema', { schema: 'eeeeeeeeeeee' }, 'the result schema differs'],
    ['time zone', { timeZone: 'America/New_York' }, 'the time zone differs'],
    ['App language', { language: 'en' }, 'the App language differs'],
    [
      'Notion query allowance',
      { allowance: 'unlimited' as const },
      'the Notion query allowance differs',
    ],
  ])('refuses to compare when the %s differs', (_, header, reason) => {
    const comparison = compare(base, clean(header), NONE);

    expect(comparison.comparable.ok).toBe(false);
    expect(comparison.comparable.reasons.join()).toContain(reason);
    expect(comparison.rules).toEqual([]);
    expect(comparison.ok).toBe(false);
    expect(renderComparison(comparison)).toContain('verdict: INCOMPARABLE');
  });

  it('refuses a different model too, because it would compare models, not the Skill', () => {
    const other = verdict({
      N1_free_path: runs(
        3,
        () => items(1, 'effect', () => true),
        () => [artifact({ model: 'claude-sonnet-5' })],
      ),
    });

    expect(compare(base, other, NONE).comparable.reasons.join()).toContain('the model differs');
  });

  it('accepts a confirming repeat only of this candidate and refuses one of another Skill or gate', () => {
    const candidate = clean({ skill: 'ffffffffffff' });
    const otherSkill = compare(base, candidate, {
      targets: [],
      confirmations: [repeat(clean({ skill: 'gggggggggggg' }), 'other-skill.json')],
    });
    const otherGate = compare(base, candidate, {
      targets: [],
      confirmations: [
        repeat(clean({ skill: 'ffffffffffff', digest: 'hhhhhhhhhhhh' }), 'gate.json'),
      ],
    });

    expect(otherSkill.comparable.reasons).toEqual([
      'the confirmation other-skill.json is not a repeat of the candidate: the Skill differs from the candidate',
    ]);
    expect(otherGate.comparable.reasons.join()).toContain(
      'the confirmation gate.json is not a repeat of the candidate: the gate differs',
    );
    expect(otherSkill.rules).toEqual([]);
  });

  it('ignores the order of models in a verdict: the set is compared', () => {
    const models = (first: string, second: string): Verdict =>
      verdict(
        {
          N1_free_path: runs(
            2,
            () => items(1, 'effect', () => true),
            (index) => [artifact({ model: index === 0 ? first : second })],
          ),
        },
        {},
        2,
      );

    expect(
      compare(
        models('claude-opus-5-5', 'claude-sonnet-5'),
        models('claude-sonnet-5', 'claude-opus-5-5'),
        NONE,
      ).comparable.ok,
    ).toBe(true);
  });

  it('has nothing to compare when no scenario has two judged trials in both', () => {
    const one = verdict({ N1_free_path: runs(1, () => items(1, 'effect', () => true)) }, {}, 1);
    const comparison = compare(one, one, NONE);

    expect(comparison.comparable.ok).toBe(false);
    expect(comparison.comparable.reasons.join()).toContain('there is nothing to compare');
  });
});

describe('the same against the same', () => {
  const same = (): Verdict =>
    verdict({
      N1_free_path: runs(3, () => [
        ...items(2, 'effect', () => true),
        ...items(2, 'recognition', () => true, 'negative'),
      ]),
      U1_commitment: runs(3, () => items(2, 'recognition', () => true, 'positive')),
    });

  it('the rule holds, and the report says so', () => {
    const comparison = compare(same(), same(), NONE);

    expect(comparison.ok).toBe(true);
    expect(renderComparison(comparison)).toContain('verdict: PASS');
    expect(renderComparison(comparison)).toContain('compared: U1, N1');
    expect(comparison.rules.every((item) => item.ok)).toBe(true);
  });

  it('notes the same Skill in two verdicts: there is nothing to compare', () => {
    expect(compare(same(), same(), NONE).notes).toContain('the Skill is the same in both verdicts');
  });

  it('leaves notes empty without a cause: recorded scenarios go unmentioned when there were none', () => {
    expect(compare(same(), same(), NONE).notes).toEqual(['the Skill is the same in both verdicts']);
  });
});

describe('effects', () => {
  const baseline = verdict({ N1_free_path: runs(3, () => items(1, 'effect', () => true)) });
  const worse = (violations: number): Verdict =>
    verdict({ N1_free_path: runs(3, (index) => items(1, 'effect', () => index >= violations)) });

  /** A repeat: of `trials` trials, the first `violations` violated the effect. */
  const confirmation = (violations: number, trials: number): Verdict =>
    verdict(
      { N1_free_path: runs(trials, (index) => items(1, 'effect', () => index >= violations)) },
      {},
      trials,
    );

  it('waits for a repeat and does not pass yet on one violation in three with a clean baseline', () => {
    const found = rule(compare(baseline, worse(1), NONE), 'effects');

    expect(found?.ok).toBe(false);
    expect(found?.detail).toEqual([
      {
        scenario: 'N1',
        item: 'effect positive 0',
        baseline: '0/3',
        candidate: '1/3',
        repeats: null,
        confirmation: 'unconfirmed',
      },
    ]);
  });

  it('confirms a regression without a repeat on two violations in three with a clean baseline', () => {
    const found = rule(compare(baseline, worse(2), NONE), 'effects');

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject([{ candidate: '2/3', confirmation: 'confirmed' }]);
  });

  it('refutes the suspicion on a repeat at five with fewer than two violations', () => {
    const found = rule(
      compare(baseline, worse(1), { targets: [], confirmations: [repeat(confirmation(1, 5))] }),
      'effects',
    );

    expect(found?.ok).toBe(true);
    expect(found?.detail).toMatchObject([{ repeats: '1/5', confirmation: 'refuted' }]);
  });

  it('confirms the regression on a repeat at five with two violations', () => {
    const found = rule(
      compare(baseline, worse(1), { targets: [], confirmations: [repeat(confirmation(2, 5))] }),
      'effects',
    );

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject([{ repeats: '2/5', confirmation: 'confirmed' }]);
  });

  /**
   * The sample that raised the suspicion is biased: the repeat is not combined with it but decides
   * alone.
   */
  it('lets a repeat refute even a suspicion that already had two violations: the independent sample decides', () => {
    const found = rule(
      compare(baseline, worse(2), { targets: [], confirmations: [repeat(confirmation(1, 5))] }),
      'effects',
    );

    expect(found?.ok).toBe(true);
  });

  it('decides nothing on a repeat at fewer than five', () => {
    const found = rule(
      compare(baseline, worse(1), { targets: [], confirmations: [repeat(confirmation(0, 3))] }),
      'effects',
    );

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject([{ repeats: null, confirmation: 'unconfirmed' }]);
  });

  it('combines repeats of one item: one violation in five, twice, makes two in ten', () => {
    const found = rule(
      compare(baseline, worse(1), {
        targets: [],
        confirmations: [repeat(confirmation(1, 5), 'a.json'), repeat(confirmation(1, 5), 'b.json')],
      }),
      'effects',
    );

    expect(found?.detail).toMatchObject([{ repeats: '2/10', confirmation: 'confirmed' }]);
  });

  it('refutes nothing with a repeat of another scenario or another item', () => {
    const elsewhere = verdict(
      { A1_area_of_focus_quiet: runs(5, () => items(1, 'effect', () => true)) },
      {},
      5,
    );

    expect(
      rule(
        compare(baseline, worse(1), { targets: [], confirmations: [repeat(elsewhere)] }),
        'effects',
      )?.ok,
    ).toBe(false);
  });

  /**
   * The baseline violated too: “no worse” is measured by its own share, and the repeat has to
   * exceed it.
   */
  describe('where the baseline violated too', () => {
    const noisy = verdict({
      N1_free_path: runs(3, (index) => items(1, 'effect', () => index !== 0)),
    });
    const twice = verdict({
      N1_free_path: runs(3, (index) => items(1, 'effect', () => index === 2)),
    });

    it('does not suspect an identical candidate', () => {
      expect(rule(compare(noisy, noisy, NONE), 'effects')).toMatchObject({ ok: true, detail: [] });
    });

    it('makes a candidate that violates more often than the baseline wait for a repeat: violations without a repeat are not enough', () => {
      expect(rule(compare(noisy, twice, NONE), 'effects')?.detail).toMatchObject([
        { baseline: '1/3', candidate: '2/3', confirmation: 'unconfirmed' },
      ]);
    });

    it("on a repeat, two in five is 40% against the baseline's 33%, so confirmed; one is refuted", () => {
      const confirmed = compare(noisy, twice, {
        targets: [],
        confirmations: [repeat(confirmation(2, 5))],
      });
      const refuted = compare(noisy, twice, {
        targets: [],
        confirmations: [repeat(confirmation(1, 5))],
      });

      expect(rule(confirmed, 'effects')?.ok).toBe(false);
      expect(rule(refuted, 'effects')?.ok).toBe(true);
    });

    /**
     * A repeat share that merely equals the baseline's does not prove a regression: a higher one
     * is needed.
     */
    it("lets a repeat with the same share as the baseline's refute the suspicion: a higher one is needed", () => {
      const same = compare(noisy, twice, {
        targets: [],
        confirmations: [repeat(confirmation(2, 6))],
      });

      expect(rule(same, 'effects')?.detail).toMatchObject([
        { repeats: '2/6', confirmation: 'refuted' },
      ]);
    });
  });

  /**
   * An observation the baseline did not have (a step that did not happen) was not violated:
   * violations in it are new.
   */
  it('counts an observation missing from the baseline as zero violations in it', () => {
    const extra = verdict({
      N1_free_path: runs(3, (index) => [
        ...items(1, 'effect', () => true),
        observation('an extra effect', 'effect', index === 0),
      ]),
    });

    expect(rule(compare(baseline, extra, NONE), 'effects')?.detail).toMatchObject([
      { item: 'an extra effect', baseline: '0/0', candidate: '2/3' },
    ]);
  });
});

describe('perimeter', () => {
  const guarded = (broken: (index: number) => boolean): Verdict =>
    verdict({
      N1_free_path: runs(3, (index) => [
        ...items(1, 'perimeter', () => !broken(index)),
        ...items(1, 'effect', () => true),
      ]),
    });
  const clean = guarded(() => false);

  it('treats a new violation as an App regression: the rule fails, and a repeat does not refute it', () => {
    const broken = guarded((index) => index === 0);
    const comparison = compare(clean, broken, {
      targets: [],
      confirmations: [repeat(guarded(() => false))],
    });

    expect(rule(comparison, 'perimeter')?.ok).toBe(false);
    expect(rule(comparison, 'perimeter')?.detail).toEqual([
      { scenario: 'N1', item: 'perimeter positive 0', baseline: '0/3', candidate: '1/3' },
    ]);
    expect(rule(comparison, 'effects')?.ok).toBe(true);
  });

  it('does not treat the same violation in the baseline as new', () => {
    const broken = guarded((index) => index === 0);

    expect(rule(compare(broken, broken, NONE), 'perimeter')?.ok).toBe(true);
  });

  /** Guarding is the App's job: it does not wait until the baseline has measured this scenario. */
  it('sees a violation in even one judged trial: the guard does not wait for a second', () => {
    const lone = verdict({
      N1_free_path: runs(3, () => [
        ...items(1, 'perimeter', () => true),
        ...items(1, 'effect', () => true),
      ]),
      A1_area_of_focus_quiet: runs(1, () => items(1, 'perimeter', () => false)),
    });

    expect(rule(compare(clean, lone, NONE), 'perimeter')?.detail).toMatchObject([
      { scenario: 'A1', baseline: '0/0', candidate: '1/1' },
    ]);
  });

  it('also fails on a violation in a scenario the baseline did not judge', () => {
    const wider = verdict({
      N1_free_path: runs(3, () => [
        ...items(1, 'perimeter', () => true),
        ...items(1, 'effect', () => true),
      ]),
      A1_area_of_focus_quiet: runs(3, () => items(1, 'perimeter', () => false)),
    });

    expect(rule(compare(clean, wider, NONE), 'perimeter')?.detail).toMatchObject([
      { scenario: 'A1', baseline: '0/0', candidate: '3/3' },
    ]);
  });
});

describe('recognition item by item', () => {
  const single = (held: (trial: number) => boolean, count = 3): Verdict =>
    verdict(
      { U1_commitment: runs(count, (index) => items(1, 'recognition', () => held(index))) },
      {},
      count,
    );
  const baseline = single(() => true);

  it('fails an item that held in the baseline and never worked in the candidate, without a repeat', () => {
    const found = rule(
      compare(
        baseline,
        single(() => false),
        NONE,
      ),
      'recognition per item',
    );

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject([
      { scenario: 'U1', baseline: '3/3', candidate: '0/3', confirmation: 'confirmed' },
    ]);
  });

  it('makes a partial decline wait for a repeat: four in five refute it, two in five confirm it', () => {
    const lower = single((index) => index === 0);
    const holds = repeat(single((index) => index < 4, 5));
    const falls = repeat(single((index) => index < 2, 5));

    expect(rule(compare(baseline, lower, NONE), 'recognition per item')?.detail).toMatchObject([
      { candidate: '1/3', repeats: null, confirmation: 'unconfirmed' },
    ]);
    expect(
      rule(
        compare(baseline, lower, { targets: [], confirmations: [holds] }),
        'recognition per item',
      )?.ok,
    ).toBe(true);
    expect(
      rule(
        compare(baseline, lower, { targets: [], confirmations: [falls] }),
        'recognition per item',
      )?.ok,
    ).toBe(false);
  });

  it('treats no matches in two trials as not yet a verdict: it waits for a repeat', () => {
    const two = (held: boolean): Verdict => single(() => held, 2);
    const found = rule(compare(two(true), two(false), NONE), 'recognition per item');

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject([{ candidate: '0/2', confirmation: 'unconfirmed' }]);
  });

  it('does not count as a new loss what did not hold in the baseline either', () => {
    const weak = single((index) => index === 0);

    expect(
      rule(
        compare(
          weak,
          single(() => false),
          NONE,
        ),
        'recognition per item',
      )?.ok,
    ).toBe(true);
  });

  /**
   * The pool is level, but one item disappeared and another appeared in its place: pools do not
   * see this.
   */
  it('catches an item that fell while another rose, though the pool did not change', () => {
    const swapped = (first: boolean, second: boolean): Verdict =>
      verdict({
        U1_commitment: runs(3, () => [
          observation('first', 'recognition', first, 'positive'),
          observation('second', 'recognition', second, 'positive'),
        ]),
      });
    const comparison = compare(swapped(true, false), swapped(false, true), NONE);

    expect(rule(comparison, 'recognition (positive)')?.ok).toBe(true);
    expect(rule(comparison, 'recognition per item')?.ok).toBe(false);
  });
});

describe('recognition: two pools by polarity', () => {
  /** Thirty observations of each polarity: ten items in each of three trials. */
  const pool = (positive: number, negative: number): Verdict =>
    verdict({
      U1_commitment: runs(3, (index) => [
        ...items(10, 'recognition', (item) => item * 3 + index < positive, 'positive'),
        ...items(10, 'recognition', (item) => item * 3 + index < negative, 'negative'),
      ]),
    });

  it('holds at ten points lower, and does not at more', () => {
    const base = pool(30, 30);

    expect(rule(compare(base, pool(27, 30), NONE), 'recognition (positive)')?.ok).toBe(true);
    expect(rule(compare(base, pool(26, 30), NONE), 'recognition (positive)')?.ok).toBe(false);
  });

  /**
   * A quiet version that stopped raising labels cannot pretend all is well, because silence “makes
   * no mistakes”.
   */
  it('does not let silence mask losses: the negative pool does not rescue the positive one', () => {
    const comparison = compare(pool(30, 20), pool(20, 30), NONE);

    expect(rule(comparison, 'recognition (positive)')?.ok).toBe(false);
    expect(rule(comparison, 'recognition (negative)')?.ok).toBe(true);
    expect(comparison.ok).toBe(false);
  });

  it('shows the scenarios, the mean share, the pool, the Wilson intervals and the Newcombe difference in the report', () => {
    const detail = rule(
      compare(pool(30, 30), pool(27, 30), NONE),
      'recognition (positive)',
    )?.detail;

    expect(detail).toMatchObject({
      scenarios: [{ scenario: 'U1', baseline: '30/30', candidate: '27/30' }],
      mean: { baseline: 1, candidate: 0.9, difference: -0.1 },
      pooled: {
        baseline: { held: 30, of: 30, share: 1, wilson: [0.886, 1] },
        candidate: { held: 27, of: 30, share: 0.9, wilson: [0.744, 0.965] },
        newcombe: [-0.256, 0.031],
      },
    });
  });

  it('uses the whole segment from zero to one as the Wilson interval of an empty pool', () => {
    const onlyNegative = verdict({
      N1_free_path: runs(3, () => items(1, 'recognition', () => true, 'negative')),
    });
    const detail = rule(
      compare(onlyNegative, onlyNegative, NONE),
      'recognition (positive)',
    )?.detail;

    expect(detail).toMatchObject({
      scenarios: [],
      pooled: { baseline: { held: 0, of: 0, wilson: [0, 1] } },
    });
  });

  /** Nine items of one scenario must not drown out the failure of the single item of another. */
  it('weighs a scenario as much as any other, however many items it has', () => {
    const scenes = (alone: boolean): Verdict =>
      verdict({
        U1_commitment: runs(3, () => items(1, 'recognition', () => alone)),
        P1_last_task_done: runs(3, () => items(10, 'recognition', () => true)),
      });
    const comparison = compare(scenes(true), scenes(false), NONE);

    expect(rule(comparison, 'recognition (positive)')?.ok).toBe(false);
    expect(rule(comparison, 'recognition (positive)')?.detail).toMatchObject({
      mean: { baseline: 1, candidate: 0.5 },
      pooled: { candidate: { held: 30, of: 33 } },
    });
  });

  /**
   * An item set for every scenario would outweigh the pool, so it is read separately in each
   * scenario.
   */
  it('keeps an item shared by every scenario out of the pool', () => {
    const every = (held: boolean): Verdict =>
      verdict({
        U1_commitment: runs(3, () => [
          observation(LABELS_NOT_RAISED, 'recognition', held, 'negative'),
        ]),
      });
    const comparison = compare(every(true), every(false), NONE);

    expect(rule(comparison, 'recognition (negative)')).toMatchObject({
      ok: true,
      detail: { scenarios: [] },
    });
    expect(rule(comparison, 'recognition per item')?.ok).toBe(false);
  });

  it('keeps scenarios meant to grow (adoption) out of the pools and shows them separately', () => {
    const adopting = (held: boolean): Verdict =>
      verdict(
        {
          U3_commitment_undated: runs(2, () => items(1, 'recognition', () => held, 'positive')),
          U1_commitment: runs(3, () => items(1, 'recognition', () => true, 'positive')),
        },
        { args: ['--recorded-trials=2'] },
      );
    const comparison = compare(adopting(false), adopting(true), NONE);

    expect(rule(comparison, 'recognition (positive)')?.detail).toMatchObject({
      pooled: { baseline: { held: 3, of: 3 } },
    });
    expect(rule(comparison, 'adoption')?.detail).toEqual([
      { scenario: 'U3', item: 'recognition positive 0', before: '0/2', after: '2/2' },
    ]);
  });
});

describe('target observations', () => {
  const target = (held: (index: number, trial: number) => boolean): Verdict =>
    verdict({
      W1_dependency_chain: runs(3, (trialIndex) =>
        items(4, 'recognition', (index) => held(index, trialIndex), 'positive'),
      ),
    });
  const aimed = { targets: ['W1'], confirmations: [] };

  it('has no rule when no target is named', () => {
    expect(
      rule(
        compare(
          target(() => true),
          target(() => true),
          NONE,
        ),
        'targets',
      ),
    ).toBeUndefined();
  });

  it('holds when the pool is not lower and better on half of what can be improved', () => {
    const base = target((index) => index >= 2);
    const next = target((index) => index >= 1);

    expect(rule(compare(base, next, aimed), 'targets')?.ok).toBe(true);
  });

  /**
   * A single drop is not a verdict on the targets: the per-item rule catches it, and the targets
   * say whether the Skill reached its goal.
   */
  it('lets the targets hold and the per-item rule fail when one item fell and the rest rose', () => {
    const base = target((index) => index >= 2);
    const next = target((index) => index !== 2);
    const comparison = compare(base, next, aimed);

    expect(rule(comparison, 'targets')?.ok).toBe(true);
    expect(rule(comparison, 'recognition per item')?.ok).toBe(false);
  });

  it('requires only that it does not fall where the baseline is not below a hundred percent', () => {
    expect(
      rule(
        compare(
          target(() => true),
          target(() => true),
          aimed,
        ),
        'targets',
      )?.ok,
    ).toBe(true);
  });

  it('does not hold when the pool is lower', () => {
    const base = target(() => true);
    const next = target((index) => index !== 0);

    expect(rule(compare(base, next, aimed), 'targets')?.ok).toBe(false);
  });

  it('does not hold when fewer than half of the items that can be improved got better', () => {
    const base = target(() => false);
    const next = target((index) => index === 0);

    expect(rule(compare(base, next, aimed), 'targets')?.ok).toBe(false);
  });

  it('treats a target absent from the verdicts as a refusal, not a silent agreement', () => {
    const found = rule(
      compare(
        target(() => true),
        target(() => true),
        { targets: ['K1'], confirmations: [] },
      ),
      'targets',
    );

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject({ missing: ['K1'] });
  });

  it('refuses a target without any recognition: it shows nothing, so there is nothing to compare', () => {
    const effectsOnly = (): Verdict =>
      verdict({ N1_free_path: runs(3, () => items(1, 'effect', () => true)) });
    const found = rule(
      compare(effectsOnly(), effectsOnly(), { targets: ['N1'], confirmations: [] }),
      'targets',
    );

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject({ missing: [], items: [] });
  });

  /**
   * One of the named targets was not compared and another holds: “everything holds” on half of the
   * targets is no answer, and the rule does not let through a target that is named but not
   * compared.
   */
  it('refuses and names the target when one is compared and holds while another was not compared', () => {
    const pair = (held: boolean): Verdict =>
      verdict({
        W1_dependency_chain: runs(3, () => items(2, 'recognition', () => held, 'positive')),
        N1_free_path: runs(3, () => items(1, 'effect', () => true)),
      });
    const found = rule(
      compare(pair(true), pair(true), { targets: ['W1', 'K1'], confirmations: [] }),
      'targets',
    );

    expect(found?.ok).toBe(false);
    expect(found?.detail).toMatchObject({ missing: ['K1'] });
    expect(
      rule(compare(pair(true), pair(true), { targets: ['W1'], confirmations: [] }), 'targets')?.ok,
    ).toBe(true);
  });
});

describe('efficiency', () => {
  const timed = (seconds: number, calls = { notion: 4 }, extra: Partial<Artifact> = {}): Verdict =>
    verdict({
      N1_free_path: runs(
        3,
        () => items(1, 'effect', () => true),
        () => [artifact({ durationMs: seconds * 1_000, calls, ...extra })],
      ),
    });

  /**
   * Builds a sample of `count` runs, where `extra` says how each one differs. Thresholds in points
   * need a larger sample than `--trials` allows, and the verdict does not care how many were
   * requested.
   */
  const sample = (count: number, extra: (index: number) => Partial<Artifact>): Verdict =>
    verdict(
      {
        N1_free_path: runs(
          count,
          () => items(1, 'effect', () => true),
          (index) => [artifact(extra(index))],
        ),
      },
      {},
      9,
    );
  const failed = (reason: string): Partial<Artifact> => ({
    status: 'failed',
    durationMs: null,
    reason,
  });
  const calm = (): Partial<Artifact> => ({});

  it('holds up to fifteen percent slower, and not beyond', () => {
    expect(rule(compare(timed(100), timed(114), NONE), 'efficiency')?.ok).toBe(true);
    expect(rule(compare(timed(100), timed(116), NONE), 'efficiency')?.ok).toBe(false);
  });

  /**
   * `100 * 1.15` in floating point is `114.99999999999999`: a value exactly at the tolerance must
   * not fail on the rounding error.
   */
  it('holds at exactly fifteen percent slower or heavier: floating-point error does not break the limit', () => {
    const calls = (notion: number): Verdict => timed(100, { notion });

    expect(rule(compare(timed(100), timed(115), NONE), 'efficiency')?.ok).toBe(true);
    expect(rule(compare(calls(20), calls(23), NONE), 'efficiency')?.ok).toBe(true);
    expect(rule(compare(timed(100), timed(115.1), NONE), 'efficiency')?.ok).toBe(false);
    // 6.9 / 6 is exactly 15%, but in binary arithmetic it is 1.1500000000000001.
    expect(rule(compare(timed(6), timed(6.9), NONE), 'efficiency')?.ok).toBe(true);
  });

  it('treats any call over zero baseline calls as an excess, and zero to zero as none', () => {
    const calls = (notion: number): Verdict => timed(100, { notion });

    expect(rule(compare(calls(0), calls(1), NONE), 'efficiency')?.ok).toBe(false);
    expect(rule(compare(calls(0), calls(0), NONE), 'efficiency')?.ok).toBe(true);
  });

  it('does not hold when heavier in calls by more than fifteen percent', () => {
    const calls = (notion: number): Verdict => timed(100, { notion });

    expect(rule(compare(calls(20), calls(22), NONE), 'efficiency')?.ok).toBe(true);
    expect(rule(compare(calls(20), calls(24), NONE), 'efficiency')?.ok).toBe(false);
  });

  it('tolerates failed runs up to ten points above the baseline, and not more', () => {
    const base = sample(10, calm);
    const lost = (count: number): Verdict =>
      sample(10, (index) => (index < count ? failed('the run ended with api_error') : calm()));

    expect(rule(compare(base, lost(1), NONE), 'efficiency')?.ok).toBe(true);
    expect(rule(compare(base, lost(2), NONE), 'efficiency')?.ok).toBe(false);
  });

  /**
   * One run that hit the turn ceiling is a sampling coincidence; two above the baseline is already
   * a sign.
   */
  it('tolerates one more run that hit the turn ceiling than the baseline has, and not two', () => {
    const limit = 'the run ended with max_turns (subtype error_max_turns)';
    const limited = (count: number): Verdict =>
      sample(40, (index) => (index < count ? failed(limit) : calm()));

    expect(rule(compare(limited(0), limited(1), NONE), 'efficiency')?.ok).toBe(true);
    expect(rule(compare(limited(0), limited(2), NONE), 'efficiency')?.ok).toBe(false);
    expect(rule(compare(limited(1), limited(2), NONE), 'efficiency')?.ok).toBe(true);
  });

  it('tolerates a share of runs with a rejected result five points higher, and not more', () => {
    const rejecting = (count: number): Verdict =>
      sample(40, (index) => (index < count ? { rejectedResults: 1 } : calm()));

    expect(rule(compare(rejecting(0), rejecting(2), NONE), 'efficiency')?.ok).toBe(true);
    expect(rule(compare(rejecting(0), rejecting(3), NONE), 'efficiency')?.ok).toBe(false);
  });

  it('shows pairs in the report: duration, calls, shares, turn ceilings', () => {
    expect(rule(compare(timed(100), timed(110), NONE), 'efficiency')?.detail).toEqual({
      meanDurationSeconds: [100, 110],
      meanCalls: [4, 4],
      rejectionShare: [0, 0],
      failureShare: [0, 0],
      turnLimits: [0, 0],
    });
  });
});

describe('notes', () => {
  const quiet = (header: Header = {}, count = 3): Verdict =>
    verdict({ N1_free_path: runs(count, () => items(1, 'effect', () => true)) }, header);

  it('notes that verdicts were taken on different days', () => {
    const notes = compare(
      quiet({ at: '2026-10-08T10:00:00.000Z' }),
      quiet({ at: '2026-10-10T10:00:00.000Z' }),
      NONE,
    ).notes;

    expect(notes).toContain('the verdicts were taken on different days: 2026-10-08 and 2026-10-10');
  });

  /**
   * The day is taken in the verdict's time zone: late evening in UTC is already the next day in
   * Kyiv.
   */
  it("takes the day in the verdict's time zone, not in UTC", () => {
    const notes = compare(
      quiet({ at: '2026-10-08T22:30:00.000Z' }),
      quiet({ at: '2026-10-09T10:00:00.000Z' }),
      NONE,
    ).notes;

    expect(notes.join()).not.toContain('different days');
  });

  it('names a partial verdict in the notes', () => {
    const notes = compare(quiet({ args: ['--only=N1'] }), quiet(), NONE).notes;

    expect(notes).toContain('the baseline is a partial run');
    expect(notes).not.toContain('the candidate is a partial run');
  });

  /** A recorded scenario conducted once never had two trials: this is a reference, not a gap. */
  it('names a recorded scenario without two judged trials in the notes, not as a gap', () => {
    const wide = verdict({
      N1_free_path: runs(3, () => items(1, 'effect', () => true)),
      N2_deadline_passed: runs(1, () => items(1, 'effect', () => true)),
    });
    const comparison = compare(quiet(), wide, NONE);

    expect(comparison.compared).toEqual(['N1_free_path']);
    expect(comparison.notes).toContain(
      'recorded scenarios not compared: N2 (judged 0 in the baseline, 1 in the candidate)',
    );
    expect(comparison.gaps).toEqual([]);
  });
});

/**
 * A rule that holds on half the data says nothing about the other half: `gate:compare … &&
 * next` must not pass when the candidate was stopped or its blocking scenario was not compared.
 */
describe('comparison gaps', () => {
  const full = (): Verdict =>
    verdict({
      N1_free_path: runs(3, () => items(1, 'effect', () => true)),
      U1_commitment: runs(3, () => items(1, 'recognition', () => true)),
    });
  const stopped = (): Verdict =>
    parseVerdict(
      { ...JSON.parse(JSON.stringify(full())), stopped: 'runs are held: plan_quota' },
      'stopped.json',
    );
  const withoutU1 = (): Verdict =>
    verdict({ N1_free_path: runs(3, () => items(1, 'effect', () => true)) });

  it('returns PASS and zero for the full set with nothing stopped', () => {
    const comparison = compare(full(), full(), NONE);

    expect(comparison.gaps).toEqual([]);
    expect(statusOf(comparison)).toBe('PASS');
    expect(compareExitCode(comparison)).toBe(0);
  });

  it('returns INCOMPLETE and code 2 for a stopped candidate whose rules hold', () => {
    const comparison = compare(full(), stopped(), NONE);

    expect(comparison.ok).toBe(true);
    expect(comparison.gaps).toEqual(['the candidate was stopped: runs are held: plan_quota']);
    expect(statusOf(comparison)).toBe('INCOMPLETE');
    expect(compareExitCode(comparison)).toBe(2);
    expect(renderComparison(comparison)).toContain('INCOMPLETE: the candidate was stopped');
    expect(renderComparison(comparison)).toContain('verdict: INCOMPLETE');
  });

  it('returns INCOMPLETE for a stopped baseline too', () => {
    expect(statusOf(compare(stopped(), full(), NONE))).toBe('INCOMPLETE');
  });

  it('names a blocking scenario of the baseline that the candidate did not cover as a gap, with numbers', () => {
    const comparison = compare(full(), withoutU1(), NONE);

    expect(comparison.gaps).toEqual([
      'blocking scenario not compared: U1 (judged 3 in the baseline, 0 in the candidate)',
    ]);
    expect(statusOf(comparison)).toBe('INCOMPLETE');
    expect(compareExitCode(comparison)).toBe(2);
  });

  it('treats a blocking scenario of the candidate that the baseline lacked as a gap too', () => {
    expect(statusOf(compare(withoutU1(), full(), NONE))).toBe('INCOMPLETE');
  });

  it('treats a scenario with only one judged trial in the candidate as a gap', () => {
    const lone = verdict({
      N1_free_path: runs(3, () => items(1, 'effect', () => true)),
      U1_commitment: runs(1, () => items(1, 'recognition', () => true)),
    });
    const comparison = compare(full(), lone, NONE);

    expect(comparison.gaps).toEqual([
      'blocking scenario not compared: U1 (judged 3 in the baseline, 1 in the candidate)',
    ]);
  });

  /** A failure is no less a failure for there being too little data: FAIL outweighs INCOMPLETE. */
  it('returns FAIL and code 1 when a rule does not hold, even with gaps', () => {
    const worse = verdict({
      N1_free_path: runs(3, (index) => items(1, 'effect', () => index >= 2)),
    });
    const comparison = compare(full(), worse, NONE);

    expect(comparison.gaps).not.toEqual([]);
    expect(statusOf(comparison)).toBe('FAIL');
    expect(compareExitCode(comparison)).toBe(1);
  });

  it('returns INCOMPARABLE and code 2 for incomparable verdicts, with the gaps named as well', () => {
    const comparison = compare(
      full(),
      verdict(
        { N1_free_path: runs(3, () => items(1, 'effect', () => true)) },
        { digest: 'dddddddddddd' },
      ),
      NONE,
    );

    expect(statusOf(comparison)).toBe('INCOMPARABLE');
    expect(compareExitCode(comparison)).toBe(2);
    expect(renderComparison(comparison)).toContain('verdict: INCOMPARABLE');
  });
});

describe('compareArguments', () => {
  it('takes two verdicts, confirmations and targets', () => {
    expect(
      compareArguments([
        'a.json',
        'b.json',
        '--confirm=c.json',
        '--confirm=d.json',
        '--targets=U1,W1',
      ]),
    ).toEqual({
      baseline: 'a.json',
      candidate: 'b.json',
      confirmations: ['c.json', 'd.json'],
      targets: ['U1', 'W1'],
    });
  });

  it('drops empty target names: “U1,,W1” and an empty --targets= are not targets', () => {
    const targets = (...args: string[]): readonly string[] =>
      compareArguments(['a.json', 'b.json', ...args]).targets;

    expect(targets('--targets=U1,,W1')).toEqual(['U1', 'W1']);
    expect(targets('--targets=')).toEqual([]);
  });

  /**
   * The `gate:compare:` prefix is added by the command that prints the error: the message must
   * not double it.
   */
  it('has no command prefix of its own in invocation errors', () => {
    const message = (args: readonly string[]): string => {
      try {
        compareArguments(args);
      } catch (error) {
        return messageOf(error);
      }

      return '';
    };

    expect(message(['a.json', 'b.json', '--fast'])).toBe('unknown argument --fast');
    expect(message(['a.json'])).toMatch(/^two verdicts are required: /);
  });

  it.each([
    ['no files', [], 'two verdicts are required'],
    ['one file', ['a.json'], 'two verdicts are required'],
    ['three files', ['a.json', 'b.json', 'c.json'], 'two verdicts are required'],
    ['an unknown argument', ['a.json', 'b.json', '--fast'], 'unknown argument --fast'],
  ])('%s is an invocation error', (_, args, message) => {
    expect(() => compareArguments(args)).toThrow(message);
  });
});

describe('renderComparison', () => {
  it('names every rule with a mark and puts the conclusion on the last line', () => {
    const base = verdict({ N1_free_path: runs(3, () => items(1, 'effect', () => true)) });
    const worse = verdict({
      N1_free_path: runs(3, (index) => items(1, 'effect', () => index > 0)),
    });
    const lines = renderComparison(compare(base, worse, NONE))
      .trimEnd()
      .split('\n');

    expect(lines.some((line) => line.startsWith('FAIL  effects'))).toBe(true);
    expect(lines.some((line) => line.startsWith('PASS  efficiency'))).toBe(true);
    expect(lines.at(-1)).toBe('verdict: FAIL');
  });
});
