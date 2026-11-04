import { z } from 'zod';

/**
 * An id in Notion's form, with or without hyphens. The form is the same wherever ids are
 * recognized.
 */
const NOTION_ID = '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}';

const WHOLE_ID = new RegExp(`^${NOTION_ID}$`, 'i');

const IDS_IN_TEXT = new RegExp(`\\b${NOTION_ID}\\b`, 'gi');

/**
 * Returns the id of a Notion page, thread or database in one form: hyphenated and lowercase.
 *
 * Notion accepts both forms and returns hyphenated ones; the model, though, may take an id from a
 * URL, which has no hyphens. Comparing forms without converting them would silently fail to
 * match: the effect and the precondition of a proposal about the same page would diverge, and a
 * thread's continuation would get a second row.
 *
 * A string that is not a UUID stays as it is: Notion issues no such ids, and deciding whether it
 * is usable is the job of whoever accepted it.
 */
export function canonicalNotionId(id: string): string {
  if (!WHOLE_ID.test(id)) return id;

  const hex = id.replaceAll('-', '').toLowerCase();

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** A Notion id from a request, in canonical form. */
export const notionIdSchema = z.string().min(1).transform(canonicalNotionId);

/**
 * The thread address by which the Notion MCP shows a thread to the model:
 * `discussion://<page>/<block>/<thread>`; the thread id is the last segment.
 */
const DISCUSSION_ADDRESS = /^discussion:\/\/(?:[^/]+\/)*([^/]+)$/i;

/**
 * Returns a Notion thread id in one form, from an id or from a Notion MCP thread address. The
 * model takes a thread from what it read in the Notion MCP, but REST and the thread registry know
 * only ids. An address accepted as is would go into the queue under the wrong key, and Notion
 * would reject a comment in that thread only when the comment is applied.
 */
export function canonicalDiscussionId(id: string): string {
  return canonicalNotionId(DISCUSSION_ADDRESS.exec(id)?.[1] ?? id);
}

/** A thread id from a request, in canonical form. */
export const discussionIdSchema = z.string().min(1).transform(canonicalDiscussionId);

/** Checks whether the whole string is a Notion id. */
export function isNotionId(value: string): boolean {
  return WHOLE_ID.test(value);
}

/** Returns all Notion ids in the text, in canonical form. */
export function notionIdsIn(text: string): string[] {
  return [...text.matchAll(IDS_IN_TEXT)].map(([id]) => canonicalNotionId(id));
}
