import { z } from 'zod';
import { AppliedEffectKind } from '../../src/generated/prisma/enums';
import { TraceView } from '../../src/runs/run-traces';
import { MCP_TOOLSETS } from '../../src/runs/toolsets';
import { PageComment } from './m3-claims';
import { AUTONOMOUS_MIN_LEAD_MS, ContinuationState } from './m4-claims';

/**
 * A page comment with the id Notion assigns to it. The id distinguishes a new comment from an old
 * one with the same text.
 */
export interface SeenComment extends PageComment {
  readonly id: string;
  /** The thread the comment belongs to: it shows that the reply is in this thread and no other. */
  readonly discussionId?: string;
}

/** A page read from Notion: the state in which the run left it and what is written on it. */
export interface PageSnapshot {
  readonly id: string;
  readonly name: string | null;
  /** The status of a Task or Project; `null` for the other types and for an empty one. */
  readonly status: string | null;
  readonly mode: string | null;
  /** The lifecycle of a Behavior System; `null` for the other types and for an empty one. */
  readonly lifecycle?: string | null;
  readonly date: string | null;
  readonly deadline: string | null;
  readonly inTrash: boolean;
  readonly comments: readonly SeenComment[];
  /**
   * The page's database (canonical id): it shows whether a query to another database could have
   * returned the page.
   */
  readonly dataSource?: string | null;
}

/** An effect of a proposal: the page, the property and the value that will be written. */
export interface ProposedEffect {
  readonly pageId: string;
  readonly propertyId: string;
  readonly option: string | null;
  /**
   * The value in words, of any kind: without it a date or relations cannot be read from the
   * verdict.
   */
  readonly value: string;
}

export interface ProposalView {
  readonly id: string;
  readonly status: string;
  readonly effects: readonly ProposedEffect[];
}

/** What the gate saw about one run of a scenario: the run trace and the world before and after. */
export interface Evidence {
  /** The scenario step that collected this evidence. */
  readonly step: string;
  readonly trace: TraceView;
  /** The pages of the world by scenario key, before the run. */
  readonly before: Readonly<Record<string, PageSnapshot>>;
  readonly after: Readonly<Record<string, PageSnapshot>>;
  /** The proposals this run made. */
  readonly proposals: readonly ProposalView[];
  readonly continuations: readonly ContinuationState[];
  /** The names of the GBrain write tools that ran successfully. */
  readonly gbrainWrites: readonly string[];
  /** The integration bot is the author of the system's writes. */
  readonly bot: string;
  /** The canonical id of a Task's status property: proposal effects are read through it. */
  readonly statusProperty: string;
}

/**
 * What an observation proves (`docs/5-plan.md` § “M6 — Universal Detector”):
 *
 * - `perimeter` is what the App or the mode's toolset guarantees (statuses unchanged, no pages
 *   created, the continuation lead). A violation fails the scenario, but it is an App regression,
 *   not a Skill one, so the verdict shows it separately and it does not enter the behavior
 *   comparison;
 * - `effect` is the model's choice, zero tolerance: any attempt that violated it fails the
 *   scenario. Silence where the right answer is silence is an effect too;
 * - `recognition` is measured as a share of judged attempts: a label may waver, an effect may not.
 */
export type Kind = 'perimeter' | 'effect' | 'recognition';

/**
 * What a recognition asserts: the label is raised (`positive`) or not raised (`negative`). The
 * pools are compared separately.
 */
export type Polarity = 'positive' | 'negative';

/**
 * What an observation says regardless of its kind: what was expected, what is actually there, and
 * whether they match.
 */
interface Seen {
  readonly item: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly ok: boolean;
}

/** One observation: M10 counts shares from it; there is no recognition without polarity. */
export type Observation =
  | (Seen & { readonly kind: 'perimeter' | 'effect' })
  | (Seen & { readonly kind: 'recognition'; readonly polarity: Polarity });

/**
 * A scenario's claim: the observations it is made of, and whether all of them hold.
 * `unobserved` lists the steps nobody was there to conduct (a person is needed): nothing
 * contradicts the claim, but it is not proven either.
 */
export interface Claim {
  readonly ok: boolean;
  readonly observations: readonly Observation[];
  readonly unobserved: readonly string[];
}

/**
 * Builds an effect observation, the kind every observation has until the scenario names another.
 */
export function observed(item: string, expected: unknown, actual: unknown): Observation {
  return {
    item,
    expected,
    actual,
    ok: JSON.stringify(expected) === JSON.stringify(actual),
    kind: 'effect',
  };
}

export function holds(item: string, actual: boolean): Observation {
  return observed(item, true, actual);
}

const seen = ({ item, expected, actual, ok }: Observation): Seen => ({
  item,
  expected,
  actual,
  ok,
});

/** Marks the observations as the model's choice, zero tolerance. */
export const effect = (...observations: readonly Observation[]): Observation[] =>
  observations.map((observation): Observation => ({ ...seen(observation), kind: 'effect' }));

/**
 * Marks the observations as what the App or toolset guarantees: a violation is an App regression.
 */
export const perimeter = (...observations: readonly Observation[]): Observation[] =>
  observations.map((observation): Observation => ({ ...seen(observation), kind: 'perimeter' }));

/**
 * Marks the observations to be measured as a share of judged attempts. The polarity says what they
 * assert.
 */
export const recognition = (
  polarity: Polarity,
  ...observations: readonly Observation[]
): Observation[] =>
  observations.map((observation): Observation => ({
    ...seen(observation),
    kind: 'recognition',
    polarity,
  }));

/**
 * Builds a claim from observations or their groups. With no observation at all it asserts nothing:
 * that is a harness fault, not proven silence.
 */
export function claimOf(...parts: readonly (Observation | readonly Observation[])[]): Claim {
  const observations = parts.flat();

  if (observations.length === 0) throw new Error('a claim with no observation proves nothing');

  return {
    ok: observations.every((observation) => observation.ok),
    observations,
    unobserved: [],
  };
}

/** Combines several claims of one scenario into one that holds when all of them hold. */
export function allOf(...claims: readonly Claim[]): Claim {
  const observations = claims.flatMap((claim) => claim.observations);

  if (observations.length === 0) throw new Error('a claim with no observation proves nothing');

  return {
    ok: claims.every((claim) => claim.ok),
    observations,
    unobserved: claims.flatMap((claim) => claim.unobserved),
  };
}

/**
 * Returns an expectation the scenario must name, because an empty one would let anything through.
 */
export function expectation<T>(list: readonly T[], what: string): readonly T[] {
  if (list.length === 0) throw new Error(`the claim expects ${what}, and the scenario gave none`);

  return list;
}

/** The run's outcome as the trace recorded it: the label types and the sources of evidence. */
const resultSchema = z.looseObject({
  outcome: z.string(),
  detections: z.array(
    z.looseObject({
      type: z.string(),
      evidence: z.array(z.looseObject({ server: z.string(), ref: z.string() })),
      uncertainties: z.array(z.string()).optional(),
    }),
  ),
});

type Result = z.infer<typeof resultSchema>;

export function resultOf(evidence: Evidence): Result | null {
  const parsed = resultSchema.safeParse(evidence.trace.result);

  return parsed.success ? parsed.data : null;
}

/** Returns what the run named as unresolved in its labels: the `uncertainties` field of each. */
export function uncertaintiesOf(evidence: Evidence): string[] {
  return (resultOf(evidence)?.detections ?? []).flatMap(
    (detection) => detection.uncertainties ?? [],
  );
}

export function detectionTypes(evidence: Evidence): string[] {
  return (resultOf(evidence)?.detections ?? []).map((detection) => detection.type);
}

export function kinds(evidence: Evidence): AppliedEffectKind[] {
  return (evidence.trace.runtimeEffects ?? []).map((effect) => effect.kind);
}

/** Readers of Notion content: the tools a run uses to look at pages, not at catalogs or people. */
const NOTION_CONTENT_READERS: ReadonlySet<string> = new Set(
  ['fetch', 'comments_read', 'query'].flatMap(
    (capability) => MCP_TOOLSETS.notion.capabilities[capability] ?? [],
  ),
);

function notionReads(evidence: Evidence): number {
  return (evidence.trace.toolCalls ?? []).filter(
    (call) => call.server === 'notion' && call.ok && NOTION_CONTENT_READERS.has(call.tool),
  ).length;
}

/**
 * Returns the positive base of every claim: the run ended with a valid result and looked at the
 * Notion content. It is a necessary condition, not a sufficient one, because the trace does not
 * say what was read (`GAP-07`). Without the base, “nothing was done” would also be proven by a run
 * that read nothing.
 */
export function engaged(evidence: Evidence): Observation[] {
  return [
    observed(
      'the run ended with a valid result',
      'completed',
      evidence.trace.status === 'completed'
        ? 'completed'
        : `${evidence.trace.status}: ${evidence.trace.reason ?? 'no reason'}`,
    ),
    holds('the run read the content of Notion', notionReads(evidence) >= 1),
  ];
}

function snapshot(
  where: Readonly<Record<string, PageSnapshot>>,
  key: string,
): PageSnapshot | undefined {
  return where[key];
}

/**
 * Returns the bot's comments that appeared on the page during the run. A comment counts as new by
 * its id, not by its text.
 */
export function newComments(evidence: Evidence, key: string): string[] {
  const before = snapshot(evidence.before, key)?.comments ?? [];
  const after = snapshot(evidence.after, key)?.comments ?? [];
  const known = new Set(before.map((comment) => comment.id));

  return after
    .filter((comment) => comment.author === evidence.bot && !known.has(comment.id))
    .map((comment) => comment.text);
}

export function statusOf(evidence: Evidence, key: string): string | null {
  return snapshot(evidence.after, key)?.status ?? null;
}

export function statusBefore(evidence: Evidence, key: string): string | null {
  return snapshot(evidence.before, key)?.status ?? null;
}

/**
 * Native GBrain writes that an autonomous run does not make: all the tools of the `write` bundle.
 * On its own the system writes to memory through an App intent (`memory_record`), and the mode's
 * toolset (`MODE_TOOLSETS`) offers the run no native write, so a call to any of those tools is a
 * perimeter violation, not the model's choice. What a run remembered through an intent is already
 * recognition.
 */
export const FORBIDDEN_GBRAIN_WRITES: readonly string[] = (
  MCP_TOOLSETS.gbrain.bundles['write'] ?? []
).flatMap((capability) => MCP_TOOLSETS.gbrain.capabilities[capability] ?? []);

/** The tool of the App's memory intent: its applied write is what the run remembered. */
export const MEMORY_RECORD_TOOL: string = MCP_TOOLSETS.app.capabilities['memory_record']?.[0] ?? '';

/**
 * Returns a run's memory writes: native GBrain write calls that ran (they are unavailable to a
 * run, so each is a perimeter violation), and one `record_memory` per applied memory entry. A
 * write the App skipped as identical to the stored one is not counted here, because the memory did
 * not change.
 */
export function memoryWritesOf(trace: TraceView): string[] {
  const native = (trace.toolCalls ?? [])
    .filter(
      (call) => call.server === 'gbrain' && call.ok && FORBIDDEN_GBRAIN_WRITES.includes(call.tool),
    )
    .map((call) => call.tool);
  const recorded = (trace.runtimeEffects ?? [])
    .filter((effect) => effect.kind === 'memory_entry')
    .map(() => MEMORY_RECORD_TOOL);

  return [...native, ...recorded];
}

/** Returns the scalar fields of a page that are compared before and after a run. */
function scalarsOf(page: PageSnapshot): Record<string, string | boolean | null> {
  return {
    name: page.name,
    status: page.status,
    mode: page.mode,
    lifecycle: page.lifecycle ?? null,
    date: page.date,
    deadline: page.deadline,
    inTrash: page.inTrash,
  };
}

/**
 * Returns which fields of the page changed (`missing` means the page is absent from one of the
 * snapshots).
 */
function changedFields(
  before: PageSnapshot | undefined,
  after: PageSnapshot | undefined,
): string[] {
  if (before === undefined || after === undefined) return ['missing'];

  const was = scalarsOf(before);
  const now = scalarsOf(after);

  return Object.keys(was).filter((field) => was[field] !== now[field]);
}

/**
 * Observes that the page's fields did not change. The check guards the perimeter, not the model's
 * behavior, because Notion is read-only in runs. Relations are not compared: Notion synchronizes
 * their reverse reads itself.
 */
export function untouched(evidence: Evidence, key: string): Observation {
  return observed(
    `${key} was not edited`,
    [],
    changedFields(snapshot(evidence.before, key), snapshot(evidence.after, key)),
  );
}

export function statusesUnchanged(evidence: Evidence, keys: readonly string[]): Observation[] {
  return keys.map((key) =>
    observed(`${key} status is unchanged`, statusBefore(evidence, key), statusOf(evidence, key)),
  );
}

export function deliveries(evidence: Evidence): number {
  return kinds(evidence).filter((kind) => kind === 'delivery').length;
}

/** Checks whether any text mentions any of the names, ignoring case; the names must be given. */
export function mentionsAny(texts: readonly string[], names: readonly string[]): boolean {
  const wanted = expectation(names, 'names to look for').map((name) => name.toLowerCase());

  return texts.some((text) => wanted.some((name) => text.toLowerCase().includes(name)));
}

/** Returns the database of a world page by key; `null` means it was not read. */
export function dataSourceOf(evidence: Evidence, key: string): string | null {
  return snapshot(evidence.after, key)?.dataSource ?? null;
}

/**
 * Looks up a scenario page by key: a key absent from the world is a harness fault, not an empty id
 * that would match anything.
 */
export function pageIdOf(evidence: Evidence, key: string): string {
  const id = snapshot(evidence.after, key)?.id;

  if (id === undefined) throw new Error(`the world of the scenario has no page ${key}`);

  return id;
}

export function sameId(ref: string, id: string): boolean {
  const compact = (value: string): string => value.replaceAll('-', '').toLowerCase();

  return id.length > 0 && compact(ref).includes(compact(id));
}

type Detection = Result['detections'][number];

/**
 * Returns the labels of this type. A claim about a label rests on one of them, not on a sum of
 * several.
 */
export function detectionsOf(evidence: Evidence, type: string): Detection[] {
  return (resultOf(evidence)?.detections ?? []).filter((detection) => detection.type === type);
}

/** Checks whether this label cites the page as evidence read from the server. */
export function citedBy(
  detection: Detection,
  evidence: Evidence,
  key: string,
  server: string,
): boolean {
  const id = pageIdOf(evidence, key);

  return detection.evidence.some((item) => item.server === server && sameId(item.ref, id));
}

/** Checks whether at least one label of the run cites the page as evidence read from the server. */
export function cites(evidence: Evidence, key: string, server: string): boolean {
  return (resultOf(evidence)?.detections ?? []).some((detection) =>
    citedBy(detection, evidence, key, server),
  );
}

export function proposedOn(evidence: Evidence, key: string): ProposalView[] {
  const id = pageIdOf(evidence, key);

  return evidence.proposals.filter((proposal) =>
    proposal.effects.some((effect) => sameId(effect.pageId, id)),
  );
}

/**
 * Checks whether each continuation this run scheduled is set no earlier than the minimum lead after
 * the run's start.
 */
export function followUpsRespectLead(evidence: Evidence): boolean {
  const earliest = evidence.trace.createdAt.getTime() + AUTONOMOUS_MIN_LEAD_MS;

  return evidence.continuations.every(
    (continuation) => new Date(continuation.runAt).getTime() >= earliest,
  );
}
