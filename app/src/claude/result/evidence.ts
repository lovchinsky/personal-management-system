import { McpServerName } from '../../generated/prisma/enums';
import { canonicalNotionId, isNotionId, notionIdsIn } from '../../notion/client/notion-id';
import { EvaluationResult, Evidence } from './evaluation-result';

/**
 * What a run read: the text returned by successful tool calls of each server. It is held in memory
 * only, for the duration of the run, and does not go into the run trace (GAP-07).
 */
export type Reads = ReadonlyMap<McpServerName, readonly string[]>;

/**
 * Returns the evidence the run did not read (`INV-036`).
 *
 * An object counts as read when its identifier was returned by a successful call of a tool of the
 * same server in this run. Notion ids are compared in canonical form, since the model takes them
 * from URLs too, where they have no hyphens. A Notion link with exactly one id (a database
 * address `collection://<id>`, a page URL) is compared by that id, because the response names the
 * object by its id, not by the address under which the model requested it. Anything else is
 * matched as a string in the response text.
 */
export function unreadEvidence(result: EvaluationResult, reads: Reads): Evidence[] {
  const seen = new Map(
    [...reads].map(([server, texts]) => [server, { text: texts.join('\n'), ids: idsIn(texts) }]),
  );

  return result.detections
    .flatMap((detection) => detection.evidence)
    .filter((evidence) => {
      const read = seen.get(evidence.server);
      if (!read) {
        return true;
      }

      const id = idOf(evidence);

      return id === null ? !read.text.includes(evidence.ref) : !read.ids.has(id);
    });
}

/** Returns the id of the object a link leads to; `null` means the link is compared as a string. */
function idOf(evidence: Evidence): string | null {
  if (isNotionId(evidence.ref)) return canonicalNotionId(evidence.ref);
  if (evidence.server !== 'notion') return null;

  const ids = notionIdsIn(evidence.ref);

  return ids.length === 1 ? (ids[0] ?? null) : null;
}

function idsIn(texts: readonly string[]): Set<string> {
  return new Set(texts.flatMap(notionIdsIn));
}
