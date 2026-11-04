import { Test } from '@nestjs/testing';
import type { OAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  addHours,
  addMinutes,
  minutesToMilliseconds,
  subDays,
  subMinutes,
  subSeconds,
} from 'date-fns';
import { Connector } from '../../generated/prisma/enums';
import {
  Authorization,
  ConnectorCredentialRepository,
  ConnectorTokens,
  LockedGrant,
} from '../connector-credential.repository';
import { ConnectorUnauthorizedError } from '../connector-unauthorized.error';
import { ConnectorUnavailableError } from '../connector-unavailable.error';
import { GrantLiveness, NotionMcpGrant } from './notion-mcp.grant';
import { NotionMcpOAuth, PROVIDER_TIMEOUT_MS } from './notion-mcp.oauth';

const RUN_NEEDS_MS = minutesToMilliseconds(20);
const SERVER: OAuthServerInfo = { authorizationServerUrl: 'https://auth.notion.test' };

const ROTATED: ConnectorTokens = {
  accessToken: 'access-new',
  accessTokenExpiresAt: addHours(new Date(), 8),
  refreshToken: 'refresh-new',
};

/** Returns a grant that falls short of the run, so it has to be refreshed. */
function expiring(): Authorization {
  return {
    clientId: 'client-1',
    accessToken: 'access-old',
    accessTokenExpiresAt: subMinutes(new Date(), 1),
    refreshToken: 'refresh-old',
    obtainedAt: subDays(new Date(), 10),
    refreshedAt: subDays(new Date(), 1),
  };
}

/**
 * Builds a grant over a stub store and provider, each of which records its own step: lock,
 * discovery, refresh request and write. `refreshed` is the provider's response to the refresh
 * request.
 */
async function grantOver(
  stored: Authorization | null,
  lockRemainingMs: number,
  steps: string[],
  refreshed: () => Promise<ConnectorTokens> = () => Promise.resolve(ROTATED),
): Promise<NotionMcpGrant> {
  const credentials: Pick<ConnectorCredentialRepository, 'load' | 'moments' | 'withLock'> = {
    load: () => Promise.resolve(stored),
    moments: () => Promise.resolve(stored),
    withLock: <T>(_connector: Connector, work: (grant: LockedGrant) => Promise<T>): Promise<T> => {
      steps.push('lock');

      return work({
        current: stored,
        renew: (tokens) => {
          steps.push('renew');

          return Promise.resolve({ ...(stored ?? expiring()), ...tokens, refreshedAt: new Date() });
        },
        remainingMs: () => lockRemainingMs,
      });
    },
  };
  const oauth: Pick<NotionMcpOAuth, 'authorizationServer' | 'refresh'> = {
    authorizationServer: () => {
      steps.push('discover');

      return Promise.resolve(SERVER);
    },
    refresh: () => {
      steps.push('refresh');

      return refreshed();
    },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      NotionMcpGrant,
      { provide: ConnectorCredentialRepository, useValue: credentials },
      { provide: NotionMcpOAuth, useValue: oauth },
    ],
  }).compile();

  return moduleRef.get(NotionMcpGrant);
}

/**
 * Refreshing the grant: rotation revokes the prior refresh token at that same instant, so a
 * refresh whose result has nowhere to be written kills the grant. This file covers the order of
 * the steps and the limit that keeps the request from starting too late; the real locks and
 * provider are in `test/integration/inv-061.spec.ts`.
 */
describe('Notion MCP grant refresh', () => {
  it('runs discovery before the lock and only the refresh request and write under it', async () => {
    const steps: string[] = [];
    const grant = await grantOver(expiring(), 90_000, steps);

    await expect(grant.accessToken(RUN_NEEDS_MS)).resolves.toBe(ROTATED.accessToken);
    expect(steps).toEqual(['discover', 'lock', 'refresh', 'renew']);
  });

  /**
   * A lock obtained too late ends in a refusal, not in a rotation with nowhere left to be
   * written.
   */
  it('does not refresh when the transaction cannot outlive the request and the write', async () => {
    const steps: string[] = [];
    const grant = await grantOver(expiring(), PROVIDER_TIMEOUT_MS + 5_000, steps);

    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toThrow('too late to refresh safely');
    expect(steps).toEqual(['discover', 'lock']);
  });

  it('refuses an unauthorized connector without any request to the provider', async () => {
    const steps: string[] = [];
    const grant = await grantOver(null, 90_000, steps);

    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBeInstanceOf(
      ConnectorUnauthorizedError,
    );
    expect(steps).toEqual([]);
  });
});

/**
 * After a provider refusal that clears on its own (ADR 0045), access is not refreshed again for a
 * few minutes. Otherwise every run waiting for Notion would refresh the token by itself, and a
 * refresh whose response was lost kills the grant.
 */
describe('the pause after a provider refusal', () => {
  const DOWN = new ConnectorUnavailableError('notion_mcp', 'fetch failed');
  const ROUND: readonly string[] = ['discover', 'lock', 'refresh'];

  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers a call that needs a refresh with the same refusal and no provider call', async () => {
    const steps: string[] = [];
    const grant = await grantOver(expiring(), 90_000, steps, () => Promise.reject(DOWN));

    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(DOWN);
    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(DOWN);
    expect(steps).toEqual(ROUND);
  });

  /** A wake's three attempts fit within half a minute: the pause would disrupt the reminder. */
  it('is bypassed by a wake for a time the person named', async () => {
    const steps: string[] = [];
    const grant = await grantOver(expiring(), 90_000, steps, () => Promise.reject(DOWN));

    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(DOWN);
    await expect(grant.accessToken(RUN_NEEDS_MS, { bypassCooldown: true })).rejects.toBe(DOWN);
    expect(steps).toEqual([...ROUND, ...ROUND]);
  });

  it('ends after two minutes', async () => {
    const steps: string[] = [];
    const grant = await grantOver(expiring(), 90_000, steps, () => Promise.reject(DOWN));
    const failedAt = new Date();

    jest.useFakeTimers({
      now: failedAt,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });

    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(DOWN);

    jest.setSystemTime(subSeconds(addMinutes(failedAt, 2), 1));
    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(DOWN);
    expect(steps).toEqual(ROUND);

    jest.setSystemTime(addMinutes(failedAt, 2));
    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(DOWN);
    expect(steps).toEqual([...ROUND, ...ROUND]);
  });

  it('is cleared by a successful refresh', async () => {
    const steps: string[] = [];
    let answer: () => Promise<ConnectorTokens> = () => Promise.reject(DOWN);
    const grant = await grantOver(expiring(), 90_000, steps, () => answer());

    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(DOWN);

    answer = () => Promise.resolve(ROTATED);

    await expect(grant.accessToken(RUN_NEEDS_MS, { bypassCooldown: true })).resolves.toBe(
      ROTATED.accessToken,
    );

    // The store is a stub and still returns the old grant, so the next call refreshes again, this
    // time without the pause.
    await expect(grant.accessToken(RUN_NEEDS_MS)).resolves.toBe(ROTATED.accessToken);
    expect(steps).toEqual([...ROUND, ...ROUND, 'renew', ...ROUND, 'renew']);
  });

  const refusals: [string, Error][] = [
    [
      'a dead grant',
      new ConnectorUnauthorizedError('notion_mcp', 'the provider refused the grant'),
    ],
    ['an unrecognized refusal', new Error('unexpected token response')],
  ];

  /**
   * A dead grant or an unrecognized refusal fails the run instead of making it wait, because
   * neither sets a pause.
   */
  it.each(refusals)('is not set by %s', async (_, refused) => {
    const steps: string[] = [];
    const grant = await grantOver(expiring(), 90_000, steps, () => Promise.reject(refused));

    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(refused);
    await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBe(refused);
    expect(steps).toEqual([...ROUND, ...ROUND]);
  });

  it('still lets a token that is long enough be issued', async () => {
    const steps: string[] = [];
    const halfHour: Authorization = {
      ...expiring(),
      accessTokenExpiresAt: addMinutes(new Date(), 30),
    };
    const grant = await grantOver(halfHour, 90_000, steps, () => Promise.reject(DOWN));

    await expect(grant.accessToken(minutesToMilliseconds(60))).rejects.toBe(DOWN);
    await expect(grant.accessToken(RUN_NEEDS_MS)).resolves.toBe(halfHour.accessToken);
    expect(steps).toEqual(ROUND);
  });
});

/**
 * Whether the grant is alive is a question for its times, not for the provider. Only the person
 * brings a dead grant back, so a run without a live grant is denied before admission (`INV-309`).
 */
describe('Notion MCP grant liveness', () => {
  const at = new Date('2026-09-29T12:00:00.000Z');
  const grantOf = (obtainedDaysAgo: number, refreshedDaysAgo: number): Authorization => ({
    ...expiring(),
    obtainedAt: subDays(at, obtainedDaysAgo),
    refreshedAt: subDays(at, refreshedDaysAgo),
  });

  const cases: [string, Authorization | null, GrantLiveness][] = [
    ['that is fresh', grantOf(10, 1), { alive: true }],
    ['that is unauthorized', null, { alive: false, reason: 'Notion MCP is not authorized' }],
    [
      'that went a month without a refresh',
      grantOf(40, 31),
      { alive: false, reason: expect.stringContaining('went inactive') },
    ],
    [
      'that is past the ceiling',
      grantOf(181, 1),
      { alive: false, reason: expect.stringContaining('reached its ceiling') },
    ],
  ];

  it.each(cases)('for a grant %s', async (_, stored, expected) => {
    const steps: string[] = [];
    const grant = await grantOver(stored, 90_000, steps);

    await expect(grant.liveness(at)).resolves.toEqual(expected);
    expect(steps).toEqual([]);
  });
});
