import { optional, required } from './env-value';

describe('environment variable value', () => {
  it('a set value is returned as it is', () => {
    expect(optional('https://mcp.notion.com/mcp')).toBe('https://mcp.notion.com/mcp');
    expect(required('postgresql://db', 'DATABASE_URL')).toBe('postgresql://db');
  });

  /** Compose passes an unset variable as an empty string: that means “absent”, not a value. */
  it('an empty value is the same as an absent one', () => {
    expect(optional('')).toBeUndefined();
    expect(optional(undefined)).toBeUndefined();
  });

  it('when a required value is missing, the refusal names the environment variable', () => {
    expect(() => required(undefined, 'DATABASE_URL')).toThrow('DATABASE_URL is not set');
    expect(() => required('', 'DATABASE_URL')).toThrow('DATABASE_URL is not set');
  });
});
