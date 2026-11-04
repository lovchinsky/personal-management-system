import { ANCHOR_TYPES, type AnchorType } from '../knowledge/anchor-types';
import { resolveAnchor, slugsToRead, type AnchorIdentity } from '../knowledge/exact-identity';
import type { PageRead } from '../knowledge/gbrain-pages';
import { canonicalNotionId } from '../notion/client/notion-id';
import type { GbrainInspector } from './gbrain-client';

/**
 * Resolves the anchor of a Notion object by the exact identity procedure (`docs/2-system.md` §
 * “Exact identity”): a search by id among the anchor types, a read of the candidates with an exact
 * match and of the page at the conventional address for `type`, and a check of their `notion_id`.
 * The Skill follows the same procedure. This function is for the gate and the operator.
 */
export async function identityOf(
  inspector: Pick<GbrainInspector, 'searchHits' | 'getPage'>,
  type: AnchorType,
  notionId: string,
): Promise<AnchorIdentity> {
  const id = canonicalNotionId(notionId);
  const hits = await inspector.searchHits(id, ANCHOR_TYPES);
  const read = await Promise.all(
    slugsToRead(hits, type, id).map((slug) => inspector.getPage(slug)),
  );

  return resolveAnchor(
    id,
    read.filter((page): page is PageRead => page !== null),
  );
}
