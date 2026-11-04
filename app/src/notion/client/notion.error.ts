import {
  APIErrorCode,
  ClientErrorCode,
  isNotionClientError,
  type NotionClientError,
} from '@notionhq/client';
import { AppError } from '../../platform/error/app-error';

/**
 * Notion returned an object without content.
 *
 * This is not a semantic resolution error (`contracts/canonical.yaml`, key `adapter_errors`): the
 * binding is correct and the model is complete; the integration simply lacks access to the
 * content. The corpus describes states like this as a degradation.
 */
export class NotionAccessError extends AppError {
  constructor(
    /** What was not read: `page <id>` or `data source <id>`. */
    readonly object: string,
    detail: string,
  ) {
    super(`Notion returned no content for ${object} — ${detail}`);
  }
}

/** A system write to Notion, as the refusal names it. */
export type WriteOperation = 'comment' | 'creation of page' | 'update of page' | 'archive of page';

/**
 * Notion accepted the system's write but did not confirm it in the response: the author is not the
 * integration bot, or what was written cannot be read from the response.
 *
 * The write took place, so this is not a request failure, and a retry is not a recovery. It is
 * not a success either: the system's own writes are recognized by their author and checked
 * against what is read back. The cause is the integration's token or permissions, not the state
 * of the workspace.
 */
export class UnconfirmedWriteError extends AppError {
  constructor(
    operation: WriteOperation,
    /** What Notion created or changed: the write happened, and this is its id. */
    readonly id: string,
    detail: string,
  ) {
    super(`Notion took the ${operation} ${id}, but ${detail}`);
  }
}

/**
 * Notion never said who we are. Without that, there is nothing to check a system write against
 * and nothing to compare an event with, so an unknown identity is a missing dependency, not an
 * answer.
 */
export class BotIdentityUnknownError extends AppError {
  constructor(options?: ErrorOptions) {
    super(
      'the integration bot identity is unknown — Notion did not answer users.me, ' +
        'so neither a write nor an event can be checked for its author',
      options,
    );
  }
}

/**
 * Checks whether Notion answered that the object is not there: it does not exist, or it is not
 * open to the integration. For reading and writing alike it comes to the same thing: for the
 * system the object does not exist.
 */
export function isObjectNotFound(error: unknown): error is NotionClientError {
  return isNotionClientError(error) && error.code === APIErrorCode.ObjectNotFound;
}

/** Responses that say nothing about the workspace: rate limit, failure, timeout, access. */
const UNAVAILABLE: ReadonlySet<string> = new Set([
  APIErrorCode.Unauthorized,
  APIErrorCode.RestrictedResource,
  APIErrorCode.RateLimited,
  APIErrorCode.ConflictError,
  APIErrorCode.InternalServerError,
  APIErrorCode.ServiceOverload,
  APIErrorCode.ServiceUnavailable,
  APIErrorCode.GatewayTimeout,
  ClientErrorCode.RequestTimeout,
  ClientErrorCode.ResponseError,
]);

/**
 * Checks whether Notion failed to answer on the merits. That kind of response says nothing about
 * the state of the workspace, so a decision made about that state stands and the attempt is
 * deferred.
 */
export function isNotionUnavailable(error: unknown): error is NotionClientError {
  return isNotionClientError(error) && UNAVAILABLE.has(error.code);
}
