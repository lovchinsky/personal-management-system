import {
  Authorization,
  ConnectorCredentialRepository,
} from '../../src/credentials/connector-credential.repository';
import { SecretBox } from '../../src/credentials/secret-box';
import { PrismaService } from '../../src/platform/db/prisma.service';
import { connectToTestDatabase, truncateAll } from './database';

const KEY = 'b'.repeat(64);
const ACCESS = 'ntn_access_value';
const REFRESH = 'ntn_refresh_value';

/**
 * Connector credentials against a live database.
 *
 * The check exists for one claim: the column holds ciphertext, not the token. The `SecretBox` unit
 * check says that encryption works. This check asks something else: whether the repository really
 * used it, and whether it bound the value to the place where it lives. Second, the two writes of a
 * grant differ. Authorization rewrites everything, renewal only what it supplies.
 */
describe('connector credentials', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let repository: ConnectorCredentialRepository;
  let secrets: SecretBox;

  const expiresAt = new Date('2026-06-01T10:00:00.000Z');
  const obtainedAt = new Date('2026-05-01T10:00:00.000Z');
  const refreshedAt = new Date('2026-05-20T10:00:00.000Z');

  const AUTHORIZATION: Authorization = {
    clientId: 'client-1',
    accessToken: ACCESS,
    accessTokenExpiresAt: expiresAt,
    refreshToken: REFRESH,
    scope: 'default',
    obtainedAt,
    refreshedAt,
  };

  beforeAll(async () => {
    ({ prisma, close } = await connectToTestDatabase());
    secrets = new SecretBox({ encryptionKey: KEY });
    repository = new ConnectorCredentialRepository(prisma, secrets);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await close();
  });

  const authorize = (): Promise<void> => repository.authorize('notion_mcp', AUTHORIZATION);

  it('returns what was put in', async () => {
    await authorize();

    await expect(repository.load('notion_mcp')).resolves.toEqual(AUTHORIZATION);
  });

  it('the columns hold ciphertext, not the token', async () => {
    await authorize();

    const row = await prisma.connectorCredential.findUniqueOrThrow({
      where: { connector: 'notion_mcp' },
    });

    expect(row.accessToken).not.toContain(ACCESS);
    expect(row.refreshToken).not.toContain(REFRESH);
    expect(row.accessToken.startsWith('v1:')).toBe(true);
  });

  /**
   * Binding to the place, checked on what was really written: a value moved from one column to
   * another does not open, although the key is the same.
   */
  it('a value is bound to its column', async () => {
    await authorize();

    const row = await prisma.connectorCredential.findUniqueOrThrow({
      where: { connector: 'notion_mcp' },
    });

    expect(() => secrets.open(row.accessToken, 'notion_mcp:refresh_token')).toThrow();
  });

  /** `client_credentials` has no refresh token: that is a state, not an omitted field. */
  it('an absent refresh token stays absent', async () => {
    await repository.authorize('gbrain', {
      accessToken: ACCESS,
      accessTokenExpiresAt: expiresAt,
      obtainedAt,
      refreshedAt,
    });

    const loaded = await repository.load('gbrain');

    expect(loaded?.refreshToken).toBeUndefined();
    expect(loaded?.scope).toBeUndefined();
    expect(loaded?.clientId).toBeUndefined();
  });

  /**
   * `obtained_at` says when the person authorized the connector, not when we last renewed the
   * token: the 180-day ceiling is measured from it. The provider measures the inactivity limit
   * from `refreshed_at`, and renewal moves it.
   */
  it('renewal keeps the authorization time and moves the refresh time', async () => {
    await authorize();

    await repository.withLock('notion_mcp', ({ renew }) =>
      renew({
        accessToken: 'ntn_access_renewed',
        accessTokenExpiresAt: new Date('2026-07-01T10:00:00.000Z'),
        refreshToken: 'ntn_refresh_rotated',
      }),
    );

    const renewed = await repository.load('notion_mcp');

    expect(renewed?.accessToken).toBe('ntn_access_renewed');
    expect(renewed?.refreshToken).toBe('ntn_refresh_rotated');
    expect(renewed?.obtainedAt).toEqual(obtainedAt);
    expect(renewed?.refreshedAt.getTime()).toBeGreaterThan(refreshedAt.getTime());
  });

  /**
   * A renewal without rotation returns neither `refresh_token` nor `scope`: they have not
   * changed, and that is a normal provider response, not an empty one. Writing `null` there would
   * turn a successful renewal into a lost authorization.
   */
  it('a renewal without a refresh token erases neither it nor the scope nor the client', async () => {
    await authorize();

    await repository.withLock('notion_mcp', ({ renew }) =>
      renew({
        accessToken: 'ntn_access_renewed',
        accessTokenExpiresAt: new Date('2026-07-01T10:00:00.000Z'),
      }),
    );

    const renewed = await repository.load('notion_mcp');

    expect(renewed?.accessToken).toBe('ntn_access_renewed');
    expect(renewed?.refreshToken).toBe(REFRESH);
    expect(renewed?.scope).toBe('default');
    expect(renewed?.clientId).toBe('client-1');
  });

  /** Re-authorization is a new grant: nothing is left of the earlier grant. */
  it('authorization rewrites everything it does not supply as absent', async () => {
    await authorize();
    await repository.authorize('notion_mcp', {
      accessToken: 'ntn_access_new',
      accessTokenExpiresAt: expiresAt,
      obtainedAt: refreshedAt,
      refreshedAt,
    });

    const replaced = await repository.load('notion_mcp');

    expect(replaced?.refreshToken).toBeUndefined();
    expect(replaced?.clientId).toBeUndefined();
    expect(replaced?.obtainedAt).toEqual(refreshedAt);
  });

  it('under the lock an unauthorized connector appears as absent', async () => {
    await expect(
      repository.withLock('notion_mcp', ({ current }) => Promise.resolve(current)),
    ).resolves.toBeNull();
  });

  it('an unauthorized connector yields null, not an error', async () => {
    await expect(repository.load('gbrain')).resolves.toBeNull();
  });
});
