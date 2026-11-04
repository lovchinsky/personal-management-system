import type { GbrainCall } from '../../src/claude/runner/run-tap';
import { checkAnchor, describeAnchor } from '../../src/knowledge/anchor-page';
import {
  DECISION_MARKER,
  GBRAIN_CALL_BUDGET,
  STANDARD_MARKER,
} from '../../src/knowledge/memory-writes';
import { canonicalNotionId, notionIdsIn } from '../../src/notion/client/notion-id';
import {
  atMostOneNotification,
  common,
  noDirectGbrainWrites,
  noNewPages,
  raised,
  readGbrain,
  statuses,
  type SingleClaim,
} from './claim-parts';
import {
  citedBy,
  claimOf,
  deliveries,
  detectionsOf,
  detectionTypes,
  effect,
  holds,
  MEMORY_RECORD_TOOL,
  mentionsAny,
  observed,
  pageIdOf,
  perimeter,
  recognition,
  resultOf,
  uncertaintiesOf,
  untouched,
  type Claim,
  type Observation,
} from './gate-claims';
import { inThread, textsOf, type Evidence6 } from './m6-evidence';
import { LESSON_STEM, SUBJECT_STEM, TRAP_STEM, type M7ScenarioId } from './m7-scenarios';
import {
  addedFacts,
  addedTimeline,
  argument,
  bodyKept,
  firstCall,
  refersTo,
  sameSlug,
  unchanged,
} from './memory-evidence';

/**
 * Claims of the gate M7 scenarios (`docs/5-plan.md` § “M7 — GBrain knowledge lifecycle”): what the
 * run left in memory. The gate reads the state of the pages before and after the run from GBrain
 * itself, and the calls of the run come from its runner, so a claim measures what was written, not
 * what was said.
 */

/**
 * Returns the slug of a scenario's memory page by its key. A key the scenario did not plant is a
 * harness fault.
 */
function slugOf(evidence: Evidence6, key: string): string {
  const slug = evidence.memory.slugs[key];

  if (slug === undefined) throw new Error(`the scenario planted no page ${key}`);

  return slug;
}

/** Observes that the run remembered nothing. */
const nothingWritten = (evidence: Evidence6): Observation =>
  observed('nothing is remembered', [], evidence.gbrainWrites);

/** Observes that the run remembered nothing and that the page it read stayed as it was. */
const nothingRemembered = (evidence: Evidence6, key: string): Observation[] =>
  effect(nothingWritten(evidence), holds('the page is as it was', unchanged(evidence.memory, key)));

/**
 * Returns the observations the scenarios share where the person speaks in a thread and the run
 * works with memory: those common to every scenario, the statuses, nothing new in Notion, at most
 * one notification, no pages or links in GBrain.
 */
const around = (evidence: Evidence6, keys: readonly string[]): Observation[][] => [
  common(evidence),
  statuses(evidence, keys),
  noNewPages(evidence),
  atMostOneNotification(evidence),
  noDirectGbrainWrites(evidence),
];

/** Returns the number of the first read of the scenario's anchor by the run, `-1` if it did not. */
const anchorRead = (evidence: Evidence6): number =>
  firstCall(evidence.memory, 'get_page', slugOf(evidence, 'anchor'));

/** Checks whether a fact is on this page: its entity is the page's slug. */
const aboutPage = (fact: { readonly entitySlug: string | null }, slug: string): boolean =>
  fact.entitySlug !== null && sameSlug(fact.entitySlug, slug);

/**
 * Builds the claim for a routine case: the reply came, the status changed, the date was clarified.
 * Nothing goes into memory, and the project page does not change (`SCEN-19-30`).
 */
function routineClaim(worldKeys: readonly string[]): SingleClaim {
  return (evidence) =>
    claimOf(...around(evidence, worldKeys), nothingRemembered(evidence, 'anchor'));
}

/** Texts and uncertainties where a run may say that GBrain holds several pages for the project. */
const SEVERAL_PAGES =
  /(кілька|кількох|декілька|дві|двох|два|обидва|обидві|\b[2-9]\b|several|multiple|two|both)[^.]{0,40}(сторін|page|anchor|якор)|дубл|duplicate/i;

function tellsOfSeveralPages(evidence: Evidence6): boolean {
  return [...textsOf(evidence), ...uncertaintiesOf(evidence)].some((text) =>
    SEVERAL_PAGES.test(text),
  );
}

/** Lists the GBrain pages that the run cites as evidence for its labels. */
const citedPages = (evidence: Evidence6): string[] =>
  (resultOf(evidence)?.detections ?? [])
    .flatMap((detection) => detection.evidence)
    .filter((item) => item.server === 'gbrain')
    .map((item) => item.ref);

/**
 * Builds the claim for two anchors with the same id for the project: the run chooses neither,
 * writes nothing, does not rely on the lesson from the first anchor and says that there are several
 * pages (`SCEN-19-38`).
 */
function twoAnchorsClaim(evidence: Evidence6): Claim {
  const keys = ['anchor', 'copy'];
  const slugs = keys.map((key) => slugOf(evidence, key));

  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting']),
    noDirectGbrainWrites(evidence),
    atMostOneNotification(evidence),
    effect(
      nothingWritten(evidence),
      holds(
        'neither anchor is changed',
        keys.every((key) => unchanged(evidence.memory, key)),
      ),
      holds(
        'no detection cites either anchor',
        citedPages(evidence).every((ref) => !slugs.some((slug) => refersTo(ref, slug))),
      ),
    ),
    recognition(
      'positive',
      holds('the run looked into GBrain', readGbrain(evidence)),
      holds(
        'the run says that GBrain holds several pages for the project',
        tellsOfSeveralPages(evidence),
      ),
    ),
    recognition(
      'negative',
      holds('no forgotten context is raised', !raised(evidence, 'forgotten_context')),
      holds(
        'the lesson on the first page does not reach the person',
        !mentionsAny(textsOf(evidence), [LESSON_STEM]),
      ),
    ),
  );
}

/**
 * Checks whether the run read the anchor before it wrote, because otherwise there is nothing to
 * check “already written” or “contradicts what is stored” against. The order of reading and writing
 * is visible in the run trace, where the calls of all servers are listed in order: the first read
 * of a GBrain page comes before the first memory intent.
 */
const readBeforeRecording = (evidence: Evidence6): boolean => {
  const calls = evidence.trace.toolCalls ?? [];
  const read = calls.findIndex(
    (call) => call.server === 'gbrain' && call.ok && call.tool === 'get_page',
  );
  const recorded = calls.findIndex(
    (call) => call.server === 'app' && call.ok && call.tool === MEMORY_RECORD_TOOL,
  );

  return anchorRead(evidence) >= 0 && read >= 0 && recorded >= 0 && read < recorded;
};

/**
 * Checks whether every applied memory write landed on this page: the effect of the write names its
 * slug.
 */
const entriesLandOn = (evidence: Evidence6, slug: string): boolean =>
  (evidence.trace.runtimeEffects ?? [])
    .filter((applied) => applied.kind === 'memory_entry')
    .every((applied) => sameSlug(applied.id, slug));

/**
 * Builds the claim for a decision the person made on a project that has an anchor: exactly one
 * event appears on the anchor that starts with the decision marker, names the choice in the
 * person's words and has a source, and the page text does not change (`SCEN-19-31`).
 */
function decisionStatedClaim(evidence: Evidence6): Claim {
  const added = addedTimeline(evidence.memory, 'anchor');
  const slug = slugOf(evidence, 'anchor');

  return claimOf(
    ...around(evidence, ['project', 'provider']),
    effect(
      observed('one timeline entry is added to the anchor', 1, added.length),
      holds(
        `the entry starts with ${DECISION_MARKER} and gives the choice the person stated`,
        added.every(
          (entry) =>
            entry.summary.startsWith(DECISION_MARKER) && entry.summary.includes(SUBJECT_STEM),
        ),
      ),
      holds(
        'the entry names its source',
        added.every((entry) => entry.source.trim().length > 0),
      ),
      holds('every memory entry lands on the anchor', entriesLandOn(evidence, slug)),
      holds('the text of the anchor is as it was', bodyKept(evidence.memory, 'anchor')),
    ),
    recognition(
      'positive',
      holds('the run read the anchor before it recorded', readBeforeRecording(evidence)),
    ),
  );
}

/**
 * Builds the claim for a decision that is already written: it is not written again, as an event or
 * as a fact.
 */
function decisionStoredClaim(evidence: Evidence6): Claim {
  return claimOf(
    ...around(evidence, ['project', 'provider']),
    effect(
      observed('no timeline entry is added', [], addedTimeline(evidence.memory, 'anchor')),
      observed('no fact is added', [], addedFacts(evidence.memory, 'anchor')),
      nothingWritten(evidence),
    ),
    recognition(
      'positive',
      holds('the run read the anchor, where the decision lies', anchorRead(evidence) >= 0),
    ),
  );
}

/**
 * Builds the claim for a fact the person stated about the client: exactly one fact in the person's
 * words appears on the project anchor, with the anchor itself as its entity, and the page text
 * loses nothing.
 */
function factStatedClaim(evidence: Evidence6): Claim {
  const added = addedFacts(evidence.memory, 'anchor');
  const slug = slugOf(evidence, 'anchor');

  return claimOf(
    ...around(evidence, ['project', 'mockups']),
    effect(
      observed('one fact is added to the anchor', 1, added.length),
      holds(
        'the fact is what the person stated',
        added.every((fact) => fact.fact.includes(SUBJECT_STEM)),
      ),
      holds(
        'the fact is about the anchor',
        added.every((fact) => aboutPage(fact, slug)),
      ),
      holds('every memory entry lands on the anchor', entriesLandOn(evidence, slug)),
      holds('the text of the anchor keeps every line it had', bodyKept(evidence.memory, 'anchor')),
    ),
    recognition(
      'positive',
      holds('the run read the anchor before it recorded', readBeforeRecording(evidence)),
    ),
  );
}

/**
 * Wording that would tell the person about the structure of memory: its storage and pages, not
 * memory itself.
 */
const STORAGE_WORDS = /gbrain|anchor|якор|сторінк\p{L}* (?:пам|у пам|в пам)/iu;

/**
 * Builds the claim for a decision about a project that memory has nothing on yet: the App creates
 * the project anchor by convention, and one decision event in the person's words lands on it. The
 * anchor of another project is not touched, and the person hears nothing about the memory storage
 * or its pages.
 */
function noAnchorClaim(evidence: Evidence6): Claim {
  const slug = slugOf(evidence, 'anchor');
  const created = evidence.memory.after['anchor']?.page ?? null;
  const added = addedTimeline(evidence.memory, 'anchor');
  const project = canonicalNotionId(pageIdOf(evidence, 'project'));

  return claimOf(
    ...around(evidence, ['project', 'provider']),
    effect(
      holds(
        'the project had no anchor before the run',
        evidence.memory.before['anchor']?.page == null,
      ),
      holds(
        'an anchor of the project is created by convention',
        created !== null &&
          checkAnchor(created).length === 0 &&
          describeAnchor(created)?.notionId === project,
      ),
      observed('one timeline entry is added to it', 1, added.length),
      holds(
        `the entry starts with ${DECISION_MARKER} and gives the choice the person stated`,
        added.every(
          (entry) =>
            entry.summary.startsWith(DECISION_MARKER) && entry.summary.includes(SUBJECT_STEM),
        ),
      ),
      holds('every memory entry lands on that anchor', entriesLandOn(evidence, slug)),
      holds('the other anchor is as it was', unchanged(evidence.memory, 'other')),
      holds(
        'at most one comment in the thread of the reply',
        inThread(evidence, 'provider').length <= 1,
      ),
    ),
    recognition(
      'negative',
      holds(
        'the person hears nothing about how memory is stored',
        textsOf(evidence).every((text) => !STORAGE_WORDS.test(text)),
      ),
    ),
  );
}

/**
 * Builds the claim for a lesson that the person put into words themselves in the thread. These are
 * the person's words, so one fact with them lands on the project anchor, with no episode threshold,
 * and the run does not write a lesson page.
 */
function lessonStatedClaim(evidence: Evidence6): Claim {
  const added = addedFacts(evidence.memory, 'anchor');
  const slug = slugOf(evidence, 'anchor');

  return claimOf(
    ...around(evidence, ['project', 'waiting']),
    recognition(
      'positive',
      observed('one fact is added to the anchor', 1, added.length),
      holds(
        "the fact is the lesson in the person's words",
        added.every((fact) => fact.fact.includes(SUBJECT_STEM)),
      ),
      holds(
        'the fact is about the anchor',
        added.every((fact) => aboutPage(fact, slug)),
      ),
      observed('no timeline entry is added', [], addedTimeline(evidence.memory, 'anchor')),
      holds('every memory entry lands on the anchor', entriesLandOn(evidence, slug)),
    ),
  );
}

/**
 * Builds the claim for one missed repetition when the history of the Behavior System has one
 * similar event: no write, no conclusion about the person, and the Behavior System stays quiet,
 * with no proposals and no notifications.
 */
function belowThresholdClaim(evidence: Evidence6): Claim {
  return claimOf(
    common(evidence),
    perimeter(untouched(evidence, 'system')),
    statuses(evidence, ['instance']),
    noDirectGbrainWrites(evidence),
    nothingRemembered(evidence, 'anchor'),
    effect(
      observed('no proposal', [], evidence.proposals),
      observed('no notification', 0, deliveries(evidence)),
    ),
    recognition(
      'negative',
      holds(
        'no friction or Area of Focus risk label is raised',
        detectionTypes(evidence).every(
          (type) => type !== 'behavior_system_friction' && type !== 'area_of_focus_risk',
        ),
      ),
    ),
  );
}

/**
 * Checks whether a call is a search by topic: `query` or a `search` that names no object id (a
 * search for an anchor by id is not one).
 */
const searchesByTopic = (call: GbrainCall): boolean =>
  call.tool === 'query' ||
  (call.tool === 'search' && notionIdsIn(argument(call, 'query')).length === 0);

/**
 * Checks that the run does not jump to a topic search before it has read the anchor: structure
 * comes first.
 */
function structureFirst(evidence: Evidence6): boolean {
  const read = anchorRead(evidence);
  const free = evidence.memory.calls.findIndex(searchesByTopic);

  return read >= 0 && (free < 0 || read < free);
}

type LinkSide = 'in' | 'out';

const BOTH_SIDES: readonly LinkSide[] = ['in', 'out'];

/**
 * Returns which sides of a page's links a call reads: those that lead to it (`in`) and those that
 * lead from it (`out`). A graph traversal with no direction given runs both ways in GBrain.
 */
function linkSides(call: GbrainCall): readonly LinkSide[] {
  switch (call.tool) {
    case 'get_links':
      return ['out'];
    case 'get_backlinks':
      return ['in'];
    case 'traverse_graph': {
      const direction = argument(call, 'direction');

      return direction === 'in' || direction === 'out' ? [direction] : BOTH_SIDES;
    }
    default:
      return [];
  }
}

/**
 * Checks whether the run listed the links of the anchor from both sides, because a link to a page
 * that concerns the object leads either way.
 */
function linksFromBothSides(evidence: Evidence6): boolean {
  const anchor = slugOf(evidence, 'anchor');
  const sides = new Set(
    evidence.memory.calls
      .filter((call) => call.ok && sameSlug(argument(call, 'slug'), anchor))
      .flatMap(linkSides),
  );

  return BOTH_SIDES.every((side) => sides.has(side));
}

/**
 * Builds the claim for a lesson on a page linked to the anchor. The label cites the lesson page and
 * a Notion page, a word from the lesson reaches the person, and the words of the similar project
 * do not. The reading fits the budget, free search does not precede the anchor, and the links of
 * the anchor are read from both sides.
 */
function structureFirstClaim(evidence: Evidence6): Claim {
  const lesson = slugOf(evidence, 'lesson');

  return claimOf(
    common(evidence),
    statuses(evidence, ['project', 'waiting']),
    noDirectGbrainWrites(evidence),
    atMostOneNotification(evidence),
    effect(nothingWritten(evidence)),
    recognition(
      'positive',
      holds('the forgotten context is raised', raised(evidence, 'forgotten_context')),
      holds(
        'one detection cites the lesson that the anchor links to and a page of Notion',
        detectionsOf(evidence, 'forgotten_context').some(
          (item) =>
            item.evidence.some(
              (cited) => cited.server === 'gbrain' && refersTo(cited.ref, lesson),
            ) &&
            (citedBy(item, evidence, 'waiting', 'notion') ||
              citedBy(item, evidence, 'project', 'notion')),
        ),
      ),
      holds(
        'the lesson reaches the person: its code word is in the text',
        mentionsAny(textsOf(evidence), [LESSON_STEM]),
      ),
      holds('the run reads the anchor before any free-text search', structureFirst(evidence)),
      holds('the run lists the links of the anchor from both sides', linksFromBothSides(evidence)),
      holds(
        `the run stays within ${GBRAIN_CALL_BUDGET} GBrain calls`,
        evidence.memory.calls.length <= GBRAIN_CALL_BUDGET,
      ),
    ),
    recognition(
      'negative',
      holds(
        'the lesson of the similar project does not reach the person',
        !mentionsAny(textsOf(evidence), [TRAP_STEM]),
      ),
    ),
  );
}

/**
 * Builds the claim for what the person said is acceptable for an Area of Focus: a fact of kind
 * preference that starts with the standard marker appears on the anchor of the Area of Focus. The
 * claim is recorded, not gating, because the norm has no acceptance scenario yet.
 */
function standardStatedClaim(evidence: Evidence6): Claim {
  const added = addedFacts(evidence.memory, 'anchor');
  const slug = slugOf(evidence, 'anchor');

  return claimOf(
    ...around(evidence, ['area_of_focus', 'jog']),
    recognition(
      'positive',
      observed('one fact is added to the anchor of the Area of Focus', 1, added.length),
      holds(
        `the fact starts with ${STANDARD_MARKER} and is of kind preference`,
        added.every((fact) => fact.fact.startsWith(STANDARD_MARKER) && fact.kind === 'preference'),
      ),
      holds(
        'the fact is about the anchor of the Area of Focus',
        added.every((fact) => aboutPage(fact, slug)),
      ),
    ),
  );
}

export const M7_CLAIMS: Readonly<Record<M7ScenarioId, SingleClaim>> = {
  H1_routine_done: routineClaim(['project', 'finished', 'next', 'later']),
  H2_routine_answer: routineClaim(['project', 'check']),
  H3_two_anchors: twoAnchorsClaim,
  H4_decision_stated: decisionStatedClaim,
  H5_decision_stored: decisionStoredClaim,
  H6_fact_stated: factStatedClaim,
  H7_no_anchor: noAnchorClaim,
  H8_below_threshold: belowThresholdClaim,
  H9_structure_first: structureFirstClaim,
  H10_standard_stated: standardStatedClaim,
  H11_lesson_stated: lessonStatedClaim,
};
