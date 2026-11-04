import { Connector } from '../generated/prisma/enums';
import { AppError } from '../platform/error/app-error';

/**
 * The connector is not authorized, or the provider no longer recognizes its grant.
 *
 * The error has a class of its own because it is not a failure that clears on its own. A retry
 * does not help here, and only the person can fix the state, by authorizing again.
 */
export class ConnectorUnauthorizedError extends AppError {
  constructor(
    readonly connector: Connector,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`${connector} needs authorization: ${reason} — RUNBOOK §6.3`, options);
  }
}
