import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generates a random secret: 256 bits in base64url. The authorization code and the access and
 * refresh tokens are all generated this way: there is no way to guess them, so a slow hash is not
 * needed to store them.
 */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Computes the digest of a secret, which is what is stored in `app_db`. A token is not stored in
 * the database in plaintext, because a database dump or its backup must not be a key to the App
 * MCP (`INV-310`).
 */
export function digestOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Checks whether two secrets match, in a time that does not depend on how many characters matched.
 */
export function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  );
}
