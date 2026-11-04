import { Injectable } from '@nestjs/common';
import { addDays, addMinutes, isAfter } from 'date-fns';
import {
  Authorization,
  ConnectorCredentialRepository,
  GrantMoments,
} from '../connector-credential.repository';
import { ConnectorUnauthorizedError } from '../connector-unauthorized.error';
import { ConnectorUnavailableError } from '../connector-unavailable.error';
import { lastsFor } from '../token-lifetime';
import {
  GrantedAuthorization,
  NOTION_MCP,
  NotionMcpOAuth,
  PROVIDER_TIMEOUT_MS,
} from './notion-mcp.oauth';

/**
 * The limits on a grant that the provider sets, measured against the live provider
 * (`docs/2-system.md` § “Integration contract Notion”). None of them is ours: we only have to
 * stay ahead of them.
 */
const INACTIVITY_LIMIT_DAYS = 30;
const CEILING_DAYS = 180;

/**
 * The keepalive refreshes a grant that has gone this long without a refresh. A margin of three
 * weeks before the inactivity limit covers even a week-long App outage.
 */
const KEEPALIVE_AFTER_DAYS = 7;

/**
 * How much time the transaction must have left after the provider's response to write the
 * rotated tokens. It also covers the difference between the transaction timer and our count from
 * the start of the transaction's work.
 */
const WRITE_MARGIN_MS = 10_000;

/**
 * How long access is not refreshed again after a provider refusal that clears on its own.
 * Without the pause, every run waiting for Notion would refresh the token by itself, and a
 * refresh whose response was lost rotates the refresh token and kills the grant.
 */
const UNAVAILABLE_COOLDOWN_MINUTES = 2;

/** How a run asks for access. */
interface AccessRequest {
  /**
   * Skip the pause after a provider refusal. This is for a wake whose time the person named: its
   * three attempts fit within half a minute, and the pause would disrupt the reminder during a
   * one-minute outage.
   */
  readonly bypassCooldown?: boolean;
}

/** The state of the grant, without any secret: what can be shown to the person or the gate. */
export interface GrantStatus {
  readonly obtainedAt: Date;
  readonly refreshedAt: Date;
  readonly accessTokenExpiresAt: Date;
  /** After this time the grant is dead unless it is refreshed. */
  readonly inactiveAfter: Date;
  /** After this time the grant is dead in any case, so the person is needed. */
  readonly ceilingAt: Date;
}

/** Whether the grant can still serve a run and, if not, why. */
export type GrantLiveness =
  { readonly alive: true } | { readonly alive: false; readonly reason: string };

/** What the keepalive did. */
export type KeepAlive =
  | { readonly kind: 'absent' }
  | { readonly kind: 'fresh' | 'refreshed'; readonly status: GrantStatus };

/**
 * The grant of the App-triggered Notion MCP: where a run gets its access token and who sees to it
 * that the grant does not die.
 *
 * Only this service refreshes the grant, and only under the lock on its row. It refreshes
 * rarely: when the token does not cover the run's duration and when the grant has gone a week
 * without a refresh. Every refresh rotates the refresh token, and a failure between the
 * provider's response and the write kills the grant, so an unnecessary refresh is not free.
 */
@Injectable()
export class NotionMcpGrant {
  /** The time until which access is not refreshed after a provider refusal, and that refusal. */
  private unavailable?: { readonly until: Date; readonly error: ConnectorUnavailableError };

  constructor(
    private readonly credentials: ConnectorCredentialRepository,
    private readonly oauth: NotionMcpOAuth,
  ) {}

  /** Returns the URL of the server the grant is issued for. */
  serverUrl(): string {
    return this.oauth.serverUrl();
  }

  /**
   * Returns an access token that will stay valid for at least `validForMs` (`lastsFor`).
   *
   * While the pause after a provider refusal lasts, a token with too little time left is not
   * refreshed: the call gets the same refusal without contacting the provider
   * (`UNAVAILABLE_COOLDOWN_MINUTES`).
   */
  async accessToken(validForMs: number, request: AccessRequest = {}): Promise<string> {
    const lasting = (grant: Authorization): boolean =>
      lastsFor(grant.accessTokenExpiresAt, validForMs);

    const current = await this.credentials.load(NOTION_MCP);
    if (!current) {
      throw new ConnectorUnauthorizedError(NOTION_MCP, 'not authorized');
    }

    if (lasting(current)) return current.accessToken;

    const cooling = this.unavailable;
    if (cooling && !request.bypassCooldown && isAfter(cooling.until, new Date())) {
      throw cooling.error;
    }

    const { grant } = await this.renewUnless(lasting);

    if (!lasting(grant)) {
      throw new Error(`Notion MCP issued a token shorter than the ${validForMs} ms a run needs`);
    }

    return grant.accessToken;
  }

  /**
   * Refreshes a grant that has gone a week without a refresh, whether or not anyone needs it at
   * the moment (`NotionMcpKeepalive`).
   */
  async keepAlive(): Promise<KeepAlive> {
    const recent = (grant: Authorization): boolean =>
      isAfter(addDays(grant.refreshedAt, KEEPALIVE_AFTER_DAYS), new Date());

    const current = await this.credentials.load(NOTION_MCP);
    if (!current) {
      return { kind: 'absent' };
    }

    if (recent(current)) return { kind: 'fresh', status: statusOf(current) };

    const { grant, renewed } = await this.renewUnless(recent);

    return { kind: renewed ? 'refreshed' : 'fresh', status: statusOf(grant) };
  }

  /** Refreshes the grant immediately, as a check that refreshing works (RUNBOOK §6.3). */
  async refresh(): Promise<GrantStatus> {
    const { grant } = await this.renewUnless(() => false);

    return statusOf(grant);
  }

  async status(): Promise<GrantStatus | null> {
    const moments = await this.credentials.moments(NOTION_MCP);

    return moments && statusOf(moments);
  }

  /**
   * Reports whether the grant can still serve a run. It can when it is authorized and not dead:
   * it has neither gone inactive nor reached its ceiling. Only the person can bring a dead grant
   * back, so a run without a live grant is a denial before admission, not a failure (`INV-309`).
   *
   * A live grant may still lack a fresh access token: whoever takes the token refreshes it
   * (`accessToken`).
   */
  async liveness(at: Date = new Date()): Promise<GrantLiveness> {
    const moments = await this.credentials.moments(NOTION_MCP);
    if (!moments) {
      return { alive: false, reason: 'Notion MCP is not authorized' };
    }

    const death = deathOf(statusOf(moments), at);

    return death
      ? { alive: false, reason: `the Notion MCP grant ${death} — authorize it again` }
      : { alive: true };
  }

  /**
   * Writes the authorization the person has just completed.
   *
   * The grant is rewritten whole, because the ceiling is measured from this authorization, not
   * from the first one.
   */
  async authorize(granted: GrantedAuthorization): Promise<GrantStatus> {
    const now = new Date();
    const authorization: Authorization = {
      ...granted.tokens,
      clientId: granted.clientId,
      obtainedAt: now,
      refreshedAt: now,
    };

    await this.credentials.authorize(NOTION_MCP, authorization);

    return statusOf(authorization);
  }

  /**
   * Refreshes the grant unless `settled` says it is no longer needed, and remembers a provider
   * refusal that clears on its own: `accessToken` answers it with a pause. A successful refresh
   * clears the pause.
   */
  private async renewUnless(
    settled: (grant: Authorization) => boolean,
  ): Promise<{ readonly grant: Authorization; readonly renewed: boolean }> {
    try {
      const renewed = await this.renewLocked(settled);

      this.unavailable = undefined;

      return renewed;
    } catch (error) {
      if (error instanceof ConnectorUnavailableError) {
        this.unavailable = { until: addMinutes(new Date(), UNAVAILABLE_COOLDOWN_MINUTES), error };
      }

      throw error;
    }
  }

  /**
   * Refreshes the grant under the lock.
   *
   * The check is repeated under the lock: whoever held it before us may have refreshed already,
   * and a second refresh in a row would only spend a rotation.
   *
   * Under the lock there is only one provider request, and only when the transaction is
   * guaranteed to outlive it together with the write. Rotation revokes the prior refresh token at
   * that same instant, so tokens with nowhere left to be written are a dead grant: declining to
   * refresh is cheaper than refreshing too late.
   */
  private async renewLocked(
    settled: (grant: Authorization) => boolean,
  ): Promise<{ readonly grant: Authorization; readonly renewed: boolean }> {
    const server = await this.oauth.authorizationServer();

    return this.credentials.withLock(NOTION_MCP, async ({ current, renew, remainingMs }) => {
      if (!current) throw new ConnectorUnauthorizedError(NOTION_MCP, 'not authorized');

      if (settled(current)) return { grant: current, renewed: false };

      if (!current.clientId || !current.refreshToken) {
        throw new ConnectorUnauthorizedError(NOTION_MCP, 'the stored grant cannot be refreshed');
      }

      if (remainingMs() < PROVIDER_TIMEOUT_MS + WRITE_MARGIN_MS) {
        throw new Error(
          `${NOTION_MCP}: the grant lock came too late to refresh safely — the grant is untouched`,
        );
      }

      const tokens = await this.oauth.refresh(server, current.clientId, current.refreshToken);

      return { grant: await renew(tokens), renewed: true };
    });
  }
}

function statusOf(grant: GrantMoments): GrantStatus {
  return {
    obtainedAt: grant.obtainedAt,
    refreshedAt: grant.refreshedAt,
    accessTokenExpiresAt: grant.accessTokenExpiresAt,
    inactiveAfter: addDays(grant.refreshedAt, INACTIVITY_LIMIT_DAYS),
    ceilingAt: addDays(grant.obtainedAt, CEILING_DAYS),
  };
}

/** Returns why the grant is dead at the time `at`, or `undefined` while it is alive. */
function deathOf(status: GrantStatus, at: Date): string | undefined {
  if (!isAfter(status.inactiveAfter, at)) {
    return `went inactive at ${status.inactiveAfter.toISOString()}`;
  }

  if (!isAfter(status.ceilingAt, at)) {
    return `reached its ceiling at ${status.ceilingAt.toISOString()}`;
  }

  return undefined;
}
