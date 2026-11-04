import { squash } from './anchor-drift';
import type { FactRead, TimelineEntry } from './gbrain-pages';
import { DECISION_MARKER, STANDARD_MARKER } from './memory-writes';

/**
 * A memory entry the system makes on its own behalf (`contracts/canonical.yaml`, key
 * `memory_writes`): an event, a decision, a fact and an Area of Focus's acceptable state. This
 * file covers how an entry kind becomes a GBrain write and how to recognize that an entry is
 * already stored. Exact identity decides where an entry lands.
 */
export const MEMORY_ENTRY_KINDS = ['event', 'decision', 'fact', 'standard'] as const;

type MemoryEntryKind = (typeof MEMORY_ENTRY_KINDS)[number];

/**
 * Kinds that need a page, because a timeline event and an Area of Focus's acceptable state do not
 * exist without an object.
 */
export const KINDS_NEEDING_OBJECT: readonly MemoryEntryKind[] = ['event', 'standard'];

/**
 * The source of an entry: the Notion page and thread where it was said or read, or a conversation.
 */
export type EntrySource =
  | { readonly kind: 'notion'; readonly pageId: string; readonly discussionId?: string }
  | { readonly kind: 'conversation' };

/** What to record: the kind, the text on one line, the day `YYYY-MM-DD` and the source. */
export interface EntryContent {
  readonly kind: MemoryEntryKind;
  readonly text: string;
  readonly date: string;
  readonly source: EntrySource;
}

/** The GBrain write a memory entry becomes: a timeline event of a page, or a fact. */
export type GbrainEntryWrite =
  | {
      readonly tool: 'timeline';
      readonly slug: string;
      readonly date: string;
      readonly summary: string;
      readonly source: string;
    }
  | {
      readonly tool: 'fact';
      readonly fact: string;
      readonly kind: 'fact' | 'preference';
      readonly provenance: string;
      /** Slug of the page the fact is about; `null` means a fact with no entity in Notion. */
      readonly entity: string | null;
    };

/** Renders the source as GBrain sees it: a pointer, not a summary. */
export function provenanceOf(source: EntrySource, date: string): string {
  switch (source.kind) {
    case 'notion':
      return [
        `Notion page ${source.pageId}`,
        ...(source.discussionId === undefined ? [] : [`thread ${source.discussionId}`]),
        date,
      ].join(', ');

    case 'conversation':
      return `Conversation, ${date}`;
  }
}

/**
 * Returns the text with the marker of its kind. A marker the text already has is not added twice.
 */
function marked(marker: string, text: string): string {
  return text.startsWith(marker) ? text : `${marker} ${text}`;
}

/**
 * Builds the GBrain write for a memory entry. `slug` is the anchor of the object the entry is
 * about, or `null` when there is no Notion object. With `null`, a decision and a fact are written
 * as a fact with no entity. A decision on an anchor is a timeline event with the `Decision:`
 * marker. An Area of Focus's acceptable state is a fact of kind `preference` with the `Standard:`
 * marker.
 */
export function entryWrite(entry: EntryContent, slug: string | null): GbrainEntryWrite {
  const provenance = provenanceOf(entry.source, entry.date);

  switch (entry.kind) {
    case 'event':
      return timeline(entry, requiredSlug(entry.kind, slug), entry.text, provenance);

    case 'decision':
      return slug === null
        ? fact(marked(DECISION_MARKER, entry.text), 'fact', provenance, null)
        : timeline(entry, slug, marked(DECISION_MARKER, entry.text), provenance);

    case 'fact':
      return fact(entry.text, 'fact', provenance, slug);

    case 'standard':
      return fact(
        marked(STANDARD_MARKER, entry.text),
        'preference',
        provenance,
        requiredSlug(entry.kind, slug),
      );
  }
}

function timeline(
  entry: EntryContent,
  slug: string,
  summary: string,
  source: string,
): GbrainEntryWrite {
  return { tool: 'timeline', slug, date: entry.date, summary, source };
}

function fact(
  text: string,
  kind: 'fact' | 'preference',
  provenance: string,
  entity: string | null,
): GbrainEntryWrite {
  return { tool: 'fact', fact: text, kind, provenance, entity };
}

function requiredSlug(kind: MemoryEntryKind, slug: string | null): string {
  if (slug === null) throw new RangeError(`a ${kind} entry needs the page of its object`);

  return slug;
}

/**
 * Checks whether `write` is already stored on the page: the same event on the same day, or the
 * same fact among the page's facts. A fact with no entity cannot be found reliably, so it is not
 * compared.
 */
export function storedAlready(
  write: GbrainEntryWrite,
  timelineOfPage: readonly TimelineEntry[],
  factsOfPage: readonly FactRead[],
): boolean {
  switch (write.tool) {
    case 'timeline':
      return timelineOfPage.some(
        (entry) => entry.date === write.date && squash(entry.summary) === squash(write.summary),
      );

    case 'fact':
      return (
        write.entity !== null &&
        factsOfPage.some((stored) => squash(stored.fact) === squash(write.fact))
      );
  }
}
