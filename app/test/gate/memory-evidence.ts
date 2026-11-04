import type { GbrainCall } from '../../src/claude/runner/run-tap';
import { squash } from '../../src/knowledge/anchor-drift';
import type { FactRead, PageRead, TimelineEntry } from '../../src/knowledge/gbrain-pages';

/**
 * What the gate sees of the GBrain memory before a run and after it. The run trace says which
 * write tools ran but not what was written (`GAP-07`). The evidence here is the state of the pages
 * the scenario put there, read from GBrain, and the run's calls with their arguments as the runner
 * reported them.
 */

/** The state of a page: its content, timeline events and facts about it. */
export interface MemoryState {
  /** `null` means there is no page (it could not be read by slug). */
  readonly page: PageRead | null;
  readonly timeline: readonly TimelineEntry[];
  readonly facts: readonly FactRead[];
}

export interface MemoryEvidence {
  /** The slug of a page by its key in the scenario. */
  readonly slugs: Readonly<Record<string, string>>;
  readonly before: Readonly<Record<string, MemoryState>>;
  readonly after: Readonly<Record<string, MemoryState>>;
  /** The GBrain calls of this run in order: name, success and the model's arguments. */
  readonly calls: readonly GbrainCall[];
}

/** The state of the pages before and after a run, without the run's calls: what the gate reads. */
export type MemoryStates = Omit<MemoryEvidence, 'calls'>;

/** The scenario put no pages in GBrain. */
export const NO_MEMORY_STATES: MemoryStates = { slugs: {}, before: {}, after: {} };

/** The scenario put no pages in GBrain, and the run did not call it. */
export const NO_MEMORY: MemoryEvidence = { ...NO_MEMORY_STATES, calls: [] };

const entryKey = (entry: TimelineEntry): string =>
  JSON.stringify([entry.date, entry.summary, entry.source]);

const factKey = (fact: FactRead): string => JSON.stringify([fact.fact, fact.entitySlug]);

/**
 * Returns the rows of `after` that `before` lacks, counting multiplicity. A second identical entry
 * counts as added next to the first, so a repeat of what is already written shows.
 */
function addedRows<T>(before: readonly T[], after: readonly T[], keyOf: (row: T) => string): T[] {
  const left = new Map<string, number>();

  for (const row of before) left.set(keyOf(row), (left.get(keyOf(row)) ?? 0) + 1);

  return after.filter((row) => {
    const count = left.get(keyOf(row)) ?? 0;

    if (count === 0) return true;

    left.set(keyOf(row), count - 1);

    return false;
  });
}

/** Returns the events that were not on the page before the run. */
export function addedTimeline(memory: MemoryEvidence, key: string): TimelineEntry[] {
  return addedRows(memory.before[key]?.timeline ?? [], memory.after[key]?.timeline ?? [], entryKey);
}

/** Returns the facts about the page that did not exist before the run. */
export function addedFacts(memory: MemoryEvidence, key: string): FactRead[] {
  return addedRows(memory.before[key]?.facts ?? [], memory.after[key]?.facts ?? [], factKey);
}

/**
 * Fingerprints everything that distinguishes a page state: content, frontmatter, events and facts
 * (the order of events and facts does not matter).
 */
const fingerprint = (state: MemoryState): string =>
  JSON.stringify([
    state.page?.compiledTruth,
    state.page?.timeline,
    state.page?.frontmatter,
    state.timeline.map(entryKey).sort(),
    state.facts.map(factKey).sort(),
  ]);

/** Checks whether the page is unchanged in content, frontmatter, events and facts. */
export function unchanged(memory: MemoryEvidence, key: string): boolean {
  const before = memory.before[key];
  const after = memory.after[key];

  return before !== undefined && after !== undefined && fingerprint(before) === fingerprint(after);
}

/** Returns the run's calls to these tools, successful or not. */
export function callsTo(memory: MemoryEvidence, ...tools: readonly string[]): GbrainCall[] {
  return memory.calls.filter((call) => tools.includes(call.tool));
}

/** Returns the text of a call argument, or an empty string when there is none or it is not text. */
export function argument(call: GbrainCall, name: string): string {
  const value = call.input[name];

  return typeof value === 'string' ? value : '';
}

const slugKey = (value: string): string => value.trim().replace(/\.md$/i, '').toLowerCase();

/** Checks whether the slug as named is the page's slug, ignoring the `.md` extension and case. */
export const sameSlug = (named: string, slug: string): boolean => slugKey(named) === slugKey(slug);

/**
 * Checks whether a reference (`ref`) names the page by this slug. The model may have appended
 * `.md` or a path.
 */
export const refersTo = (ref: string, slug: string): boolean =>
  slugKey(ref).includes(slugKey(slug));

/**
 * Returns the index of the first call to `tool` that succeeded and has the page's slug in the
 * `slug` argument; `-1` means there was no such call.
 */
export function firstCall(memory: MemoryEvidence, tool: string, slug: string): number {
  return memory.calls.findIndex(
    (call) => call.ok && call.tool === tool && sameSlug(argument(call, 'slug'), slug),
  );
}

const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map(squash)
    .filter((line) => line.length > 0);

/**
 * Checks whether the page text is preserved: no line of its compiled truth is gone and the
 * frontmatter is the same. Lines may be added (a fact written to the page goes into its facts
 * section), but replacing the page without the content read earlier leaves a hole, which shows
 * here.
 */
export function bodyKept(memory: MemoryEvidence, key: string): boolean {
  const before = memory.before[key]?.page;
  const after = memory.after[key]?.page;

  if (before === undefined || after === undefined || before === null || after === null) {
    return false;
  }

  const kept = new Set(linesOf(after.compiledTruth));

  return (
    linesOf(before.compiledTruth).every((line) => kept.has(line)) &&
    JSON.stringify(before.frontmatter) === JSON.stringify(after.frontmatter)
  );
}
