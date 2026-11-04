import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sameSecret } from './token-digest';

/** A `code_verifier` per RFC 7636: 43–128 characters from a limited set. */
export const codeVerifierSchema = z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/);

/**
 * A `code_challenge` of the S256 method: base64url of the verifier's SHA-256, without padding,
 * which is 43 characters long.
 */
export const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9\-_]{43}$/);

/** Returns the challenge that the verifier would produce under the S256 method. */
function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Checks whether the verifier proves that whoever redeems the code is the one who asked for it.
 * The App accepts no method other than S256, because `plain` does not protect against code
 * interception.
 */
export function provesChallenge(verifier: string, challenge: string): boolean {
  return (
    codeVerifierSchema.safeParse(verifier).success && sameSecret(challengeOf(verifier), challenge)
  );
}
