import { isAllowedRedirect, matchesRegistered } from './redirect-allowlist';

describe('return address allowlist', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'http://localhost/callback',
    'http://localhost:54321/callback',
    'http://127.0.0.1:3118/callback',
  ])('%s is allowed', (uri) => {
    expect(isAllowedRedirect(uri)).toBe(true);
  });

  it.each([
    ['a foreign host', 'https://evil.example.com/api/mcp/auth_callback'],
    ['a subdomain of the claude.ai host', 'https://evil.claude.ai/api/mcp/auth_callback'],
    ['claude.ai with a different path', 'https://claude.ai/api/mcp/auth_callback/extra'],
    ['claude.ai over http', 'http://claude.ai/api/mcp/auth_callback'],
    ['claude.ai with a query', 'https://claude.ai/api/mcp/auth_callback?next=https://evil.com'],
    ['loopback with a path other than callback', 'http://localhost:3000/steal'],
    ['loopback over https', 'https://localhost/callback'],
    ['loopback with a query', 'http://localhost/callback?x=1'],
    ['loopback with credentials', 'http://user:pw@localhost/callback'],
    ['a host that only starts with localhost', 'http://localhost.evil.com/callback'],
    ['IPv6 loopback that the allowlist does not list', 'http://[::1]/callback'],
    ['not an address', 'not a url'],
    ['an empty address', ''],
  ])('%s is refused', (_, uri) => {
    expect(isAllowedRedirect(uri)).toBe(false);
  });

  describe('matching a registered address', () => {
    it('a hosted callback matches exactly', () => {
      expect(
        matchesRegistered(
          ['https://claude.ai/api/mcp/auth_callback'],
          'https://claude.ai/api/mcp/auth_callback',
        ),
      ).toBe(true);
    });

    /** Claude Code takes a free port every session; RFC 8252 says to disregard the port. */
    it('loopback matches any port of the same host', () => {
      expect(
        matchesRegistered(['http://localhost/callback'], 'http://localhost:61234/callback'),
      ).toBe(true);
      expect(
        matchesRegistered(['http://127.0.0.1/callback'], 'http://127.0.0.1:3118/callback'),
      ).toBe(true);
    });

    it.each([
      ['a different loopback host', 'http://localhost/callback', 'http://127.0.0.1:5000/callback'],
      ['a different path', 'http://localhost/callback', 'http://localhost:5000/other'],
      [
        'a hosted callback on a different host',
        'https://claude.ai/api/mcp/auth_callback',
        'https://claude.com/api/mcp/auth_callback',
      ],
      ['a foreign address', 'http://localhost/callback', 'https://evil.example.com/callback'],
    ])('%s does not match', (_, registered, requested) => {
      expect(matchesRegistered([registered], requested)).toBe(false);
    });
  });
});
