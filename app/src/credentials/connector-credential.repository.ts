import { Injectable } from '@nestjs/common';
import { addMilliseconds, differenceInMilliseconds } from 'date-fns';
import { ConnectorCredential, Prisma } from '../generated/prisma/client';
import { Connector } from '../generated/prisma/enums';
import { PrismaService } from '../platform/db/prisma.service';
import { SecretBox } from './secret-box';

export interface ConnectorTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  /** A `client_credentials` grant has none, and that is a normal state, not a missing field. */
  readonly refreshToken?: string;
  readonly scope?: string;
}

/** The grant as issued by the person's authorization. */
export interface Authorization extends ConnectorTokens {
  /** The public client on whose behalf the grant is refreshed. */
  readonly clientId?: string;
  /** When the person authorized. */
  readonly obtainedAt: Date;
  /** When the tokens were last issued. */
  readonly refreshedAt: Date;
}

/** A grant's times without its secrets. The times show whether the grant is alive. */
export type GrantMoments = Pick<
  Authorization,
  'obtainedAt' | 'refreshedAt' | 'accessTokenExpiresAt'
>;

/**
 * A grant under the lock on its row. Whoever holds the lock is currently the only one who can
 * refresh the grant.
 */
export interface LockedGrant {
  /** `null` means the connector is not authorized. */
  readonly current: Authorization | null;
  /**
   * Writes the refreshed tokens in the same transaction that holds the lock. The result is the
   * grant after the write.
   */
  readonly renew: (tokens: ConnectorTokens) => Promise<Authorization>;
  /**
   * How much longer the transaction that holds the lock will last. After that nothing can be
   * written any more. The wait for the lock has also counted against this time.
   */
  readonly remainingMs: () => number;
}

/**
 * How long a transaction may hold the row lock.
 *
 * The provider request runs inside it, so the limit must be noticeably longer than the request
 * timeout: a transaction that closes before the rotated tokens are written leaves no way back,
 * because the provider has already revoked the prior refresh token. The timer runs from the start
 * of the transaction, so the wait for the lock counts against it.
 */
const LOCK_HOLD_MS = 90_000;

/**
 * The authorization state of the connectors, encrypted field by field. The PKCE `code_verifier`
 * is not stored here; see `docs/2-system.md` § “`connector_credentials`”.
 */
@Injectable()
export class ConnectorCredentialRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretBox,
  ) {}

  /**
   * Writes the authorization grant whole, together with the time of authorization.
   *
   * Authorizing again rewrites the row instead of extending it: the grant's ceiling is measured
   * from the new authorization, and the refresh token and client of the earlier authorization no
   * longer make sense. So an absent value here means “none” and is written as `null`.
   */
  async authorize(connector: Connector, grant: Authorization): Promise<void> {
    const data = {
      clientId: grant.clientId ?? null,
      ...this.sealed(connector, grant),
      refreshToken: this.sealedRefresh(connector, grant.refreshToken) ?? null,
      scope: grant.scope ?? null,
      obtainedAt: grant.obtainedAt,
      refreshedAt: grant.refreshedAt,
    };

    await this.prisma.connectorCredential.upsert({
      where: { connector },
      create: { connector, ...data },
      update: data,
    });
  }

  /** `null` means “the connector is not authorized”, not a failure. */
  async load(connector: Connector): Promise<Authorization | null> {
    const row = await this.prisma.connectorCredential.findUnique({ where: { connector } });

    return row && this.opened(row);
  }

  /**
   * Returns the times of the grant without decryption: no secrets are needed for this. `null` means
   * “the connector is not authorized”.
   */
  moments(connector: Connector): Promise<GrantMoments | null> {
    return this.prisma.connectorCredential.findUnique({
      where: { connector },
      select: { obtainedAt: true, refreshedAt: true, accessTokenExpiresAt: true },
    });
  }

  /**
   * Refreshes the grant under the lock on its row.
   *
   * A refresh rotates the refresh token and revokes the prior one, so two parties refreshing at
   * once would spend the same token. Whichever wrote second would leave the database holding a
   * token already revoked. With the lock there is a single refresher: whoever waited gets the row
   * already refreshed and sees there is nothing to refresh.
   *
   * The lock is on the row, not the table: an unauthorized connector has nothing to lock, and
   * `work` receives `current: null`.
   */
  withLock<T>(connector: Connector, work: (grant: LockedGrant) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const expiresAt = addMilliseconds(new Date(), LOCK_HOLD_MS);

        await tx.$queryRaw`
          SELECT "connector" FROM "connector_credentials"
           WHERE "connector" = ${connector}::"Connector"
             FOR UPDATE
        `;

        const row = await tx.connectorCredential.findUnique({ where: { connector } });

        return work({
          current: row && this.opened(row),
          renew: (tokens) => this.renew(tx, connector, tokens),
          remainingMs: () => differenceInMilliseconds(expiresAt, new Date()),
        });
      },
      { timeout: LOCK_HOLD_MS },
    );
  }

  /**
   * A renewal keeps the time of authorization, because the ceiling is measured from it, not from
   * the last refresh.
   *
   * A field the response does not include is not overwritten. A renewal without rotation returns
   * neither `refresh_token` nor `scope`. They simply did not change, and that is a normal
   * response, not an empty one. Writing `null` there would turn a successful renewal into a lost
   * authorization. In Prisma, `undefined` means “do not touch”.
   */
  private async renew(
    tx: Prisma.TransactionClient,
    connector: Connector,
    tokens: ConnectorTokens,
  ): Promise<Authorization> {
    const row = await tx.connectorCredential.update({
      where: { connector },
      data: {
        ...this.sealed(connector, tokens),
        refreshToken: this.sealedRefresh(connector, tokens.refreshToken),
        scope: tokens.scope,
        refreshedAt: new Date(),
      },
    });

    return this.opened(row);
  }

  private sealed(
    connector: Connector,
    tokens: ConnectorTokens,
  ): Pick<ConnectorCredential, 'accessToken' | 'accessTokenExpiresAt'> {
    return {
      accessToken: this.secrets.seal(tokens.accessToken, context(connector, 'access_token')),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    };
  }

  /** Seals the refresh token for its own place, or returns `undefined` when there is none. */
  private sealedRefresh(connector: Connector, token: string | undefined): string | undefined {
    return token ? this.secrets.seal(token, context(connector, 'refresh_token')) : undefined;
  }

  private opened(row: ConnectorCredential): Authorization {
    return {
      clientId: row.clientId ?? undefined,
      accessToken: this.secrets.open(row.accessToken, context(row.connector, 'access_token')),
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      refreshToken: row.refreshToken
        ? this.secrets.open(row.refreshToken, context(row.connector, 'refresh_token'))
        : undefined,
      scope: row.scope ?? undefined,
      obtainedAt: row.obtainedAt,
      refreshedAt: row.refreshedAt,
    };
  }
}

/** Returns the place of a value: the connector and the column. It binds the ciphertext to them. */
function context(connector: Connector, field: 'access_token' | 'refresh_token'): string {
  return `${connector}:${field}`;
}
