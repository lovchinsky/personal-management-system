/** A client the owner has just connected: the name it gave itself and the host it returns to. */
export interface ConnectedClient {
  readonly name: string;
  readonly redirectHost: string;
}

/**
 * The port for the client notice, which tells the owner a client has connected. Delivery
 * implements it, because `mcp/` knows neither channels nor the queue. Without an adapter, the port
 * is implemented by `AbsentClientNotice`.
 *
 * The owner passphrase is the only factor of consent, so every connection must be visible: an
 * owner who connected nothing learns of someone else's connection from this notice, not from the
 * consequences.
 */
export interface ClientNotice {
  connected(client: ConnectedClient): Promise<void>;
}

export const CLIENT_NOTICE = Symbol('ClientNotice');

/** The injection token under which an adapter substitutes itself from outside `mcp/`. */
export const CLIENT_NOTICE_ADAPTER = Symbol('ClientNoticeAdapter');

/** The client notice for wiring without delivery, where there is no one to tell. */
export class AbsentClientNotice implements ClientNotice {
  connected(): Promise<void> {
    return Promise.resolve();
  }
}
