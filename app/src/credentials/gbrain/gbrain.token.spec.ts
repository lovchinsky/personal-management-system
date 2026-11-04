import { minutesToMilliseconds } from 'date-fns';
import { type GbrainConfig } from './gbrain.config';
import { GbrainToken } from './gbrain.token';

const RUN_NEEDS_MS = minutesToMilliseconds(20);

const config: GbrainConfig = {
  tokenUrl: 'http://gbrain:3131/token',
  scope: 'read write',
  clientId: 'app',
  clientSecret: 'client-secret',
};

interface TokenPayload {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly scope?: string;
}

function answer(payload: TokenPayload, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const A_TOKEN: TokenPayload = {
  access_token: 'gbrain-access-1',
  token_type: 'bearer',
  expires_in: 3_600,
  scope: 'read write',
};

describe('GBrain token', () => {
  let fetched: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;

  beforeEach(() => {
    fetched = jest.spyOn(globalThis, 'fetch').mockResolvedValue(answer(A_TOKEN));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * `INV-062`: an App-owned client, `client_credentials`, `client_secret_post`, only its own
   * scopes.
   */
  it('requests `client_credentials` with its own scopes and the secret in the body', async () => {
    await new GbrainToken(config).accessToken(RUN_NEEDS_MS);

    const [url, init] = fetched.mock.calls[0];
    const body = init?.body;

    expect(url).toBe('http://gbrain:3131/token');
    expect(init?.method).toBe('POST');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body instanceof URLSearchParams ? Object.fromEntries(body) : {}).toEqual({
      grant_type: 'client_credentials',
      client_id: 'app',
      client_secret: 'client-secret',
      scope: 'read write',
    });
  });

  it('keeps the token until it expires instead of asking every time', async () => {
    const token = new GbrainToken(config);

    await expect(token.accessToken(RUN_NEEDS_MS)).resolves.toBe('gbrain-access-1');
    await expect(token.accessToken(RUN_NEEDS_MS)).resolves.toBe('gbrain-access-1');
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('issues the token again when it falls short of the run duration', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-28T10:00:00.000Z') });

    const token = new GbrainToken(config);

    await token.accessToken(RUN_NEEDS_MS);
    fetched.mockResolvedValue(answer({ ...A_TOKEN, access_token: 'gbrain-access-2' }));
    jest.setSystemTime(new Date('2026-09-28T10:50:00.000Z'));

    await expect(token.accessToken(RUN_NEEDS_MS)).resolves.toBe('gbrain-access-2');
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it('makes concurrent runs wait for one request', async () => {
    const token = new GbrainToken(config);

    const tokens = await Promise.all([
      token.accessToken(RUN_NEEDS_MS),
      token.accessToken(RUN_NEEDS_MS),
    ]);

    expect(tokens).toEqual(['gbrain-access-1', 'gbrain-access-1']);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  /** A client given `admin` by mistake stops here and does not pass `admin` to a run. */
  it('does not take a token wider than the one requested', async () => {
    fetched.mockResolvedValue(answer({ ...A_TOKEN, scope: 'read write admin' }));

    await expect(new GbrainToken(config).accessToken(RUN_NEEDS_MS)).rejects.toThrow(
      'GBrain granted more than requested: admin',
    );
  });

  /**
   * An expiry GBrain did not state cannot be checked. A run takes the token just issued, and the
   * next run takes a new token of its own, not the same one.
   */
  it('issues the run a fresh token when GBrain states no expiry and does not keep it', async () => {
    const unstated: TokenPayload = { access_token: 'gbrain-access-1', token_type: 'bearer' };

    fetched.mockResolvedValue(answer(unstated));

    const token = new GbrainToken(config);

    await expect(token.accessToken(RUN_NEEDS_MS)).resolves.toBe('gbrain-access-1');

    fetched.mockResolvedValue(answer({ ...unstated, access_token: 'gbrain-access-2' }));

    await expect(token.accessToken(RUN_NEEDS_MS)).resolves.toBe('gbrain-access-2');
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it('does not pass off a token shorter than the run as usable', async () => {
    fetched.mockResolvedValue(answer({ ...A_TOKEN, expires_in: 60 }));

    await expect(new GbrainToken(config).accessToken(RUN_NEEDS_MS)).rejects.toThrow('shorter than');
  });

  it('turns a GBrain refusal into an error with its status', async () => {
    fetched.mockResolvedValue(new Response('{"error":"invalid_client"}', { status: 401 }));

    await expect(new GbrainToken(config).accessToken(RUN_NEEDS_MS)).rejects.toThrow(
      'GBrain token request failed: 401',
    );
  });
});
