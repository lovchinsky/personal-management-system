import { quietHoursConfig, type QuietHoursConfig } from './quiet-hours.config';

/**
 * Builds the quiet hours config namespace as the application builds it from the environment
 * `env`.
 */
function namespaceWith(env: NodeJS.ProcessEnv): QuietHoursConfig {
  jest.replaceProperty(process, 'env', { ...process.env, ...env });

  return quietHoursConfig();
}

describe('quiet hours config namespace from the environment', () => {
  it('with no settings, the window is on and runs from 23:00 to 08:00', () => {
    const expected: QuietHoursConfig = { enabled: true, startMinute: 1380, endMinute: 480 };

    expect(
      namespaceWith({
        QUIET_HOURS_ENABLED: undefined,
        QUIET_HOURS_START: undefined,
        QUIET_HOURS_END: undefined,
      }),
    ).toEqual(expected);
  });

  /**
   * Compose passes an unset variable as an empty string: that is the same as the variable being
   * absent.
   */
  it('empty bounds are the default bounds', () => {
    expect(namespaceWith({ QUIET_HOURS_START: '', QUIET_HOURS_END: '' })).toMatchObject({
      startMinute: 1380,
      endMinute: 480,
    });
  });

  it('bounds from the environment are read as a time of day', () => {
    expect(namespaceWith({ QUIET_HOURS_START: '13:00', QUIET_HOURS_END: '14:30' })).toMatchObject({
      startMinute: 780,
      endMinute: 870,
    });
  });

  it('only `false` turns the window off', () => {
    expect(namespaceWith({ QUIET_HOURS_ENABLED: 'false' }).enabled).toBe(false);
    expect(namespaceWith({ QUIET_HOURS_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('a bound not in the HH:MM form stops startup', () => {
    expect(() => namespaceWith({ QUIET_HOURS_START: '23' })).toThrow(/HH:MM/);
  });
});
