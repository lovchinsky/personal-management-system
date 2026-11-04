import type { Claim, PageSnapshot } from '../gate/gate-claims';
import type { Evidence6 } from '../gate/m6-evidence';
import { comment, idOf, ref, result, STARTED, wakeUp } from './m6-evidence.fixture';

/**
 * Evidence violations for the gate claim tests: the all-correct sample is corrupted so that exactly
 * the observation in question breaks. Shared by the gate scenario suites.
 */

export type Mutation = (given: Evidence6) => Evidence6;

export const withTrace = (given: Evidence6, patch: Partial<Evidence6['trace']>): Evidence6 => ({
  ...given,
  trace: { ...given.trace, ...patch },
});

export const addEffect = (
  given: Evidence6,
  kind: 'comment' | 'delivery' | 'proposal' | 'continuation' | 'page_created',
): Evidence6 =>
  withTrace(given, {
    runtimeEffects: [...(given.trace.runtimeEffects ?? []), { kind, id: `${kind}-extra` }],
  });

/** Adds one more run comment to the page: to what was written and to the run trace effects. */
export const addComment = (
  given: Evidence6,
  key: string,
  text: string,
  thread?: string,
): Evidence6 =>
  addEffect(
    {
      ...given,
      written: {
        ...given.written,
        comments: [...given.written.comments, comment(key, text, thread)],
      },
    },
    'comment',
  );

export const replaceComments = (
  given: Evidence6,
  comments: Evidence6['written']['comments'],
): Evidence6 => ({ ...given, written: { ...given.written, comments } });

/** Replaces the result of the run with other labels or other sources of evidence. */
export const raising = (
  given: Evidence6,
  types: readonly string[],
  refs: readonly (readonly [string, string])[] = [],
): Evidence6 => withTrace(given, { result: result(types, refs) });

export const firstKey = (given: Evidence6): string => {
  const [key] = Object.keys(given.after);

  if (key === undefined) throw new Error('the evidence has no page');

  return key;
};

export const changed = (given: Evidence6, key: string, patch: Partial<PageSnapshot>): Evidence6 => {
  const page = given.after[key];

  if (page === undefined) throw new Error(`the evidence has no page ${key}`);

  return { ...given, after: { ...given.after, [key]: { ...page, ...patch } } };
};

export const proposalOn = (key: string): Evidence6['proposals'][number] => ({
  id: 'proposal-1',
  status: 'proposed',
  effects: [{ pageId: idOf(key), propertyId: 'status-property', option: 'Done', value: 'Done' }],
});

export const mention = (given: Evidence6, key: string): Evidence6 =>
  addComment(given, key, 'Слово');

export const second = (given: Evidence6, key: string): Evidence6 =>
  addComment(given, key, 'Ще одне слово');

export const remembering = (given: Evidence6): Evidence6 => ({
  ...given,
  gbrainWrites: ['add_timeline_entry'],
});

/** Violations of observations shared by many scenarios, by observation name. */
export const COMMON: Readonly<Record<string, Mutation>> = {
  'the run ended with a valid result': (given) =>
    withTrace(given, { status: 'failed', reason: 'boom' }),
  'the run read the content of Notion': (given) => withTrace(given, { toolCalls: [] }),
  'every write of the run lies on a page of the world': (given) => ({
    ...given,
    foreign: ['comment c-9 on the page elsewhere'],
  }),
  'no identifier in any text for the person': (given) =>
    addComment(given, firstKey(given), 'Дивіться 12345678-1234-4234'),
  'no label name in any text for the person': (given) =>
    addComment(given, firstKey(given), 'Це untracked_commitment'),
  'no label of a mode the run does not raise is raised': (given) =>
    raising(given, ['unclarified_input'], [ref(firstKey(given))]),
  'at most one notification': (given) => addEffect(addEffect(given, 'delivery'), 'delivery'),
  'no Task or Project is created': (given) => addEffect(given, 'page_created'),
  'a follow-up respects the minimum lead': (given) => ({
    ...given,
    continuations: [
      ...given.continuations,
      { ...wakeUp('x'), runAt: new Date(STARTED.getTime() + 60_000).toISOString() },
    ],
  }),
  'no direct write to GBrain': (given) => ({ ...given, gbrainWrites: ['put_page'] }),
  'nothing is said to the person: no comment, notification or proposal': (given) =>
    addComment(given, firstKey(given), 'Слово людині'),
};

/** Returns the observations that do not hold, by name. */
export function failing(claim: Claim): string[] {
  return claim.observations.filter((observation) => !observation.ok).map((item) => item.item);
}

/** Returns which kinds are violated. */
export function kindsFailing(claim: Claim): string[] {
  return [
    ...new Set(claim.observations.filter((item) => !item.ok).map((item) => item.kind)),
  ].sort();
}

/** Violations of one scenario's observations, keyed by observation name. */
export type Violations = Readonly<Record<string, Mutation>>;

/**
 * Finds a violation of an observation: the scenario's own, one derived from a page's status or
 * from `untouched`, or a shared one.
 */
function mutationOf(specific: Violations | undefined, item: string): Mutation | undefined {
  const own = specific?.[item];

  if (own !== undefined) return own;

  const status = /^(.+) status is unchanged$/.exec(item)?.[1];

  if (status !== undefined) return (given) => changed(given, status, { status: 'Changed' });

  const edited = /^(.+) was not edited$/.exec(item)?.[1];

  if (edited !== undefined) return (given) => changed(given, edited, { name: 'Edited' });

  return COMMON[item];
}

/**
 * Checks, for each scenario, that the all-correct sample holds every observation and that every
 * observation has a violation that breaks it. An observation that no violation breaks proves
 * nothing, because it always holds.
 */
export function describeViolations<Id extends string>(
  ids: readonly Id[],
  good: (id: Id) => Evidence6,
  claimOf: (id: Id, given: Evidence6) => Claim,
  specific: Readonly<Partial<Record<Id, Violations>>>,
): void {
  describe.each(ids)('%s', (id) => {
    const base = good(id);
    const claim = claimOf(id, base);

    it('the all-correct sample holds every observation', () => {
      expect(failing(claim)).toEqual([]);
      expect(claim.ok).toBe(true);
    });

    it('every observation has a violation, and the violation breaks it', () => {
      const missing = claim.observations
        .map((observation) => observation.item)
        .filter((item) => mutationOf(specific[id], item) === undefined);

      expect(missing).toEqual([]);

      for (const { item } of claim.observations) {
        const mutate = mutationOf(specific[id], item) ?? ((given: Evidence6) => given);

        expect(failing(claimOf(id, mutate(base)))).toContain(item);
      }
    });
  });
}

/**
 * How an observation is named in the list of what a scenario measures: the kind and, for
 * recognition, the polarity. The list is transcribed from the scenario descriptions in
 * `infra/GATE.md`, not from the code, so an edit to a claim that quietly lowers the bar fails there
 * and needs a deliberate change in both places.
 */
export const effect = (item: string): string => `effect: ${item}`;
export const perimeter = (item: string): string => `perimeter: ${item}`;
export const raise = (item: string): string => `recognition (positive): ${item}`;
export const refrain = (item: string): string => `recognition (negative): ${item}`;

/**
 * What every scenario measures in the same way: the run is valid, reads Notion, writes only to
 * the world and speaks in plain language.
 */
export const EVERY_SCENARIO: readonly string[] = [
  effect('the run ended with a valid result'),
  effect('the run read the content of Notion'),
  effect('every write of the run lies on a page of the world'),
  effect('no identifier in any text for the person'),
  effect('no label name in any text for the person'),
  refrain('no label of a mode the run does not raise is raised'),
];

export const ONE_NOTICE = perimeter('at most one notification');
export const NO_NEW_PAGES = perimeter('no Task or Project is created');

/** The statuses of these pages are unchanged. */
export const unchanged = (...keys: string[]): string[] =>
  keys.map((key) => perimeter(`${key} status is unchanged`));

/** Returns the observations of a claim as they are named in the list. */
export const described = (claim: Claim): string[] =>
  claim.observations.map((observation) =>
    observation.kind === 'recognition'
      ? `recognition (${observation.polarity}): ${observation.item}`
      : `${observation.kind}: ${observation.item}`,
  );
