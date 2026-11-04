import { Connector } from '../generated/prisma/enums';
import { AppError } from '../platform/error/app-error';

/**
 * The connector's provider is not responding at the moment: network, timeout, server failure or
 * “wait”.
 *
 * The error has a class of its own because it clears on its own, unlike
 * `ConnectorUnauthorizedError`. When a run's access does not refresh because the provider is not
 * responding, the App retries the run later instead of failing it (ADR 0045).
 */
export class ConnectorUnavailableError extends AppError {
  constructor(
    readonly connector: Connector,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`${connector} is unavailable: ${reason}`, options);
  }
}
