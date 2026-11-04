import { RUN_ENV_NAMES, runEnv } from '../../src/claude/runner/run-env';
import { MODES, optionsFor } from '../fixtures/runner-options.fixture';

/**
 * `INV-306` The run's environment equals the declared set.
 *
 * `env` in the SDK's TypeScript surface replaces the process environment, so a run gets exactly
 * what is named and nothing from the App's environment.
 */
describe('INV-306', () => {
  it('the environment consists of exactly the declared names', () => {
    expect(Object.keys(runEnv('/tmp/x', '/usr/bin', 'token')).sort()).toEqual(
      [...RUN_ENV_NAMES].sort(),
    );
  });

  it.each(MODES)('options for %s have this environment', (mode) => {
    expect(optionsFor(mode).env).toEqual(
      runEnv('/tmp/personal-management-system-run-x', '/usr/bin', 'oauth-token'),
    );
  });

  it('the environment has no App secret apart from the subscription token', () => {
    const names: readonly string[] = RUN_ENV_NAMES;

    for (const secret of [
      'DATABASE_URL',
      'APP_ENCRYPTION_KEY',
      'NOTION_API_TOKEN',
      'GBRAIN_CLIENT_SECRET',
    ]) {
      expect(names).not.toContain(secret);
    }
  });
});
