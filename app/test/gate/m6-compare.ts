import { z } from 'zod';
import type { Polarity } from './gate-claims';
import { EVERY_SCENARIO_ITEMS } from './m6-items';

/**
 * Comparison of two gate M6 verdicts: the baseline and the candidate. The gate remains a smoke
 * acceptance test, not a comparison tool: three trials distinguish only large differences, and
 * “at least one regression out of fourteen” would turn up on an identical Skill. The comparison is
 * governed by a rule fixed before the candidate is run (`docs/5-plan.md` § “M6 — Universal
 * Detector”). The rule works by pools and direction, not by a conjunction of statuses.
 */

const observationSchema = z.object({
  item: z.string(),
  kind: z.enum(['perimeter', 'effect', 'recognition']),
  polarity: z.enum(['positive', 'negative']).optional(),
  held: z.number(),
  of: z.number(),
  ok: z.boolean(),
});

const efficiencySchema = z.object({
  runs: z.number(),
  failedRuns: z.number(),
  meanDurationSeconds: z.number().nullable(),
  meanCalls: z.record(z.string(), z.number()),
  runsWithRejection: z.number(),
});

const scenarioSchema = z.object({
  tier: z.enum(['blocking', 'recorded']),
  purpose: z.enum(['acceptance', 'adoption']),
  trials: z.object({ requested: z.number(), judged: z.number() }),
  observations: z.array(observationSchema),
  efficiency: efficiencySchema,
  runs: z.array(
    z.object({
      attempts: z.array(
        z.object({ artifacts: z.array(z.object({ reason: z.string().nullable() })) }),
      ),
    }),
  ),
});

const verdictSchema = z.object({
  gate: z.enum(['M6', 'M7', 'M8', 'M9']),
  notionQueryAllowance: z.union([z.number(), z.literal('unlimited')]).optional(),
  at: z.string(),
  timeZone: z.string(),
  language: z.string().optional(),
  models: z.array(z.string()),
  skill: z.string().nullable(),
  schema: z.string(),
  digest: z.string(),
  partial: z.boolean(),
  stopped: z.string().nullable(),
  scenarios: z.record(z.string(), scenarioSchema),
});

export type Verdict = z.infer<typeof verdictSchema>;
type Scenario = z.infer<typeof scenarioSchema>;
type Observation = z.infer<typeof observationSchema>;

/**
 * Parses the verdict of a scenario suite's gate from its JSON. A shape the comparison cannot parse
 * is an error, not a silently empty verdict.
 */
export function parseVerdict(json: unknown, name: string): Verdict {
  const parsed = verdictSchema.safeParse(json);

  if (!parsed.success) {
    throw new Error(
      `${name} is not a verdict of a scenario gate: ${z.prettifyError(parsed.error)}`,
    );
  }

  return parsed.data;
}

/**
 * Computes the Wilson interval of a proportion, which is more honest than the normal approximation
 * on small samples.
 */
function wilson(held: number, of: number): { readonly low: number; readonly high: number } {
  if (of === 0) return { low: 0, high: 1 };

  const z = 1.96;
  const p = held / of;
  const denominator = 1 + (z * z) / of;
  const centre = p + (z * z) / (2 * of);
  const margin = z * Math.sqrt((p * (1 - p)) / of + (z * z) / (4 * of * of));

  return { low: (centre - margin) / denominator, high: (centre + margin) / denominator };
}

/**
 * Computes the Newcombe interval for the difference of two proportions (hybrid, on Wilson
 * intervals).
 */
function newcombe(base: Tally, next: Tally): { readonly low: number; readonly high: number } {
  const p1 = rateOf(base.held, base.of);
  const p2 = rateOf(next.held, next.of);
  const one = wilson(base.held, base.of);
  const two = wilson(next.held, next.of);
  const difference = p2 - p1;

  return {
    low: difference - Math.sqrt((p2 - two.low) ** 2 + (one.high - p1) ** 2),
    high: difference + Math.sqrt((two.high - p2) ** 2 + (p1 - one.low) ** 2),
  };
}

/** How many times an observation held among the judged attempts where it was present. */
interface Tally {
  readonly held: number;
  readonly of: number;
}

const NOTHING: Tally = { held: 0, of: 0 };

/**
 * What is not in a verdict was not violated, so an observation missing from the baseline means zero
 * violations.
 */
const tallyOf = (observation: Observation | undefined): Tally =>
  observation === undefined ? NOTHING : { held: observation.held, of: observation.of };

const total = (tallies: readonly Tally[]): Tally =>
  tallies.reduce<Tally>(
    (sum, tally) => ({ held: sum.held + tally.held, of: sum.of + tally.of }),
    NOTHING,
  );

const rateOf = (part: number, of: number): number => (of === 0 ? 0 : part / of);

const violationsOf = (tally: Tally): number => tally.of - tally.held;

const violationRate = (tally: Tally): number => rateOf(violationsOf(tally), tally.of);

const heldShare = (tally: Tally): number => rateOf(tally.held, tally.of);

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const round = (value: number): number => Math.round(value * 1000) / 1000;

const ratio = (tally: Tally): string => `${violationsOf(tally)}/${tally.of}`;

/** One comparison rule: whether it holds, and what was seen. */
interface Rule {
  readonly rule: string;
  readonly ok: boolean;
  readonly detail: unknown;
}

/**
 * A verdict from a repeat of a scenario that confirms or refutes a suspicion; `name` is the file
 * name, used in messages.
 */
interface Confirmation {
  readonly name: string;
  readonly verdict: Verdict;
}

/**
 * The result of a comparison. `comparable` says whether there is anything to compare: a different
 * gate or schema makes the verdicts incomparable. `ok` means the rules hold on what was compared;
 * `gaps` is what the comparison did not cover (a stopped verdict, a blocking scenario without two
 * judged trials in both). A rule that holds on half the data says nothing about the other half.
 */
interface Comparison {
  readonly comparable: { readonly ok: boolean; readonly reasons: readonly string[] };
  /** The scenarios that were compared: with enough judged trials in both verdicts. */
  readonly compared: readonly string[];
  readonly gaps: readonly string[];
  readonly notes: readonly string[];
  readonly rules: readonly Rule[];
  readonly ok: boolean;
}

/** What defines the comparison beyond the two verdicts. */
interface CompareOptions {
  /** The scenarios whose observations the Skill was meant to change: `U1`, `W1`… */
  readonly targets: readonly string[];
  /** Repeats of the candidate's scenarios at N ≥ 5, which confirm or refute a suspicion. */
  readonly confirmations: readonly Confirmation[];
}

/** How many judged trials a scenario must have in both verdicts to be compared. */
const MIN_JUDGED = 2;

/** A repeat confirms a suspicion only at this many trials and with this many violations. */
const CONFIRMING_TRIALS = 5;
const CONFIRMING_VIOLATIONS = 2;

/**
 * A clear collapse of recognition, with no match at all over this many trials, confirms the
 * suspicion even without a repeat.
 */
const CLEAR_COLLAPSE_TRIALS = 3;

/** How far below the baseline the candidate's mean recognition share may be. */
const RECOGNITION_TOLERANCE = 0.1;

/** How far above the baseline the candidate's duration and calls may be. */
const EFFICIENCY_TOLERANCE = 1.15;

/**
 * The share of runs with a rejected result and the share of failed runs: how many points above the
 * baseline are still tolerated.
 */
const REJECTION_TOLERANCE = 0.05;
const FAILURE_TOLERANCE = 0.1;

/** How many runs that hit the turn ceiling the candidate may have above the baseline. */
const TURN_LIMIT_TOLERANCE = 1;

const shortOf = (id: string): string => id.split('_')[0] ?? id;

const judgedIn = (verdict: Verdict, id: string): number =>
  verdict.scenarios[id]?.trials.judged ?? 0;

function scenarioOf(verdict: Verdict, id: string): Scenario {
  const scenario = verdict.scenarios[id];

  if (scenario === undefined) throw new Error(`the verdict has no scenario ${id}`);

  return scenario;
}

function observationOf(scenario: Scenario | undefined, item: string): Observation | undefined {
  return scenario?.observations.find((candidate) => candidate.item === item);
}

/** A pair of verdicts and the scenarios there is something to compare them on. */
interface Pair {
  readonly base: Verdict;
  readonly next: Verdict;
  readonly ids: readonly string[];
}

/**
 * Returns the scenarios with at least `MIN_JUDGED` judged trials in both verdicts, because fewer
 * trials show no share.
 */
function comparedIds(base: Verdict, next: Verdict): string[] {
  return Object.keys(next.scenarios).filter(
    (id) => judgedIn(base, id) >= MIN_JUDGED && judgedIn(next, id) >= MIN_JUDGED,
  );
}

/**
 * Lists what differs in the thing measured: the gate, the result schema, the model, the time zone
 * that sets “tomorrow”, and the App language, on which packet lengths depend.
 */
function environmentDifferences(base: Verdict, next: Verdict): string[] {
  const models = (verdict: Verdict): string => [...verdict.models].sort().join(', ');

  const allowance = (verdict: Verdict): string =>
    String(verdict.notionQueryAllowance ?? 'unrecorded');
  const language = (verdict: Verdict): string => verdict.language ?? 'unrecorded';

  return [
    ...(base.gate === next.gate ? [] : [`the gates differ: ${base.gate} and ${next.gate}`]),
    ...(base.digest === next.digest ? [] : [`the gate differs: ${base.digest} and ${next.digest}`]),
    ...(allowance(base) === allowance(next)
      ? []
      : [`the Notion query allowance differs: ${allowance(base)} and ${allowance(next)} an hour`]),
    ...(base.schema === next.schema
      ? []
      : [`the result schema differs: ${base.schema} and ${next.schema}`]),
    ...(models(base) === models(next)
      ? []
      : [`the model differs: ${models(base)} and ${models(next)}`]),
    ...(base.timeZone === next.timeZone
      ? []
      : [`the time zone differs: ${base.timeZone} and ${next.timeZone}`]),
    ...(language(base) === language(next)
      ? []
      : [`the App language differs: ${language(base)} and ${language(next)}`]),
  ];
}

/**
 * Verdicts are comparable only when they measure the same thing: the same gate, the same schema,
 * the same model and the same time zone. Confirming repeats must in addition come from one
 * candidate only (the same Skill), because a repeat of another Skill says nothing about this one.
 * There is nothing to compare on when no scenario has two judged trials in both.
 */
function comparableOf(
  pair: Pair,
  confirmations: readonly Confirmation[],
): Comparison['comparable'] {
  const reasons = [
    ...environmentDifferences(pair.base, pair.next),
    ...(pair.ids.length === 0
      ? ['no scenario has two judged trials in both verdicts: there is nothing to compare']
      : []),
    ...confirmations.flatMap(({ name, verdict }) =>
      [
        ...environmentDifferences(pair.next, verdict),
        ...(verdict.skill === pair.next.skill ? [] : ['the Skill differs from the candidate']),
      ].map((reason) => `the confirmation ${name} is not a repeat of the candidate: ${reason}`),
    ),
  ];

  return { ok: reasons.length === 0, reasons };
}

/**
 * Returns the day in the verdict's time zone, which determines “tomorrow” and the weekday in the
 * person's words.
 */
const dayOf = (verdict: Verdict): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: verdict.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(verdict.at));

/**
 * Formats how many judged trials a scenario has in each verdict; it shows why the scenario was not
 * compared.
 */
const judgedText = (pair: Pair, id: string): string =>
  `${shortOf(id)} (judged ${judgedIn(pair.base, id)} in the baseline, ${judgedIn(pair.next, id)} in the candidate)`;

/**
 * Lists the scenarios that were not compared, with their tier. The tier shows whether the
 * scenario is a gap or only a reference.
 */
function uncomparedOf(pair: Pair, tier: Scenario['tier']): string[] {
  const everyId = [
    ...new Set([...Object.keys(pair.base.scenarios), ...Object.keys(pair.next.scenarios)]),
  ];

  return everyId
    .filter((id) => !pair.ids.includes(id))
    .filter((id) => (pair.next.scenarios[id] ?? pair.base.scenarios[id])?.tier === tier);
}

/**
 * Lists what the comparison did not cover. A stopped verdict did not reach the end, and a blocking
 * scenario without two judged trials in both is not comparable: “no worse” on an incomplete set
 * says nothing about the rest, and `PASS` without this caveat would rest on half the data.
 * Recorded scenarios, which are conducted only once, are not included, because they never had two
 * trials.
 */
function gapsOf(pair: Pair): string[] {
  const sides: [string, Verdict][] = [
    ['baseline', pair.base],
    ['candidate', pair.next],
  ];
  const stopped = sides.flatMap(([name, verdict]) =>
    verdict.stopped === null ? [] : [`the ${name} was stopped: ${verdict.stopped}`],
  );
  const missing = uncomparedOf(pair, 'blocking').map(
    (id) => `blocking scenario not compared: ${judgedText(pair, id)}`,
  );

  return [...stopped, ...missing];
}

/** Lists what is worth knowing when reading the comparison, but does not block it. */
function notesOf(pair: Pair): string[] {
  const { base, next } = pair;
  const recorded = uncomparedOf(pair, 'recorded').map((id) => judgedText(pair, id));
  const notes: string[] = [];

  if (dayOf(base) !== dayOf(next)) {
    notes.push(`the verdicts were taken on different days: ${dayOf(base)} and ${dayOf(next)}`);
  }

  if (base.skill === next.skill) notes.push('the Skill is the same in both verdicts');
  if (base.partial) notes.push('the baseline is a partial run');
  if (next.partial) notes.push('the candidate is a partial run');
  if (recorded.length > 0) notes.push(`recorded scenarios not compared: ${recorded.join('; ')}`);

  return notes;
}

/** The decision on a suspicion: confirmed, refuted by a repeat, or waiting for a repeat. */
type Decision = 'confirmed' | 'refuted' | 'unconfirmed';

/**
 * Finds the repeats of the same observation in the confirmations, matching on the scenario's short
 * name (`U1`) and the item text.
 */
function repeatsOf(
  confirmations: readonly Confirmation[],
  scenario: string,
  item: string,
): Tally[] {
  return confirmations.flatMap(({ verdict }) =>
    Object.entries(verdict.scenarios)
      .filter(([id]) => shortOf(id) === shortOf(scenario))
      .flatMap(([, entry]) => {
        const seen = observationOf(entry, item);

        return seen === undefined ? [] : [tallyOf(seen)];
      }),
  );
}

/** A repeat decides only at N ≥ 5; several repeats of one item are combined. */
function decisiveOf(repeats: readonly Tally[]): Tally | null {
  const decisive = repeats.filter((tally) => tally.of >= CONFIRMING_TRIALS);

  return decisive.length === 0 ? null : total(decisive);
}

/**
 * Decides a suspected effect regression, in which the candidate violates more often than the
 * baseline. A repeat at N ≥ 5 decides by itself: the suspicion is confirmed with at least two
 * violations and a share above the baseline's, otherwise refuted (the sample that raised the
 * suspicion is biased, so it is not combined with the repeat). Without a repeat, the suspicion is
 * confirmed when the baseline is clean and the candidate violated twice or more, and the rest
 * waits for a repeat and does not pass.
 */
function effectDecision(base: Tally, next: Tally, repeat: Tally | null): Decision {
  if (repeat !== null) {
    return violationsOf(repeat) >= CONFIRMING_VIOLATIONS &&
      violationRate(repeat) > violationRate(base)
      ? 'confirmed'
      : 'refuted';
  }

  return violationsOf(base) === 0 && violationsOf(next) >= CONFIRMING_VIOLATIONS
    ? 'confirmed'
    : 'unconfirmed';
}

/**
 * A repeat supports recognition when the item holds in two thirds of the trials; without a
 * repeat, only a clean collapse decides.
 */
function recognitionDecision(next: Tally, repeat: Tally | null): Decision {
  if (repeat !== null) {
    return repeat.held >= Math.ceil((2 * repeat.of) / 3) ? 'refuted' : 'confirmed';
  }

  return next.held === 0 && next.of >= CLEAR_COLLAPSE_TRIALS ? 'confirmed' : 'unconfirmed';
}

/**
 * An observation where the candidate violates more often than the baseline: what the baseline
 * lacked was not violated.
 */
interface Suspect {
  readonly scenario: string;
  readonly item: string;
  readonly baseline: Tally;
  readonly candidate: Tally;
}

function suspectsOf(pair: Pair, ids: readonly string[], kind: 'effect' | 'perimeter'): Suspect[] {
  return ids.flatMap((id) =>
    scenarioOf(pair.next, id)
      .observations.filter((observation) => observation.kind === kind)
      .flatMap((observation) => {
        const baseline = tallyOf(observationOf(pair.base.scenarios[id], observation.item));
        const candidate = tallyOf(observation);

        return violationRate(candidate) > violationRate(baseline)
          ? [{ scenario: id, item: observation.item, baseline, candidate }]
          : [];
      }),
  );
}

function effectsRule(pair: Pair, options: CompareOptions): Rule {
  const found = suspectsOf(pair, pair.ids, 'effect').map((suspect) => {
    const repeat = decisiveOf(repeatsOf(options.confirmations, suspect.scenario, suspect.item));

    return {
      scenario: shortOf(suspect.scenario),
      item: suspect.item,
      baseline: ratio(suspect.baseline),
      candidate: ratio(suspect.candidate),
      repeats: repeat === null ? null : ratio(repeat),
      confirmation: effectDecision(suspect.baseline, suspect.candidate, repeat),
    };
  });

  return {
    rule: 'effects: no more violations than the baseline',
    ok: found.every((suspect) => suspect.confirmation === 'refuted'),
    detail: found,
  };
}

/**
 * The perimeter is guaranteed by the App and the toolset, not the model, so a violation there is an
 * App regression, not Skill noise, and a repeat does not refute it. The perimeter is read across
 * all the candidate's scenarios that have judged trials, even when the baseline had none.
 */
function perimeterRule(pair: Pair): Rule {
  const ids = Object.keys(pair.next.scenarios).filter((id) => judgedIn(pair.next, id) >= 1);
  const found = suspectsOf(pair, ids, 'perimeter').map((suspect) => ({
    scenario: shortOf(suspect.scenario),
    item: suspect.item,
    baseline: ratio(suspect.baseline),
    candidate: ratio(suspect.candidate),
  }));

  return {
    rule: 'perimeter: no violation the baseline did not have (an App regression, not Skill noise)',
    ok: found.length === 0,
    detail: found,
  };
}

/**
 * Checks for a separate recognition that held in the baseline and does not hold in the candidate.
 * The pool can stay level when one recognition fell and another rose, so each item is read
 * separately.
 */
function itemsRule(pair: Pair, options: CompareOptions): Rule {
  const found = pair.ids.flatMap((id) =>
    scenarioOf(pair.next, id)
      .observations.filter((observation) => observation.kind === 'recognition' && !observation.ok)
      .flatMap((observation) => {
        const before = observationOf(pair.base.scenarios[id], observation.item);

        if (before === undefined || !before.ok) return [];

        const repeat = decisiveOf(repeatsOf(options.confirmations, id, observation.item));

        return [
          {
            scenario: shortOf(id),
            item: observation.item,
            baseline: `${before.held}/${before.of}`,
            candidate: `${observation.held}/${observation.of}`,
            repeats: repeat === null ? null : `${repeat.held}/${repeat.of}`,
            confirmation: recognitionDecision(tallyOf(observation), repeat),
          },
        ];
      }),
  );

  return {
    rule: 'recognition per item: none that held in the baseline fails in the candidate',
    ok: found.every((suspect) => suspect.confirmation === 'refuted'),
    detail: found,
  };
}

/**
 * Recognition in both verdicts: the items present in both, without the items shared by every
 * scenario.
 */
interface Row {
  readonly scenario: string;
  readonly item: string;
  readonly baseline: Tally;
  readonly candidate: Tally;
}

function rowsOf(pair: Pair, pick: (id: string) => boolean, polarity: Polarity | null): Row[] {
  return pair.ids.filter(pick).flatMap((id) =>
    scenarioOf(pair.next, id)
      .observations.filter(
        (observation) =>
          observation.kind === 'recognition' &&
          (polarity === null || observation.polarity === polarity) &&
          !EVERY_SCENARIO_ITEMS.includes(observation.item),
      )
      .flatMap((observation) => {
        const before = observationOf(pair.base.scenarios[id], observation.item);

        return before === undefined
          ? []
          : [
              {
                scenario: shortOf(id),
                item: observation.item,
                baseline: tallyOf(before),
                candidate: tallyOf(observation),
              },
            ];
      }),
  );
}

/** Combines the items of one scenario into one share, so a scenario weighs as much as any other. */
function byScenario(
  rows: readonly Row[],
): { scenario: string; baseline: Tally; candidate: Tally }[] {
  return [...new Set(rows.map((row) => row.scenario))].map((scenario) => {
    const own = rows.filter((row) => row.scenario === scenario);

    return {
      scenario,
      baseline: total(own.map((row) => row.baseline)),
      candidate: total(own.map((row) => row.candidate)),
    };
  });
}

const fraction = (tally: Tally): string => `${tally.held}/${tally.of}`;

/**
 * Judges recognition by polarity, separately, so that a quiet version that stopped raising labels
 * is not masked by the success of the negative ones. A scenario weighs the same as any other,
 * however many items it has, and the items shared by every scenario do not go into the pool. The
 * decision is the share averaged over scenarios; the pool of items with intervals is left for
 * reading.
 */
function recognitionRule(pair: Pair, polarity: Polarity): Rule {
  const rows = rowsOf(pair, (id) => scenarioOf(pair.next, id).purpose === 'acceptance', polarity);
  const scenarios = byScenario(rows);
  const before = mean(scenarios.map((row) => heldShare(row.baseline)));
  const after = mean(scenarios.map((row) => heldShare(row.candidate)));
  const baseline = total(rows.map((row) => row.baseline));
  const candidate = total(rows.map((row) => row.candidate));
  const low = wilson(baseline.held, baseline.of);
  const high = wilson(candidate.held, candidate.of);
  const difference = newcombe(baseline, candidate);

  return {
    rule: `recognition (${polarity}): the mean share over scenarios is not lower than the baseline by more than ten points`,
    ok: round(after - before) >= -RECOGNITION_TOLERANCE,
    detail: {
      scenarios: scenarios.map((row) => ({
        scenario: row.scenario,
        baseline: fraction(row.baseline),
        candidate: fraction(row.candidate),
      })),
      mean: { baseline: round(before), candidate: round(after), difference: round(after - before) },
      pooled: {
        baseline: {
          ...baseline,
          share: round(heldShare(baseline)),
          wilson: [round(low.low), round(low.high)],
        },
        candidate: {
          ...candidate,
          share: round(heldShare(candidate)),
          wilson: [round(high.low), round(high.high)],
        },
        newcombe: [round(difference.low), round(difference.high)],
      },
    },
  };
}

/**
 * Checks that the target observations of the named scenarios are, as a pool, not lower than the
 * baseline, and are better on at least half of the items that could still be improved (baseline
 * below a hundred percent). An individual item that fell is caught by the per-item rule; this line
 * says whether the Skill achieved what it was changed for. A named scenario that was not compared
 * makes the rule fail instead of agreeing silently.
 */
function targetsRule(pair: Pair, targets: readonly string[]): Rule {
  const missing = targets.filter((target) => !pair.ids.some((id) => shortOf(id) === target));
  const rows = rowsOf(pair, (id) => targets.includes(shortOf(id)), null);
  const before = heldShare(total(rows.map((row) => row.baseline)));
  const after = heldShare(total(rows.map((row) => row.candidate)));
  const improvable = rows.filter((row) => heldShare(row.baseline) < 1);
  const better = improvable.filter((row) => heldShare(row.candidate) > heldShare(row.baseline));

  return {
    rule: 'targets: the pooled share is not lower than the baseline and higher on at least half of the items that could improve',
    ok:
      missing.length === 0 &&
      rows.length > 0 &&
      round(after - before) >= 0 &&
      better.length * 2 >= improvable.length,
    detail: {
      missing,
      pooled: { baseline: round(before), candidate: round(after) },
      improvable: improvable.length,
      better: better.length,
      items: rows.map((row) => ({
        scenario: row.scenario,
        item: row.item,
        baseline: fraction(row.baseline),
        candidate: fraction(row.candidate),
      })),
    },
  };
}

/** Counts the runs that ended at the turn ceiling, going by the reason in the artifacts. */
function turnLimitsIn(scenario: Scenario): number {
  return scenario.runs
    .flatMap((run) => run.attempts.flatMap((attempt) => attempt.artifacts))
    .filter((artifact) => (artifact.reason ?? '').includes('max_turns')).length;
}

interface Pooled {
  readonly seconds: number | null;
  readonly calls: number;
  readonly rejectionShare: number;
  readonly failureShare: number;
  readonly turnLimits: number;
}

/**
 * Computes efficiency as a pool over the shared scenarios: the mean over completed runs, weighted
 * by their number.
 */
function pooledEfficiency(verdict: Verdict, ids: readonly string[]): Pooled {
  let completed = 0;
  let seconds = 0;
  let timed = 0;
  let calls = 0;
  let runs = 0;
  let failed = 0;
  let rejected = 0;
  let limits = 0;

  for (const id of ids) {
    const scenario = scenarioOf(verdict, id);
    const { efficiency } = scenario;
    const done = efficiency.runs - efficiency.failedRuns;

    completed += done;
    calls += done * Object.values(efficiency.meanCalls).reduce((sum, value) => sum + value, 0);

    if (efficiency.meanDurationSeconds !== null) {
      seconds += done * efficiency.meanDurationSeconds;
      timed += done;
    }

    runs += efficiency.runs;
    failed += efficiency.failedRuns;
    rejected += efficiency.runsWithRejection;
    limits += turnLimitsIn(scenario);
  }

  return {
    seconds: timed === 0 ? null : seconds / timed,
    calls: rateOf(calls, completed),
    rejectionShare: rateOf(rejected, runs),
    failureShare: rateOf(failed, runs),
    turnLimits: limits,
  };
}

/**
 * Checks whether `after` exceeds the tolerance above `before`. The ratio is rounded to thousandths,
 * because `100 * 1.15` in binary floating point is `114.99999999999999`: exactly fifteen percent
 * (“no more than”) must pass, not fail on the rounding error. From a zero baseline, any positive
 * value is an excess.
 */
const exceeds = (after: number, before: number): boolean =>
  before === 0 ? after > 0 : round(after / before) > EFFICIENCY_TOLERANCE;

/**
 * Checks efficiency: duration and calls no more than fifteen percent above the baseline; the share
 * of runs with a rejected result no more than five points above, the share of failed runs ten, and
 * runs that hit the turn ceiling no more than one above the baseline. A single sampling difference
 * is not a verdict, because stricter thresholds would catch the noise of three trials.
 */
function efficiencyRule(pair: Pair): Rule {
  const before = pooledEfficiency(pair.base, pair.ids);
  const after = pooledEfficiency(pair.next, pair.ids);
  const slower =
    before.seconds !== null && after.seconds !== null && exceeds(after.seconds, before.seconds);
  const heavier = exceeds(after.calls, before.calls);
  const rejects = round(after.rejectionShare - before.rejectionShare) > REJECTION_TOLERANCE;
  const fails = round(after.failureShare - before.failureShare) > FAILURE_TOLERANCE;
  const limited = after.turnLimits > before.turnLimits + TURN_LIMIT_TOLERANCE;

  return {
    rule: 'efficiency: within fifteen percent in duration and calls, and no more rejections, failed runs or turn limits than the tolerance allows',
    ok: !slower && !heavier && !rejects && !fails && !limited,
    detail: {
      meanDurationSeconds: [before.seconds, after.seconds].map((value) =>
        value === null ? null : round(value),
      ),
      meanCalls: [round(before.calls), round(after.calls)],
      rejectionShare: [round(before.rejectionShare), round(after.rejectionShare)],
      failureShare: [round(before.failureShare), round(after.failureShare)],
      turnLimits: [before.turnLimits, after.turnLimits],
    },
  };
}

/**
 * Reports scenarios meant to grow, not merely to avoid falling: their gain is for reference, not a
 * verdict.
 */
function adoptionRule(pair: Pair): Rule {
  const rows = Object.keys(pair.next.scenarios)
    .filter((id) => scenarioOf(pair.next, id).purpose === 'adoption' && id in pair.base.scenarios)
    .flatMap((id) =>
      scenarioOf(pair.next, id).observations.flatMap((observation) => {
        const was = observationOf(pair.base.scenarios[id], observation.item);

        return was === undefined
          ? []
          : [
              {
                scenario: shortOf(id),
                item: observation.item,
                before: `${was.held}/${was.of}`,
                after: `${observation.held}/${observation.of}`,
              },
            ];
      }),
    );

  return { rule: 'adoption (for reading, not a verdict)', ok: true, detail: rows };
}

/**
 * Compares the verdicts by the rule: effects no worse (with a repeat at five), the perimeter
 * without new violations, no recognition has fallen, recognition in two pools not lower by ten
 * points, target observations no worse and better where they can be, efficiency within the
 * tolerance. A person reads the texts of the runs, and the rule does not replace that.
 */
export function compare(base: Verdict, next: Verdict, options: CompareOptions): Comparison {
  const pair: Pair = { base, next, ids: comparedIds(base, next) };
  const comparable = comparableOf(pair, options.confirmations);
  const notes = notesOf(pair);
  const gaps = gapsOf(pair);

  if (!comparable.ok) {
    return { comparable, compared: pair.ids, gaps, notes, rules: [], ok: false };
  }

  const rules: Rule[] = [
    effectsRule(pair, options),
    perimeterRule(pair),
    itemsRule(pair, options),
    recognitionRule(pair, 'positive'),
    recognitionRule(pair, 'negative'),
    ...(options.targets.length === 0 ? [] : [targetsRule(pair, options.targets)]),
    efficiencyRule(pair),
    adoptionRule(pair),
  ];

  return {
    comparable,
    compared: pair.ids,
    gaps,
    notes,
    rules,
    ok: rules.every((rule) => rule.ok),
  };
}

/**
 * Returns the conclusion of the comparison. `PASS`: the rules hold and covered the whole set;
 * `FAIL`: a rule does not hold (it outweighs the gaps, because a failure is no less a failure for
 * there being too little data); `INCOMPLETE`: the rules hold on what was compared, but it is not
 * enough for a “no worse” verdict; `INCOMPARABLE`: the verdicts do not measure the same thing.
 */
export function statusOf(comparison: Comparison): 'PASS' | 'FAIL' | 'INCOMPLETE' | 'INCOMPARABLE' {
  if (!comparison.comparable.ok) return 'INCOMPARABLE';
  if (!comparison.ok) return 'FAIL';

  return comparison.gaps.length === 0 ? 'PASS' : 'INCOMPLETE';
}

/**
 * Returns the exit code of the command: 0 means the rules hold on the full set, 1 that they do not,
 * 2 incomparable or incomplete verdicts (an invocation with an error is also 2), so `gate:compare …
 * && next` does not go on to `next` on half the data.
 */
export function compareExitCode(comparison: Comparison): number {
  const status = statusOf(comparison);

  if (status === 'PASS') return 0;

  return status === 'FAIL' ? 1 : 2;
}

/** Command arguments: two verdicts, `--confirm=file` (several) and `--targets=U1,W1`. */
interface CompareArguments {
  readonly baseline: string;
  readonly candidate: string;
  readonly confirmations: readonly string[];
  readonly targets: readonly string[];
}

export function compareArguments(args: readonly string[]): CompareArguments {
  const files = args.filter((arg) => !arg.startsWith('--'));
  const confirmations = args
    .filter((arg) => arg.startsWith('--confirm='))
    .map((arg) => arg.slice('--confirm='.length));
  const targets = args
    .filter((arg) => arg.startsWith('--targets='))
    .flatMap((arg) => arg.slice('--targets='.length).split(','))
    .filter((name) => name.length > 0);
  const unknown = args.filter(
    (arg) => arg.startsWith('--') && !arg.startsWith('--confirm=') && !arg.startsWith('--targets='),
  );
  const [baseline, candidate, ...extra] = files;

  // The `gate:compare:` prefix is added by the command that prints the error, so the message itself
  // does not include it.
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown[0]}`);

  if (baseline === undefined || candidate === undefined || extra.length > 0) {
    throw new Error(
      'two verdicts are required: baseline.json candidate.json [--confirm=file.json] [--targets=U1,W1]',
    );
  }

  return { baseline, candidate, confirmations, targets };
}

/**
 * Renders a report of the comparison to read: the rules that hold, those that do not, and the
 * verdict.
 */
export function renderComparison(comparison: Comparison): string {
  const lines = [
    ...comparison.comparable.reasons.map((reason) => `INCOMPARABLE: ${reason}`),
    ...comparison.gaps.map((gap) => `INCOMPLETE: ${gap}`),
    ...comparison.notes.map((note) => `note: ${note}`),
    `compared: ${comparison.compared.map(shortOf).join(', ') || 'nothing'}`,
    ...comparison.rules.flatMap((rule) => [
      `${rule.ok ? 'PASS' : 'FAIL'}  ${rule.rule}`,
      `      ${JSON.stringify(rule.detail)}`,
    ]),
    `verdict: ${statusOf(comparison)}`,
  ];

  return `${lines.join('\n')}\n`;
}
