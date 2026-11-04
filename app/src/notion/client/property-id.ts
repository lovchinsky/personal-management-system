declare const canonical: unique symbol;

/**
 * A property ID in canonical form, which means decoded. There is one form for comparison.
 *
 * A string is converted **once, at input**, and how it is converted depends on the source, not on
 * the content: decoding is not idempotent (`x%252F` → `x%2F` → `x/`) (`docs/2-system.md`
 * § “Webhook intake”). The type has a brand that only the constructors below attach, so the
 * compiler will not allow comparing a canonical ID with a raw string.
 */
export type PropertyId = string & { readonly [canonical]: true };

/** A string that has not become a `PropertyId` yet: it cannot be decoded a second time. */
type Unbranded<S extends string> = S extends PropertyId ? never : S;

function decodedOnce(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Converts an ID from the binding. The file keeps IDs percent-encoded, and a malformed sequence in
 * it is an error in the file. In that case the result is `null`, so that the binding reports the
 * error at load time.
 */
export function propertyIdFromBinding<S extends string>(spelled: Unbranded<S>): PropertyId | null {
  const id = decodedOnce(spelled);

  return id === null ? null : (id as PropertyId);
}

/**
 * Converts an ID from Notion, whether it comes from REST or the webhook.
 *
 * The ID is decoded exactly once and **without exceptions**: a malformed sequence leaves the string
 * as it is. An exception here would mean a 500 on the webhook and provider redeliveries, and on a
 * page read it would mean an action that the executor retries forever.
 */
export function propertyIdFromNotion<S extends string>(wire: Unbranded<S>): PropertyId {
  return (decodedOnce(wire) ?? wire) as PropertyId;
}

/**
 * Creates an ID from what is already canonical: database rows, the run envelope, a stored
 * proposal.
 *
 * A proposal from the model belongs here too: the model sees only canonical IDs (the envelope,
 * `get_schema_mapping`). The form cannot be guessed from the content here, because decoding is not
 * idempotent. So a proposal does not accept an ID that looks encoded at all (`changedByDecoding`)
 * instead of converting it by guesswork.
 */
export function propertyIdFromCanonical(id: string): PropertyId {
  return id as PropertyId;
}

/**
 * Checks whether decoding would change this string, that is, whether it looks encoded.
 *
 * It is meant for input whose form must be canonical: an ID that looks encoded there is a fault of
 * whoever composed it, and the fault needs to be reported at once, not after the person approves
 * an action that will not find its property.
 */
export function changedByDecoding(id: string): boolean {
  const decoded = decodedOnce(id);

  return decoded !== null && decoded !== id;
}
