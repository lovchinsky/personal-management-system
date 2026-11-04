import { AppError } from '../../platform/error/app-error';

/**
 * OAuth protocol errors as RFC 6749 and RFC 7591 name them: a code, a description and the
 * response status. An OAuth client reads the `error` in the body, not the message, so this is a
 * protocol contract, not text for a person.
 */
type OauthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'invalid_target'
  | 'access_denied'
  | 'temporarily_unavailable';

export class OauthError extends AppError {
  constructor(
    readonly code: OauthErrorCode,
    readonly description: string,
    readonly status = 400,
  ) {
    super(`${code}: ${description}`);
  }
}

/** The owner passphrase did not match, so the consent page is shown again with a refusal. */
export class OwnerRefusedError extends AppError {
  constructor() {
    super('the owner passphrase was refused');
  }
}

/**
 * The lock is closed after failed attempts (`OwnerLock`), so the consent page is shown again with
 * how long to wait. This is a message to the owner, not to the protocol, because an OAuth client
 * does not read the consent page.
 */
export class OwnerLockedError extends AppError {
  constructor(readonly seconds: number) {
    super(`the owner check is locked for ${seconds} seconds`);
  }
}
