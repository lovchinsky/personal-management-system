import { MINIMAL_ENV } from '../../test/fixtures/minimal-env';
import { assistantConfig } from '../mcp/server/assistant.config';
import { messageOf } from '../platform/error/message-of';
import { appConfig } from './app.config';
import { validate } from './env.validation';

/** Everything an enabled runner requires. */
const RUNNER: Record<string, string> = {
  RUNNER_ENABLED: 'true',
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
  RUNNER_PLUGIN_DIR: '/app/plugin',
  RUNNER_GBRAIN_MCP_URL: 'http://gbrain:3131/mcp',
  NOTION_MCP_URL: 'https://mcp.notion.com/mcp',
  GBRAIN_OAUTH_TOKEN_URL: 'http://gbrain:3131/token',
  GBRAIN_OAUTH_SCOPE: 'read write',
  GBRAIN_CLIENT_ID: 'client',
  GBRAIN_CLIENT_SECRET: 'secret',
};

const FLAGS: readonly string[] = [
  'WORKERS_ENABLED',
  'RUNNER_ENABLED',
  'QUIET_HOURS_ENABLED',
  'NOTION_WEBHOOK_AWAITING_VERIFICATION',
];

/** Optional outside the runner: the config namespaces supply the defaults. */
const OPTIONAL: readonly string[] = [
  'NODE_ENV',
  'PORT',
  'APP_TIMEZONE',
  'APP_LANGUAGE',
  'APP_OWNER_GENDER',
  'APP_ASSISTANT_NAME',
  'APP_ASSISTANT_GENDER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ALLOWED_CHAT_ID',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_API_BASE',
  'QUIET_HOURS_START',
  'QUIET_HOURS_END',
  'REVIEW_DAILY_CONTROL',
  'REVIEW_WEEKLY_CONTROL',
  'REVIEW_STRATEGIC',
  'REVIEW_DEEP',
  'NOTION_VERIFICATION_TOKEN_PATH',
  'NOTION_MCP_REDIRECT_URI',
  'APP_MCP_URL',
  'APP_OAUTH_OWNER_PASSPHRASE',
  ...FLAGS,
];

/** A value the variable does not accept, one for each shape. */
const MALFORMED: readonly (readonly [string, string])[] = [
  ['NODE_ENV', 'staging'],
  ['PORT', '70000'],
  ['NOTION_API_VERSION', '2022-06-28'],
  ['APP_ENCRYPTION_KEY', 'not-hex'],
  ['APP_TIMEZONE', 'Mars/Olympus'],
  // A country code instead of a language code is the likeliest mistake.
  ['APP_LANGUAGE', 'ua'],
  // A human word instead of a value from the list.
  ['APP_OWNER_GENDER', 'male'],
  ['QUIET_HOURS_START', '25:00'],
  ['QUIET_HOURS_END', '8:00'],
  ['REVIEW_DAILY_CONTROL', 'every day 08:30'],
  ['REVIEW_WEEKLY_CONTROL', 'weekly sunday 18:00'],
  ['REVIEW_STRATEGIC', 'monthly 31 10:00'],
  ['REVIEW_DEEP', 'quarterly 1 24:00'],
  ['TELEGRAM_API_BASE', 'api.telegram.org'],
  ['APP_MCP_URL', 'app.example.com/mcp'],
  ['NOTION_VERIFICATION_TOKEN_PATH', 'run/verification_token'],
];

/** Returns the text of the startup refusal; `undefined` means the environment is accepted. */
function refusal(env: Record<string, string>): string | undefined {
  try {
    validate(env);
  } catch (error) {
    return messageOf(error);
  }

  return undefined;
}

const accepted = (env: Record<string, string>): boolean => refusal(env) === undefined;

/** `docs/2-system.md` § “Configuration contract App”. */
describe('environment check', () => {
  it('accepts the minimal environment, since the port has its default elsewhere', () => {
    expect(accepted(MINIMAL_ENV)).toBe(true);
  });

  it('stops startup without a required variable, and the refusal names it', () => {
    const unnamed = Object.keys(MINIMAL_ENV).filter(
      (name) => !refusal({ ...MINIMAL_ENV, [name]: '' })?.includes(name),
    );

    expect(unnamed).toEqual([]);
  });

  /** Compose passes an unset variable as an empty string: that means “absent”, not a value. */
  it('treats an empty optional variable as unset', () => {
    expect(OPTIONAL.filter((name) => !accepted({ ...MINIMAL_ENV, [name]: '' }))).toEqual([]);
  });

  it('requires every variable of an enabled runner', () => {
    const missing = Object.keys(RUNNER).filter(
      (name) => name !== 'RUNNER_ENABLED' && accepted({ ...MINIMAL_ENV, ...RUNNER, [name]: '' }),
    );

    expect(accepted({ ...MINIMAL_ENV, ...RUNNER })).toBe(true);
    expect(missing).toEqual([]);
  });

  /** Compose passes an unset variable as an empty string: with the runner off it means “absent”. */
  it('treats empty runner variables as unset when the runner is off', () => {
    const empty = Object.fromEntries(Object.keys(RUNNER).map((name) => [name, '']));

    expect(accepted({ ...MINIMAL_ENV, ...empty, RUNNER_ENABLED: 'false' })).toBe(true);
  });

  it('checks the runner variables that are set when the runner is off', () => {
    expect(accepted({ ...MINIMAL_ENV, RUNNER_PLUGIN_DIR: 'relative/plugin' })).toBe(false);
    expect(accepted({ ...MINIMAL_ENV, RUNNER_GBRAIN_MCP_URL: 'gbrain:3131' })).toBe(false);
  });

  /** A switch that reads anything but `false` as “on” would silently swallow `flase`. */
  it('accepts exactly two values for a switch', () => {
    const typos = FLAGS.flatMap((name) =>
      ['flase', 'yes']
        .filter((value) => accepted({ ...MINIMAL_ENV, [name]: value }))
        .map((value) => `${name}=${value}`),
    );

    expect(typos).toEqual([]);
  });

  it.each(MALFORMED)('%s=%s stops startup, and the refusal names the variable', (name, value) => {
    expect(refusal({ ...MINIMAL_ENV, [name]: value })).toContain(name);
  });

  it('reports all problems in one list', () => {
    const message = refusal({
      ...MINIMAL_ENV,
      ...RUNNER,
      DATABASE_URL: '',
      QUIET_HOURS_START: '25:00',
      APP_MCP_URL: 'app.example.com/mcp',
      GBRAIN_CLIENT_SECRET: '',
    });
    const named: readonly string[] = [
      'DATABASE_URL',
      'QUIET_HOURS_START',
      'APP_MCP_URL',
      'GBRAIN_CLIENT_SECRET',
    ];

    expect(named.filter((name) => !message?.includes(name))).toEqual([]);
  });

  /** The operator sees what is wrong with the value, not the library's constraint key. */
  it('says in words what is wrong in its refusal', () => {
    expect(refusal({ ...MINIMAL_ENV, APP_ENCRYPTION_KEY: 'not-hex' })).toContain(
      'must be 64 hex characters',
    );
    expect(refusal({ ...MINIMAL_ENV, DATABASE_URL: '' })).toContain('is not set');
  });

  /** The checked number is the one the App listens on: `parseInt` would silently drop the tail. */
  it.each(['3100', '1e3', '0x10'])(
    'PORT=%s: the config namespace uses the checked number',
    (value) => {
      jest.replaceProperty(process, 'env', { ...process.env, PORT: value });

      expect(appConfig().port).toBe(validate({ ...MINIMAL_ENV, PORT: value }).PORT);
    },
  );

  /**
   * The assistant config namespace uses the name the environment check accepted: no surrounding
   * spaces, up to 64 characters, and “no name” in one form, `null` (ADR 0049).
   */
  it.each([' Alex ', 'ш'.repeat(64), ''])(
    'APP_ASSISTANT_NAME=%j: the config namespace uses the name the check accepted',
    (value) => {
      jest.replaceProperty(process, 'env', { ...process.env, APP_ASSISTANT_NAME: value });

      const checked = validate({ ...MINIMAL_ENV, APP_ASSISTANT_NAME: value }).APP_ASSISTANT_NAME;

      expect(assistantConfig().name).toBe(checked ?? null);
    },
  );

  it("accepts the same values for the assistant's gender as for the owner's", () => {
    jest.replaceProperty(process, 'env', { ...process.env, APP_ASSISTANT_GENDER: 'feminine' });

    expect(accepted({ ...MINIMAL_ENV, APP_ASSISTANT_GENDER: 'feminine' })).toBe(true);
    expect(assistantConfig().gender).toBe('feminine');
  });

  /** An owner passphrase without the endpoint address leaves nothing to take the issuer from. */
  describe('authorization server for the chat', () => {
    const PASSPHRASE = 'p'.repeat(32);

    it('accepts a passphrase with an address', () => {
      expect(
        accepted({
          ...MINIMAL_ENV,
          APP_OAUTH_OWNER_PASSPHRASE: PASSPHRASE,
          APP_MCP_URL: 'https://app.example.com/mcp',
        }),
      ).toBe(true);
    });

    it('refuses a passphrase without an address, and the refusal names the address', () => {
      expect(refusal({ ...MINIMAL_ENV, APP_OAUTH_OWNER_PASSPHRASE: PASSPHRASE })).toContain(
        'APP_MCP_URL',
      );
    });

    it('refuses a short passphrase, and the refusal names the variable', () => {
      expect(
        refusal({
          ...MINIMAL_ENV,
          APP_OAUTH_OWNER_PASSPHRASE: 'short',
          APP_MCP_URL: 'https://app.example.com/mcp',
        }),
      ).toContain('APP_OAUTH_OWNER_PASSPHRASE');
    });

    it('allows http only for loopback', () => {
      const withUrl = (url: string): Record<string, string> => ({
        ...MINIMAL_ENV,
        APP_OAUTH_OWNER_PASSPHRASE: PASSPHRASE,
        APP_MCP_URL: url,
      });

      expect(accepted(withUrl('http://localhost:3000/mcp'))).toBe(true);
      expect(accepted(withUrl('http://127.0.0.1:3000/mcp'))).toBe(true);
      expect(refusal(withUrl('http://app.example.com/mcp'))).toContain('must be https');
    });
  });
});
