import type { OAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  InvalidRequestError,
  OAuthError,
  ServerError,
  TemporarilyUnavailableError,
  TooManyRequestsError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { ConnectorUnauthorizedError } from '../connector-unauthorized.error';
import { ConnectorUnavailableError } from '../connector-unavailable.error';
import { type NotionMcpConfig } from './notion-mcp.config';
import { NotionMcpOAuth } from './notion-mcp.oauth';

const CONFIG: NotionMcpConfig = {
  url: 'https://mcp.notion.test/mcp',
  redirectUri: undefined,
  clientName: 'Personal Management System',
  keepaliveIntervalHours: 6,
  keepaliveFirstDelayMinutes: 1,
};

/**
 * An authorization server without metadata: the refresh request is sent to `/token` at the
 * server's address.
 */
const SERVER: OAuthServerInfo = { authorizationServerUrl: 'https://auth.notion.test' };

function answer(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

/** Builds an OAuth refusal. The error code is in the body, and the SDK builds the class from it. */
function oauthError(status: number, error: string): Response {
  return answer(status, JSON.stringify({ error, error_description: `${error} from the test` }));
}

/** Returns what the call threw, so that both the class and the cause can be checked. */
function refusalOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/**
 * An `AbortSignal` abort is a `DOMException` in Node, that is, an `Error` with a name. Here it is
 * an `Error` with the same name: the `DOMException` of the test environment comes from another
 * realm and is not an `Error` to App code.
 */
function aborted(name: 'TimeoutError' | 'AbortError'): Error {
  return Object.assign(new Error(`the request was aborted: ${name}`), { name });
}

/**
 * An OAuth provider refusal that clears on its own is a `ConnectorUnavailableError` with the
 * refusal as its cause. When a run's access does not refresh because of the refusal, the App
 * retries the run later instead of failing it (ADR 0045). Everything else stays what it is. The
 * provider is a stub `fetch` and the SDK is the real one.
 */
describe('Notion MCP OAuth provider refusal', () => {
  const oauth = new NotionMcpOAuth(CONFIG);

  describe('grant refresh', () => {
    const refresh = (): Promise<unknown> =>
      refusalOf(oauth.refresh(SERVER, 'client-1', 'refresh-old'));

    const thrown: [string, Error][] = [
      ['network', new TypeError('fetch failed')],
      ['timeout', aborted('TimeoutError')],
      ['aborted request', aborted('AbortError')],
    ];

    it.each(thrown)(
      '%s: clears on its own, with the same failure as its cause',
      async (_, failure) => {
        jest.spyOn(globalThis, 'fetch').mockRejectedValue(failure);

        const error = await refresh();

        expect(error).toBeInstanceOf(ConnectorUnavailableError);
        expect(error).toHaveProperty('cause', failure);
      },
    );

    const answered: [string, Response, typeof OAuthError][] = [
      ['server error', oauthError(500, 'server_error'), ServerError],
      [
        'temporarily unavailable',
        oauthError(503, 'temporarily_unavailable'),
        TemporarilyUnavailableError,
      ],
      ['too many requests', oauthError(429, 'too_many_requests'), TooManyRequestsError],
    ];

    it.each(answered)('%s: clears on its own', async (_, response, kind) => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const error = await refresh();

      expect(error).toBeInstanceOf(ConnectorUnavailableError);
      expect(error).toHaveProperty('cause', expect.any(kind));
    });

    /**
     * The SDK wraps a non-OAuth response in `ServerError` whatever the status, so the status
     * decides: a failed gateway clears on its own, a 404 page does not.
     */
    const pages: [string, number, boolean][] = [
      ['a failed gateway', 502, true],
      ['“too many requests”', 429, true],
      ['a “not found” page', 404, false],
      ['a “bad request” page', 400, false],
    ];

    it.each(pages)('HTML page: %s (%s) clears on its own: %s', async (_, status, passing) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('<html>nope</html>', { status, headers: { 'Content-Type': 'text/html' } }),
        );

      const error = await refresh();

      expect(error instanceof ConnectorUnavailableError).toBe(passing);
    });

    /** The only refusal a retry cannot fix is a dead grant. */
    it('a grant refusal stays an unauthorized-connector error', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(oauthError(400, 'invalid_grant'));

      await expect(refresh()).resolves.toBeInstanceOf(ConnectorUnauthorizedError);
    });

    it('a request the provider rejected is its own refusal, not unavailability', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(oauthError(400, 'invalid_request'));

      await expect(refresh()).resolves.toBeInstanceOf(InvalidRequestError);
    });

    it('an unrecognized refusal stays as it is', async () => {
      const failure = new Error('something else broke');

      jest.spyOn(globalThis, 'fetch').mockRejectedValue(failure);

      await expect(refresh()).resolves.toBe(failure);
    });
  });

  /**
   * On a 5xx, discovery throws a plain error with the code in its text. On a 4xx, 429 included,
   * the SDK tries the next metadata address and does not throw at all. It also reads a network
   * failure as CORS and moves on. Neither case reaches this code.
   */
  describe('discovery', () => {
    const discover = (): Promise<unknown> => refusalOf(oauth.authorizationServer());

    it('HTTP 503 clears on its own', async () => {
      jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(answer(503, '')));

      const error = await discover();

      expect(error).toBeInstanceOf(ConnectorUnavailableError);
      expect(error).toHaveProperty(
        'cause',
        expect.objectContaining({ message: expect.stringMatching(/^HTTP 503 /) }),
      );
    });

    it('a timeout clears on its own', async () => {
      const timeout = aborted('TimeoutError');

      jest.spyOn(globalThis, 'fetch').mockRejectedValue(timeout);

      const error = await discover();

      expect(error).toBeInstanceOf(ConnectorUnavailableError);
      expect(error).toHaveProperty('cause', timeout);
    });

    /**
     * Metadata the provider returned in the wrong shape is not momentary, and a retry will not fix
     * it.
     */
    it('metadata of the wrong shape is not unavailability', async () => {
      jest.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(answer(200, '{}')));

      const error = await discover();

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ConnectorUnavailableError);
    });
  });
});
