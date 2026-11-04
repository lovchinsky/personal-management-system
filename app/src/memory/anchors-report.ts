import { lostFacts, lostTimelineEntries } from '../knowledge/anchor-drift';
import { checkAnchor, describeAnchor, type AnchorViolation } from '../knowledge/anchor-page';
import { ANCHOR_TYPES } from '../knowledge/anchor-types';
import type { PageRead } from '../knowledge/gbrain-pages';
import type { GbrainInspector } from './gbrain-client';

/**
 * A read-only check of the anchors in GBrain (`docs/2-system.md` § “Knowledge contract GBrain”):
 * whether each follows the convention, whether any object has two anchors, and whether replacing
 * a page wiped from its text what the database still holds. It fixes nothing, because what to do
 * about a violation is up to the person.
 */

/** An anchor that deviates from the convention. */
interface Nonconforming {
  readonly slug: string;
  readonly violations: readonly AnchorViolation[];
}

/** A Notion object that several anchors point to. */
interface Duplicated {
  readonly notionId: string;
  readonly slugs: readonly string[];
}

/**
 * An anchor whose text lacks what the database still holds about it: a sign of a crude page
 * replacement.
 */
interface Drifted {
  readonly slug: string;
  readonly timeline: number;
  readonly facts: number;
}

interface AnchorsReport {
  /** How many anchors were read. */
  readonly checked: number;
  readonly nonconforming: readonly Nonconforming[];
  readonly duplicated: readonly Duplicated[];
  readonly drifted: readonly Drifted[];
}

type Reader = Pick<GbrainInspector, 'listPages' | 'getPage' | 'getTimeline' | 'facts'>;

async function driftOf(reader: Reader, page: PageRead): Promise<Drifted | null> {
  const [entries, facts] = await Promise.all([
    reader.getTimeline(page.slug),
    reader.facts(page.slug),
  ]);
  const timeline = lostTimelineEntries(page, entries).length;
  const lost = lostFacts(page, facts).length;

  return timeline + lost === 0 ? null : { slug: page.slug, timeline, facts: lost };
}

/**
 * Builds a report on all anchors. It lists the anchors by type, checks them page by page and finds
 * duplicates by `notion_id`.
 */
export async function anchorsReport(reader: Reader): Promise<AnchorsReport> {
  const nonconforming: Nonconforming[] = [];
  const drifted: Drifted[] = [];
  const bySubject = new Map<string, string[]>();
  let checked = 0;

  const lists = await Promise.all(ANCHOR_TYPES.map((type) => reader.listPages(type)));

  for (const listed of lists) {
    for (const { slug } of listed) {
      const page = await reader.getPage(slug);

      if (page === null || page.deleted) continue;

      checked += 1;

      const violations = checkAnchor(page);
      const subject = describeAnchor(page)?.notionId;

      if (violations.length > 0) nonconforming.push({ slug, violations });

      if (subject !== undefined) bySubject.set(subject, [...(bySubject.get(subject) ?? []), slug]);

      const drift = await driftOf(reader, page);

      if (drift !== null) drifted.push(drift);
    }
  }

  return {
    checked,
    nonconforming,
    duplicated: [...bySubject]
      .filter(([, slugs]) => slugs.length > 1)
      .map(([notionId, slugs]) => ({ notionId, slugs: [...slugs].sort() })),
    drifted,
  };
}

/** Counts the violations in the report. The command derives its exit code from the count. */
export const problemsIn = (report: AnchorsReport): number =>
  report.nonconforming.length + report.duplicated.length + report.drifted.length;

/** Renders the report in words, for the operator. */
export function renderReport(report: AnchorsReport): string {
  const lines = [`anchors checked: ${report.checked}`];

  for (const item of report.nonconforming) {
    lines.push(
      `does not follow the convention: ${item.slug} (${item.violations
        .map((violation) => `${violation.code}: ${violation.detail}`)
        .join('; ')})`,
    );
  }

  for (const item of report.duplicated) {
    lines.push(`several anchors for ${item.notionId}: ${item.slugs.join(', ')}`);
  }

  for (const item of report.drifted) {
    lines.push(
      `the page text lost what the database holds: ${item.slug} (${item.timeline} timeline entries, ${item.facts} facts)`,
    );
  }

  lines.push(problemsIn(report) === 0 ? 'no problems' : `problems: ${problemsIn(report)}`);

  return `${lines.join('\n')}\n`;
}
