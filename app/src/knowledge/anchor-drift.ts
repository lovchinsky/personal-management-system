import type { FactRead, PageRead, TimelineEntry } from './gbrain-pages';

/**
 * Returns the text without line breaks or double spaces, because GBrain reduces an entry to a
 * single line.
 */
export const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Returns the timeline events that the database keeps but the page text already lacks. This is
 * how a page looks once a full `put_page` with no timeline section has replaced it: the rows
 * stay in the database, but the page file the database is restored from does not contain them.
 */
export function lostTimelineEntries(
  page: PageRead,
  entries: readonly TimelineEntry[],
): TimelineEntry[] {
  const lines = page.timeline.split('\n').map(squash);

  return entries.filter(
    (entry) =>
      !lines.some(
        (line) => line.includes(`**${entry.date}**`) && line.includes(squash(entry.summary)),
      ),
  );
}

/**
 * Returns the facts about the page that the facts section of its text does not contain. They
 * are a sign of the same thing: a replacement made without the section.
 */
export function lostFacts(page: PageRead, facts: readonly FactRead[]): FactRead[] {
  const text = squash(page.compiledTruth);

  return facts.filter((fact) => fact.entitySlug === page.slug && !text.includes(squash(fact.fact)));
}
