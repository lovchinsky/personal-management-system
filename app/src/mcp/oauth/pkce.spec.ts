import { createHash } from 'node:crypto';
import { provesChallenge } from './pkce';

/** A verifier per RFC 7636: 43–128 characters from a limited set. */
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

/**
 * The S256 challenge the Claude client signs the request with: base64url of the verifier's SHA-256.
 */
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

describe('PKCE S256', () => {
  it('the verifier the challenge was derived from proves the challenge', () => {
    expect(provesChallenge(VERIFIER, CHALLENGE)).toBe(true);
  });

  /** The example from RFC 7636, appendix B: an answer independent of our code. */
  it('matches the RFC 7636 example', () => {
    expect(
      provesChallenge(
        'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      ),
    ).toBe(true);
  });

  it.each([
    ['a different verifier', `${VERIFIER.slice(0, -1)}A`],
    ['a verifier with disallowed characters', `${VERIFIER}!`],
    ['a verifier that is too short', 'short'],
    ['an empty verifier', ''],
  ])('%s does not prove the challenge', (_, verifier) => {
    expect(provesChallenge(verifier, CHALLENGE)).toBe(false);
  });

  /**
   * `plain` does not protect against code interception: the verifier itself cannot be the
   * challenge.
   */
  it('a verifier passed as the challenge does not prove it (the `plain` method is not accepted)', () => {
    expect(provesChallenge(VERIFIER, VERIFIER)).toBe(false);
  });
});
