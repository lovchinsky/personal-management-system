import { stringify } from 'yaml';
import { canonicalNotionId, isNotionId } from '../notion/client/notion-id';
import {
  FORBIDDEN_FRONTMATTER_KEYS,
  IDENTITY_LINE_LABEL,
  isAnchorType,
  SLUG_PREFIXES,
  type AnchorType,
} from './anchor-types';
import type { PageRead } from './gbrain-pages';

/** What an anchor says about itself: which Notion object it stands for. */
export interface AnchorDescription {
  readonly type: AnchorType;
  readonly title: string;
  /** The hyphenated canonical form. */
  readonly notionId: string;
  readonly aliases: readonly string[];
}

/** The description plus what the body of a new anchor holds after the identity line. */
export interface AnchorSpec extends AnchorDescription {
  /** The paragraphs of compiled truth. */
  readonly paragraphs: readonly string[];
}

/**
 * Returns the slug of an anchor: `<type prefix>/<notion_id without hyphens>`
 * (`gbrain_anchor_shape.slug_prefixes`).
 */
export function anchorSlug(type: AnchorType, notionId: string): string {
  return `${SLUG_PREFIXES[type]}/${canonicalIdOf(notionId).replaceAll('-', '')}`;
}

export function canonicalIdOf(notionId: string): string {
  if (!isNotionId(notionId)) throw new RangeError(`${notionId} is not a Notion page id`);

  return canonicalNotionId(notionId);
}

/**
 * Renders the page content for `put_page`: frontmatter, title, identity line and paragraphs.
 * YAML serializes the frontmatter instead of string concatenation, so a title with a colon or
 * a quote stays a value and does not break the block.
 */
export function renderAnchor(spec: AnchorSpec): string {
  const id = canonicalIdOf(spec.notionId);
  const frontmatter = stringify({
    type: spec.type,
    title: spec.title,
    notion_id: id,
    aliases: [...spec.aliases],
  }).trimEnd();

  return [
    '---',
    frontmatter,
    '---',
    '',
    `# ${spec.title}`,
    '',
    `${IDENTITY_LINE_LABEL} ${id}`,
    ...spec.paragraphs.flatMap((paragraph) => ['', paragraph]),
    '',
  ].join('\n');
}

/** What a page lacks to be an anchor of its type under the convention. */
type AnchorViolationCode =
  | 'type_not_anchor'
  | 'notion_id_missing'
  | 'notion_id_invalid'
  | 'notion_id_not_canonical'
  | 'slug_mismatch'
  | 'forbidden_key'
  | 'title_empty'
  | 'aliases_missing'
  | 'aliases_invalid'
  | 'identity_line_missing'
  | 'identity_line_mismatch';

export interface AnchorViolation {
  readonly code: AnchorViolationCode;
  readonly detail: string;
}

/**
 * A whole body line: label, space, one value. A line break does not join two lines into an
 * identity line.
 */
const IDENTITY_LINE = new RegExp(`^${IDENTITY_LINE_LABEL}[ \\t]*(\\S+)[ \\t]*$`, 'gm');

function notionIdOf(page: PageRead): string | null {
  const value = page.frontmatter['notion_id'];

  return typeof value === 'string' && isNotionId(value.trim())
    ? canonicalNotionId(value.trim())
    : null;
}

/**
 * Reads which Notion object the page stands for. Returns `null` when the page does not say:
 * the type is not an anchor type, or `notion_id` is absent or is not a Notion id.
 */
export function describeAnchor(page: PageRead): AnchorDescription | null {
  const notionId = notionIdOf(page);

  if (!isAnchorType(page.type) || notionId === null) return null;

  const aliases = page.frontmatter['aliases'];

  return {
    type: page.type,
    title: page.title,
    notionId,
    aliases: Array.isArray(aliases)
      ? aliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
  };
}

/**
 * Lists the page's deviations from the anchor convention; an empty list means the page conforms.
 * Identity (whose anchor it is) is decided by `resolveAnchor`; only the shape is checked here.
 */
export function checkAnchor(page: PageRead): AnchorViolation[] {
  const violations: AnchorViolation[] = [];
  const add = (code: AnchorViolationCode, detail: string): void => {
    violations.push({ code, detail });
  };

  const type = isAnchorType(page.type) ? page.type : null;

  if (type === null) add('type_not_anchor', `type ${page.type}`);

  for (const key of FORBIDDEN_FRONTMATTER_KEYS) {
    if (key in page.frontmatter) add('forbidden_key', key);
  }

  if (page.title.trim() === '') add('title_empty', page.slug);

  const aliases = page.frontmatter['aliases'];

  if (aliases === undefined) {
    add('aliases_missing', page.slug);
  } else if (!(Array.isArray(aliases) && aliases.every((a) => typeof a === 'string'))) {
    add('aliases_invalid', 'aliases is not a list of strings');
  }

  const raw = page.frontmatter['notion_id'];
  const notionId = notionIdOf(page);

  if (typeof raw !== 'string' || raw.trim() === '') {
    add('notion_id_missing', page.slug);
  } else if (notionId === null) {
    add('notion_id_invalid', raw);
  } else if (raw !== notionId) {
    add('notion_id_not_canonical', raw);
  }

  if (type !== null && notionId !== null && page.slug !== anchorSlug(type, notionId)) {
    add('slug_mismatch', `${page.slug}, expected ${anchorSlug(type, notionId)}`);
  }

  // A line with another value (a link, a word) is not an identity line, because it names no id.
  const lines = [...page.compiledTruth.matchAll(IDENTITY_LINE)]
    .map(([, value]) => value ?? '')
    .filter(isNotionId);

  if (lines.length === 0) {
    add('identity_line_missing', `no "${IDENTITY_LINE_LABEL} <id>" line`);
  } else if (notionId !== null && lines.some((id) => canonicalNotionId(id) !== notionId)) {
    add('identity_line_mismatch', lines.join(', '));
  }

  return violations;
}
