import { DETECTOR_ACTIVATION, DETECTOR_LABELS } from '../../src/claude/result/detector-labels';
import { bundleTools } from '../../src/runs/toolsets';
import {
  deliveries,
  detectionsOf,
  detectionTypes,
  effect,
  engaged,
  followUpsRespectLead,
  FORBIDDEN_GBRAIN_WRITES,
  holds,
  kinds,
  observed,
  perimeter,
  recognition,
  statusesUnchanged,
  type Claim,
  type Observation,
} from './gate-claims';
import { textsOf, type Evidence6 } from './m6-evidence';
import { LABELS_NOT_RAISED } from './m6-items';

/**
 * The parts that make up the claims of the gate M6 and M7 scenarios: what every scenario shares,
 * silence, unchanged statuses, no new pages and the limits the App enforces. `claimOf` assembles
 * them into a scenario's claim.
 */

/** An id in text for the person: a UUID in any form (hyphenated or 32 characters in a row). */
const IDENTIFIER = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|[0-9a-f]{32}/i;

/** Returns the texts that contain an identifier. */
export function identifiersIn(texts: readonly string[]): string[] {
  return texts.filter((text) => IDENTIFIER.test(text));
}

/**
 * Returns the label names that people do not know: texts for the person do not name them. Only the
 * names written with an underscore are returned, because the rest (`dependency`, `contradiction`)
 * are ordinary words.
 */
export function labelNamesIn(texts: readonly string[]): string[] {
  return DETECTOR_LABELS.filter(
    (label) => label.includes('_') && texts.some((text) => text.includes(label)),
  );
}

/**
 * The labels that an autonomous event or recheck run does not raise: Inbox review and shadow. The
 * list is derived from the label modes (`detector_activation`) rather than written here, because
 * the contract key has a consumer that measures behavior, and a change of a label's mode changes
 * the measurement together with the policy.
 */
const NOT_RAISED_BY_RUNS: readonly string[] = DETECTOR_LABELS.filter((label) =>
  ['inbox_review', 'shadow'].includes(DETECTOR_ACTIVATION[label]),
);

/**
 * Returns the observations that every scenario shares. The run ended with a valid result and looked
 * at the Notion content, everything it wrote landed on pages of the world, and the texts for the
 * person show no identifiers and name no label. A label of a mode that an event run does not raise
 * was not raised. The texts are taken from the run's effects, not from the pages.
 */
export function common(evidence: Evidence6): Observation[] {
  const texts = textsOf(evidence);

  return [
    ...effect(
      ...engaged(evidence),
      observed('every write of the run lies on a page of the world', [], evidence.foreign),
      observed('no identifier in any text for the person', [], identifiersIn(texts)),
      observed('no label name in any text for the person', [], labelNamesIn(texts)),
    ),
    ...recognition(
      'negative',
      observed(
        LABELS_NOT_RAISED,
        [],
        detectionTypes(evidence).filter((type) => NOT_RAISED_BY_RUNS.includes(type)),
      ),
    ),
  ];
}

/**
 * The effects through which a run speaks to the person: a comment, a notification, a proposal. A
 * continuation says nothing to the person.
 */
const SPOKEN: readonly string[] = ['comment', 'delivery', 'proposal'];

/**
 * Returns the observations for a run whose correct answer is silence: no word, message or proposal.
 */
export function silent(evidence: Evidence6): Observation[] {
  return effect(
    observed(
      'nothing is said to the person: no comment, notification or proposal',
      [],
      kinds(evidence).filter((kind) => SPOKEN.includes(kind)),
    ),
  );
}

/**
 * Observes unchanged statuses. Notion is read-only in a run, so the toolset keeps them unchanged.
 */
export const statuses = (evidence: Evidence6, keys: readonly string[]): Observation[] =>
  perimeter(...statusesUnchanged(evidence, keys));

/**
 * Observes that no new pages appear, because in an event or reply run the toolset does not let the
 * run create pages.
 */
export const noNewPages = (evidence: Evidence6): Observation[] =>
  perimeter(
    observed(
      'no Task or Project is created',
      [],
      kinds(evidence).filter((kind) => kind === 'page_created'),
    ),
  );

/**
 * Observes at most one notification. There is one delivery key per run, so the App enforces the
 * limit.
 */
export const atMostOneNotification = (evidence: Evidence6): Observation[] =>
  perimeter(holds('at most one notification', deliveries(evidence) <= 1));

/**
 * Observes that a continuation is scheduled no sooner than the minimum lead. That is an App rule,
 * not the model's choice.
 */
export const followUpLead = (evidence: Evidence6): Observation[] =>
  perimeter(holds('a follow-up respects the minimum lead', followUpsRespectLead(evidence)));

export const raised = (evidence: Evidence6, type: string): boolean =>
  detectionsOf(evidence, type).length > 0;

export const wordsOfThe = (comments: readonly { readonly text: string }[]): string[] =>
  comments.map((comment) => comment.text);

/** The claim of a one-off scenario, by its id; the W1 chain is assembled separately. */
export type SingleClaim = (evidence: Evidence6) => Claim;

/**
 * A run does not write to GBrain directly: on its own the system writes to memory by an App
 * intent, and only a conversation writes with a native write, at the person's request.
 */
export const noDirectGbrainWrites = (evidence: Evidence6): Observation[] =>
  perimeter(
    observed(
      'no direct write to GBrain',
      [],
      evidence.gbrainWrites.filter((tool) => FORBIDDEN_GBRAIN_WRITES.includes(tool)),
    ),
  );

/**
 * The GBrain tools with which a run reads memory: search and pages. Without a read, “no label”
 * would be vacuous, because a run that never saw the trap did not avoid it either.
 */
const GBRAIN_READS: ReadonlySet<string> = new Set(bundleTools('gbrain', 'read'));

export function readGbrain(evidence: Evidence6): boolean {
  return (evidence.trace.toolCalls ?? []).some(
    (call) => call.server === 'gbrain' && call.ok && GBRAIN_READS.has(call.tool),
  );
}
