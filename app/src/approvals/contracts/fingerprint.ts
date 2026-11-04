import { createHash } from 'node:crypto';

/**
 * The fingerprint of a proposal's effects, that is, of what will change.
 *
 * Keys are sorted recursively, and the effects are sorted relative to one another: the same change
 * written in a different order of fields or effects is still the same change, and two open rows
 * for it would mean two identical messages to the person. The order of effects changes nothing,
 * because a proposal consists of changes to one page with no repeated property
 * (`proposal.validity`). Preconditions are not part of the fingerprint: the same change with a
 * different check remains the same change (`contracts/canonical.yaml`, key `pending_action`).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => byCodeUnit(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }

  return value;
}

/**
 * Compares two strings by character code, not by the process locale, because the fingerprint of a
 * row written in one process must match the fingerprint another process computes.
 */
function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;

  return left > right ? 1 : 0;
}

export function fingerprintOf(effects: readonly unknown[]): string {
  const canonical = effects
    .map(canonicalize)
    .sort((left, right) => byCodeUnit(JSON.stringify(left), JSON.stringify(right)));

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
