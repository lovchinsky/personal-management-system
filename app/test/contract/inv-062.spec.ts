import { validate } from '../../src/config/env.validation';
import { MINIMAL_ENV } from '../fixtures/minimal-env';
import { composeFile } from './contracts';

/**
 * `INV-062`: In App-triggered runs, the GBrain MCP uses an App-owned `client_credentials` client
 * with `read write` and no `admin`.
 *
 * The requested scopes are visible in the configuration, and here they are checked where they are
 * set: in Compose and in the environment validation, which does not let the App start with a scope
 * wider than `read write`. What GBrain actually issued is a matter for the integration lane; the
 * App also accepts no token wider than the one requested (`gbrain.token.spec.ts`).
 */
describe('INV-062', () => {
  const environment = composeFile('infra/compose.yaml').services.app?.environment ?? {};

  it('Compose asks GBrain for exactly read write', () => {
    expect(environment.GBRAIN_OAUTH_SCOPE?.split(' ').sort()).toEqual(['read', 'write']);
  });

  it('the App-owned client gets its token over the Compose network, not the public address', () => {
    expect(environment.GBRAIN_OAUTH_TOKEN_URL).toBe('http://gbrain:3131/token');
  });

  it.each(['read write', 'read'])('the App accepts scope “%s”', (scope) => {
    expect(() => validate({ ...MINIMAL_ENV, GBRAIN_OAUTH_SCOPE: scope })).not.toThrow();
  });

  it.each(['read write admin', 'admin', 'read sources_admin', 'read agent'])(
    'the App does not start with scope “%s”',
    (scope) => {
      expect(() => validate({ ...MINIMAL_ENV, GBRAIN_OAUTH_SCOPE: scope })).toThrow(
        'GBRAIN_OAUTH_SCOPE',
      );
    },
  );

  /**
   * An enabled runner without a GBrain client would not crash but would silently keep driving
   * every run without GBrain, so an App configured that way does not start. A disabled runner
   * needs no client.
   */
  describe('the GBrain client and the runner switch', () => {
    const RUNNER: Record<string, string> = {
      ...MINIMAL_ENV,
      RUNNER_ENABLED: 'true',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
      RUNNER_PLUGIN_DIR: '/app/plugin',
      RUNNER_GBRAIN_MCP_URL: 'http://gbrain:3131/mcp',
      NOTION_MCP_URL: 'https://mcp.notion.com/mcp',
      GBRAIN_OAUTH_TOKEN_URL: 'http://gbrain:3131/token',
      GBRAIN_OAUTH_SCOPE: 'read write',
      GBRAIN_CLIENT_ID: 'client-id',
      GBRAIN_CLIENT_SECRET: 'client-secret',
    };

    it('the App accepts the full runner set', () => {
      expect(() => validate(RUNNER)).not.toThrow();
    });

    it.each(['GBRAIN_CLIENT_ID', 'GBRAIN_CLIENT_SECRET', 'GBRAIN_OAUTH_SCOPE', 'NOTION_MCP_URL'])(
      'the App does not start with the runner enabled and without %s',
      (name) => {
        expect(() => validate({ ...RUNNER, [name]: '' })).toThrow(name);
      },
    );

    it('with the runner disabled, an empty GBrain client does not get in the way', () => {
      expect(() =>
        validate({
          ...MINIMAL_ENV,
          RUNNER_ENABLED: 'false',
          GBRAIN_CLIENT_ID: '',
          GBRAIN_CLIENT_SECRET: '',
        }),
      ).not.toThrow();
    });
  });
});
