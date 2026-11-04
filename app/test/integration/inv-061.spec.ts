import { Test, TestingModule } from '@nestjs/testing';
import {
  addHours,
  differenceInSeconds,
  minutesToMilliseconds,
  subDays,
  subMinutes,
} from 'date-fns';
import {
  Authorization,
  ConnectorCredentialRepository,
} from '../../src/credentials/connector-credential.repository';
import { ConnectorUnauthorizedError } from '../../src/credentials/connector-unauthorized.error';
import {
  credentialsConfig,
  type CredentialsConfig,
} from '../../src/credentials/credentials.config';
import {
  notionMcpConfig,
  type NotionMcpConfig,
} from '../../src/credentials/notion-mcp/notion-mcp.config';
import { NotionMcpGrant } from '../../src/credentials/notion-mcp/notion-mcp.grant';
import { NotionMcpOAuth } from '../../src/credentials/notion-mcp/notion-mcp.oauth';
import { SecretBox } from '../../src/credentials/secret-box';
import { databaseConfig } from '../../src/platform/db/database.config';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { testConfig } from '../fixtures/test-module';
import { truncateAll } from './database';
import { FakeNotionOAuth, IssuedGrant } from './fake-notion-oauth';

const RUN_NEEDS_MS = minutesToMilliseconds(20);
const REDIRECT_URI = 'http://localhost:8765/callback';

/** The name of this installation's client: the person sees it on the Notion consent page. */
const CLIENT_NAME = 'Personal Management System test installation';

interface WaitingRow {
  readonly waiting: number;
}

/**
 * `INV-061`: App-triggered Notion MCP OAuth supports Authorization Code + PKCE, refresh handling
 * and secure credential storage.
 *
 * The provider is stubbed (`fake-notion-oauth.ts`) and behaves as the live one does, as measured.
 * The rest is real: the MCP SDK, the database, encryption, locking. The live provider is
 * deliberately not queried here, because every refresh rotates the grant, and a test that touched
 * it would spend a real authorization.
 */
describe('INV-061', () => {
  const fake = new FakeNotionOAuth();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let credentials: ConnectorCredentialRepository;
  let grant: NotionMcpGrant;
  let oauth: NotionMcpOAuth;

  beforeAll(async () => {
    await fake.start();

    const encryption: CredentialsConfig = { encryptionKey: 'c'.repeat(64) };
    const mcp: NotionMcpConfig = {
      ...notionMcpConfig(),
      url: fake.mcpUrl,
      redirectUri: REDIRECT_URI,
      clientName: CLIENT_NAME,
    };

    moduleRef = await Test.createTestingModule({
      imports: [testConfig(databaseConfig)],
      providers: [
        { provide: credentialsConfig.KEY, useValue: encryption },
        { provide: notionMcpConfig.KEY, useValue: mcp },
        PrismaService,
        SecretBox,
        ConnectorCredentialRepository,
        NotionMcpOAuth,
        NotionMcpGrant,
      ],
    }).compile();

    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    credentials = moduleRef.get(ConnectorCredentialRepository);
    grant = moduleRef.get(NotionMcpGrant);
    oauth = moduleRef.get(NotionMcpOAuth);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    fake.reset();
  });

  afterAll(async () => {
    await moduleRef.close();
    await fake.stop();
  });

  /** Seeds a grant in the database, as if an authorization had issued it ten days ago. */
  async function seeded(
    issued: IssuedGrant,
    overrides: Partial<Authorization> = {},
  ): Promise<Authorization> {
    const authorization: Authorization = {
      clientId: issued.clientId,
      accessToken: issued.accessToken,
      accessTokenExpiresAt: subMinutes(new Date(), 1),
      refreshToken: issued.refreshToken,
      scope: 'default',
      obtainedAt: subDays(new Date(), 10),
      refreshedAt: subDays(new Date(), 1),
      ...overrides,
    };

    await credentials.authorize('notion_mcp', authorization);

    return authorization;
  }

  describe('authorization', () => {
    it('registers the client under the installation name and asks for consent with PKCE S256', async () => {
      const pending = await oauth.begin();
      const params = pending.authorizationUrl.searchParams;

      expect(fake.registeredNames.at(-1)).toBe(CLIENT_NAME);
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/);
      expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
      expect(params.get('state')).not.toBeNull();
    });

    /**
     * The PKCE verifier lives only in the authorization's memory: it is in no column of the
     * database, and the tokens are stored as ciphertext.
     */
    it('exchanges the code with the verifier and stores the grant as ciphertext, without the verifier', async () => {
      const pending = await oauth.begin();
      const status = await grant.authorize(
        await pending.finish(fake.approve(pending.authorizationUrl)),
      );

      const verifier = fake.tokenRequests.find(
        (request) => request.grantType === 'authorization_code',
      )?.verifier;
      const row = await prisma.connectorCredential.findUniqueOrThrow({
        where: { connector: 'notion_mcp' },
      });
      const stored = await credentials.load('notion_mcp');

      expect(verifier).toBeDefined();
      expect(JSON.stringify(row)).not.toContain(verifier);
      expect(row.accessToken.startsWith('v1:')).toBe(true);
      expect(row.accessToken).not.toContain(stored?.accessToken);
      expect(row.clientId).toMatch(/^client_/);
      expect(differenceInSeconds(new Date(), status.obtainedAt)).toBeLessThan(60);
      expect(status.refreshedAt).toEqual(status.obtainedAt);
    });

    it('an address with a state that does not match does not complete the authorization and leaves no grant', async () => {
      const pending = await oauth.begin();
      const callback = new URL(fake.approve(pending.authorizationUrl));

      callback.searchParams.set('state', 'forged');

      await expect(pending.finish(callback.toString())).rejects.toThrow('state does not match');
      await expect(credentials.load('notion_mcp')).resolves.toBeNull();
    });

    it('a refusal by the person is a refusal, not a grant', async () => {
      const pending = await oauth.begin();
      const callback = new URL(REDIRECT_URI);

      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('state', pending.authorizationUrl.searchParams.get('state') ?? '');

      await expect(pending.finish(callback.toString())).rejects.toThrow(
        'authorization denied: access_denied',
      );
    });

    /** The ceiling is measured from the new authorization, not from the first. */
    it('re-authorization rewrites the grant together with the authorization time', async () => {
      const old = await seeded(fake.issue(), { obtainedAt: subDays(new Date(), 100) });
      const pending = await oauth.begin();

      await grant.authorize(await pending.finish(fake.approve(pending.authorizationUrl)));

      const stored = await credentials.load('notion_mcp');

      expect(stored?.clientId).not.toBe(old.clientId);
      expect(differenceInSeconds(new Date(), stored?.obtainedAt ?? new Date(0))).toBeLessThan(60);
    });
  });

  describe('refresh', () => {
    it('a token still valid for the time a run needs is not refreshed', async () => {
      const issued = fake.issue();

      await seeded(issued, { accessTokenExpiresAt: addHours(new Date(), 2) });

      await expect(grant.accessToken(RUN_NEEDS_MS)).resolves.toBe(issued.accessToken);
      expect(fake.refreshes()).toBe(0);
    });

    it('a token too short for a run is refreshed with rotation, and the authorization time stays', async () => {
      const issued = fake.issue();
      const before = await seeded(issued);

      const fresh = await grant.accessToken(RUN_NEEDS_MS);
      const after = await credentials.load('notion_mcp');

      expect(fresh).not.toBe(issued.accessToken);
      expect(after?.accessToken).toBe(fresh);
      expect(after?.refreshToken).not.toBe(issued.refreshToken);
      expect(fake.isActive(issued.refreshToken)).toBe(false);
      expect(fake.isActive(after?.refreshToken ?? '')).toBe(true);
      expect(after?.obtainedAt).toEqual(before.obtainedAt);
      expect(after?.refreshedAt.getTime()).toBeGreaterThan(before.refreshedAt.getTime());
    });

    /**
     * Two refreshers without locking would spend the same refresh token, and the second would
     * write the already revoked one to the database, so the grant is dead although both refreshes
     * are “successful”. Under the lock the second waits for the first and sees the fresh token.
     *
     * The response to the refresh is held until the second starts waiting for the lock in the
     * database, or until a second refresh request arrives if there is no lock. That way the test
     * catches a breakage, not timing.
     *
     * Discovery (several requests to the provider) is done before the lock. Whoever is already
     * waiting for the row must have its own discovery done. Otherwise the discovery would eat the
     * transaction time needed for the refresh and the write.
     */
    it('two concurrent refreshers produce one refresh and the same token', async () => {
      await seeded(fake.issue());

      let release!: () => void;
      let discoveriesWhileWaiting = 0;

      fake.holdRefresh = new Promise<void>((resolve) => {
        release = resolve;
      });

      const first = grant.accessToken(RUN_NEEDS_MS);
      const second = grant.accessToken(RUN_NEEDS_MS);

      for (let poll = 0; poll < 200; poll += 1) {
        const [{ waiting }] = await prisma.$queryRaw<WaitingRow[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND datname = current_database()
        `;

        discoveriesWhileWaiting = fake.discoveries;

        if (fake.refreshes() >= 2 || (fake.refreshes() === 1 && waiting > 0)) break;

        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      release();

      const [one, other] = await Promise.all([first, second]);

      expect(fake.refreshes()).toBe(1);
      expect(other).toBe(one);
      expect(discoveriesWhileWaiting).toBe(2);
    });

    /**
     * `invalid_grant` does not clear on its own: it needs the person, and the grant in the
     * database stays as it was.
     */
    it('a revoked grant is a terminal refusal, and what is stored does not change', async () => {
      const revoked = fake.issue();

      await seeded({ ...revoked, refreshToken: 'refresh_unknown' });

      await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toBeInstanceOf(
        ConnectorUnauthorizedError,
      );

      const stored = await credentials.load('notion_mcp');

      expect(stored?.refreshToken).toBe('refresh_unknown');
    });

    it('an unauthorized connector is a refusal that calls for the person', async () => {
      await expect(grant.accessToken(RUN_NEEDS_MS)).rejects.toThrow('RUNBOOK §6.3');
      expect(fake.refreshes()).toBe(0);
    });
  });

  /** A grant nobody uses must stay alive, because the inactivity limit is thirty days. */
  describe('keepalive', () => {
    it('refreshes a grant that has not been refreshed for a week', async () => {
      await seeded(fake.issue(), { refreshedAt: subDays(new Date(), 8) });

      const kept = await grant.keepAlive();

      expect(kept.kind).toBe('refreshed');
      expect(fake.refreshes()).toBe(1);
    });

    it('leaves a fresh grant untouched', async () => {
      await seeded(fake.issue(), { refreshedAt: subDays(new Date(), 1) });

      await expect(grant.keepAlive()).resolves.toMatchObject({ kind: 'fresh' });
      expect(fake.refreshes()).toBe(0);
    });

    it('with no grant, says there is none and makes no request', async () => {
      await expect(grant.keepAlive()).resolves.toEqual({ kind: 'absent' });
      expect(fake.tokenRequests).toHaveLength(0);
    });
  });
});
