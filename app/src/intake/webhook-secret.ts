import { timingSafeEqual } from 'node:crypto';

/**
 * Checks whether the request's secret matches the expected one, in constant time, because a
 * comparison that returns at the first differing character would give the secret away character
 * by character. A different length alone means “no match”.
 */
export function sameSecret(provided: string, expected: string): boolean {
  const given = Buffer.from(provided);
  const wanted = Buffer.from(expected);

  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
