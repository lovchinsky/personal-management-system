/**
 * The types of canonical anchors and what the convention names by type. Together they mirror
 * the contract (`contracts/canonical.yaml`, keys `gbrain_anchor_types` and
 * `gbrain_anchor_shape`). The running App does not read contracts, so the contract is
 * implemented here as constants, and a contract test enforces agreement with it (`INV-097`).
 *
 * `Principle`, `Key Result` and `Task` are not anchor types. Key Result evidence is the current
 * state of a managed object, and that belongs in Notion (`docs/2-system.md` § “Canonical
 * anchors”).
 */
export const ANCHOR_TYPES = [
  'project',
  'behavior_system',
  'objective',
  'area_of_focus',
  'identity',
] as const;

export type AnchorType = (typeof ANCHOR_TYPES)[number];

export function isAnchorType(value: string): value is AnchorType {
  return ANCHOR_TYPES.some((type) => type === value);
}

/** The slug directory for each type: `<prefix>/<notion_id without hyphens>`. */
export const SLUG_PREFIXES: Readonly<Record<AnchorType, string>> = {
  project: 'projects',
  behavior_system: 'behavior-systems',
  objective: 'objectives',
  area_of_focus: 'areas-of-focus',
  identity: 'identities',
};

/** Frontmatter keys an anchor does not have: GBrain reserves `id` for page deduplication. */
export const FORBIDDEN_FRONTMATTER_KEYS: readonly string[] = ['id'];

/** The label of the identity line in the body: `Notion: <notion_id>`. */
export const IDENTITY_LINE_LABEL = 'Notion:';
