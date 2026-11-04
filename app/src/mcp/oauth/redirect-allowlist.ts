/**
 * Where the App allows the authorization code to be returned.
 *
 * Claude clients are hosted applications, which have two fixed callback addresses, and Claude
 * Code, which listens on loopback on an ephemeral port. Everything else is a foreign host, and
 * the code must not be returned there even with the correct owner passphrase. Otherwise a client
 * registered by anyone, which the owner approved through inattention, would hand the code to
 * whoever registered it (`INV-310`).
 */
const HOSTED_CALLBACKS: readonly string[] = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

const LOOPBACK_PATH = '/callback';

function parsed(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/**
 * Checks whether the URL is a client loopback address: `http`, its own host, the callback path,
 * without credentials, a query or a fragment.
 */
function loopback(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.pathname === LOOPBACK_PATH &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
}

/** Checks whether a client may register this address. */
export function isAllowedRedirect(uri: string): boolean {
  const url = parsed(uri);

  return url !== null && (HOSTED_CALLBACKS.includes(uri) || loopback(url));
}

/**
 * Checks whether the request address matches a registered one. The match is exact, except for the
 * loopback port, because Claude Code takes a free port every session and RFC 8252 requires
 * ignoring it (`docs/2-system.md` § “Authentication boundary”).
 */
export function matchesRegistered(registered: readonly string[], requested: string): boolean {
  const asked = parsed(requested);

  return registered.some((uri) => {
    if (uri === requested) return true;

    const known = parsed(uri);

    return (
      known !== null &&
      asked !== null &&
      loopback(known) &&
      loopback(asked) &&
      known.hostname === asked.hostname
    );
  });
}
