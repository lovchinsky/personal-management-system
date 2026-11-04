import { anchorSlug, canonicalIdOf, describeAnchor } from './anchor-page';
import { isAnchorType, type AnchorType } from './anchor-types';
import type { PageRead, SearchHit } from './gbrain-pages';

/** The exact-match mark in a search response (`gbrain_exact_identity.candidate_evidence`). */
export const CANDIDATE_EVIDENCE = 'keyword_exact';

/**
 * The answer to the question “does this Notion object have an anchor”
 * (`gbrain_exact_identity.states`).
 */
export type AnchorIdentity =
  | { readonly state: 'absent' }
  | { readonly state: 'exact'; readonly slug: string }
  | { readonly state: 'integrity_error'; readonly slugs: readonly string[] };

/** State names in contract order; the contract agreement test checks that the list is complete. */
export const IDENTITY_STATES = [
  'absent',
  'exact',
  'integrity_error',
] as const satisfies readonly AnchorIdentity['state'][];

/**
 * Selects the pages to read to answer: the hits of a search by id that have an anchor type and
 * are marked as exact matches. A page that is only similar in meaning is not a candidate
 * (search returns the closest page even when none contains the id). A page of another type
 * that merely mentions the id is filtered out here and costs no read.
 */
export function candidateSlugs(hits: readonly SearchHit[]): string[] {
  return [
    ...new Set(
      hits
        .filter((hit) => hit.evidence === CANDIDATE_EVIDENCE && isAnchorType(hit.type))
        .map((hit) => hit.slug),
    ),
  ];
}

/**
 * Selects the pages to read to answer: the exact matches of the search and the page at the
 * object's conventional address (`gbrain_anchor_shape.slug_prefixes`). The address does not
 * depend on the index, while search lags behind a write. A page to which an event or a fact has
 * just been added is not found by id for a while, and an empty search response does not yet
 * mean there is no anchor.
 */
export function slugsToRead(
  hits: readonly SearchHit[],
  type: AnchorType,
  notionId: string,
): string[] {
  return [...new Set([anchorSlug(type, notionId), ...candidateSlugs(hits)])];
}

/**
 * Resolves the anchor of a Notion object from the candidates read. A page becomes an anchor not
 * because search found it but because its `frontmatter.notion_id` is this id (in canonical
 * form, because a different spelling does not make a different id). Exactly one matching page
 * yields `exact`; none yields `absent`; more than one yields `integrity_error`. In that case
 * none is chosen, because a choice between two pages would be a guess.
 */
export function resolveAnchor(notionId: string, candidates: readonly PageRead[]): AnchorIdentity {
  const id = canonicalIdOf(notionId);
  const slugs = [
    ...new Set(
      candidates
        .filter((page) => !page.deleted && describeAnchor(page)?.notionId === id)
        .map((page) => page.slug),
    ),
  ].sort();

  switch (slugs.length) {
    case 0:
      return { state: 'absent' };

    case 1:
      return { state: 'exact', slug: slugs[0] ?? '' };

    default:
      return { state: 'integrity_error', slugs };
  }
}

/**
 * Where a write about a Notion object goes: onto its anchor (`exact`), into a new anchor at the
 * conventional address (`create`), or nowhere. With several anchors (`integrity_error`) none is
 * chosen. A page at the address that is not this object's anchor makes the address `occupied`,
 * and so does a deleted page. Writing a page would replace the one at the address entirely, so
 * the new anchor is not written there.
 *
 * `candidates` is what was read according to `slugsToRead`: it always contains the conventional
 * address.
 */
export type AnchorPlacement =
  | { readonly state: 'exact'; readonly slug: string }
  | { readonly state: 'create'; readonly slug: string }
  | { readonly state: 'integrity_error'; readonly slugs: readonly string[] }
  | { readonly state: 'occupied'; readonly slug: string };

export function anchorPlacement(
  type: AnchorType,
  notionId: string,
  candidates: readonly PageRead[],
): AnchorPlacement {
  const identity = resolveAnchor(notionId, candidates);

  switch (identity.state) {
    case 'exact':
    case 'integrity_error':
      return identity;

    case 'absent': {
      const slug = anchorSlug(type, notionId);
      const taken = candidates.some((page) => page.slug.toLowerCase() === slug);

      return taken ? { state: 'occupied', slug } : { state: 'create', slug };
    }
  }
}
