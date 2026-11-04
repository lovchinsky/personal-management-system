import type { OauthClient } from '../../generated/prisma/client';
import { LANGUAGES } from '../../texts/language';
import { textsOf } from '../../texts/texts';
import { consentPage, errorPage } from './consent-page';
import type { AuthorizationRequest } from './oauth-server';

const CLIENT: OauthClient = {
  id: 'client-1',
  clientName: 'Claude <script>',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  createdAt: new Date('2026-10-22T10:00:00Z'),
};

const REQUEST: AuthorizationRequest = {
  client: CLIENT,
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  codeChallenge: 'challenge',
  resource: 'https://app.example.com/mcp',
  state: 'state-1',
};

const QUERY: Readonly<Record<string, string>> = { client_id: 'client-1', state: 'state-1' };

describe.each(LANGUAGES)('consent page in the “%s” language', (language) => {
  const texts = textsOf(language);

  it('names its language and uses the words of the catalog', () => {
    const page = consentPage(texts, REQUEST, QUERY);

    expect(page).toContain(`<html lang="${language}">`);
    expect(page).toContain(`<h1>${texts.consent.heading}</h1>`);
    expect(page).toContain(texts.consent.allow);
    expect(page).toContain(texts.consent.deny);
  });

  /** The owner does not choose the client name, so it is escaped, not turned into markup. */
  it('shows the client name as text, not as markup', () => {
    const page = consentPage(texts, REQUEST, QUERY);

    expect(page).toContain('Claude &lt;script&gt;');
    expect(page).not.toContain('<script>');
  });

  it('shows a refusal and a lockout on the same page', () => {
    expect(consentPage(texts, REQUEST, QUERY, texts.consent.refused)).toContain(
      `<p class="error">${texts.consent.refused}</p>`,
    );
    expect(consentPage(texts, REQUEST, QUERY, texts.consent.locked(30))).toContain('30');
  });

  /**
   * The error description comes from the protocol: it is shown as is, under a heading in the
   * installation's language.
   */
  it('shows the error page in the catalog language and the protocol description as is', () => {
    const page = errorPage(texts, 'unknown client');

    expect(page).toContain(`<html lang="${language}">`);
    expect(page).toContain(`<h1>${texts.consent.errorHeading}</h1>`);
    expect(page).toContain('<p class="error">unknown client</p>');
  });
});
