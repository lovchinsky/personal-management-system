import { APIErrorCode, isNotionClientError } from '@notionhq/client';
import {
  BotIdentityUnknownError,
  isNotionUnavailable,
  isObjectNotFound,
  NotionAccessError,
} from '../client/notion.error';
import { AdapterConfigurationError } from './adapter.error';

/**
 * What a Notion read failure means to whoever was reading. The class decides what to do next:
 * wait until next time, leave the object without a conclusion, or fix the binding.
 *
 * - `transient` means Notion did not answer on the merits: rate limit, failure, timeout, network.
 *   It says nothing about the state of the workspace and goes away on its own.
 * - `absent` means the object does not exist or is not shared with the integration.
 * - `no_access` means the integration lacks access: the token was not accepted (401), the object
 *   is closed to it (403) or Notion returned it without content. It does not go away on its own
 *   (ADR 0044).
 * - `misconfigured` means the binding is unusable, or Notion rejected a query built from it. A
 *   retry changes nothing until the binding is edited.
 * - `unknown` is everything else, including an error in App code.
 */
export type NotionFailure = 'transient' | 'absent' | 'no_access' | 'misconfigured' | 'unknown';

/**
 * Notion responses that say something about the integration's access, not about a momentary
 * condition: the token and a closed object.
 */
const NO_ACCESS: ReadonlySet<string> = new Set([
  APIErrorCode.Unauthorized,
  APIErrorCode.RestrictedResource,
]);

export function notionFailureOf(error: unknown): NotionFailure {
  // A write refused because Notion did not say who we are is the same failure as the one that
  // caused it.
  if (error instanceof BotIdentityUnknownError) return notionFailureOf(error.cause);
  if (isNotionClientError(error) && NO_ACCESS.has(error.code)) return 'no_access';
  if (isNotionUnavailable(error)) return 'transient';
  // The Notion client does not wrap a network failure: `fetch` throws it as is.
  if (error instanceof TypeError && error.message === 'fetch failed') return 'transient';
  if (isObjectNotFound(error)) return 'absent';
  if (error instanceof NotionAccessError) return 'no_access';
  if (error instanceof AdapterConfigurationError) return 'misconfigured';
  if (isNotionClientError(error) && error.code === APIErrorCode.ValidationError) {
    return 'misconfigured';
  }

  return 'unknown';
}

/**
 * Checks whether the failure says something the person running the installation must see: the
 * binding needs fixing, and an unknown failure may be an App error. The rest is a state of Notion
 * that goes away on its own.
 */
export function needsAttention(failure: NotionFailure): boolean {
  switch (failure) {
    case 'transient':
    case 'absent':
    case 'no_access':
      return false;

    case 'misconfigured':
    case 'unknown':
      return true;
  }
}
