import { differenceInMilliseconds } from 'date-fns';

/**
 * Checks whether a token that expires at `expiresAt` will still be valid for at least
 * `validForMs`.
 *
 * A run sets the token in one header for its whole duration, so it asks for validity that covers
 * the ticket, with a margin. A token that expires in the middle of a run means the run loses its
 * server partway through its work.
 */
export function lastsFor(expiresAt: Date, validForMs: number): boolean {
  return differenceInMilliseconds(expiresAt, new Date()) >= validForMs;
}
