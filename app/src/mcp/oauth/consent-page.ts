import type { ConsentTexts, Texts } from '../../texts/texts';
import { AuthorizationRequest } from './oauth-server';

/** Escapes text that goes into HTML, because the owner does not choose the client name. */
function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The Content-Security-Policy header of the consent page. The form posts to its own address, and
 * the response is a redirect to the client's address. Browsers apply `form-action` to that
 * redirect too, so exactly the hosts the allowlist accepts are allowed (`redirect-allowlist.ts`).
 * Everything else is forbidden, scripts included.
 */
export const CONSENT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; " +
  "form-action 'self' https://claude.ai https://claude.com http://localhost:* http://127.0.0.1:*";

const STYLE = `
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; }
  dt { color: #555; margin-top: .75rem; }
  dd { margin: 0; word-break: break-all; }
  input[type=password] { width: 100%; padding: .5rem; margin: .75rem 0; box-sizing: border-box; }
  button { padding: .5rem 1.25rem; margin-right: .5rem; }
  .error { color: #b00020; }
`;

/**
 * Request parameters the form posts back. The server checks them again because the form is not
 * trusted.
 */
const CARRIED = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'resource',
  'state',
] as const;

/** The page texts and the language they are written in: `<html lang>` names it. */
type PageTexts = Pick<Texts, 'language' | 'consent'>;

/**
 * Renders the owner's consent page: who asks for access to the App MCP, where the code will
 * return, and the passphrase. The client name and the return host are in plain view, because
 * whoever connects must see what they are approving. The wording is in the installation's language
 * (ADR 0042); the client name is as the client registered it.
 */
export function consentPage(
  texts: PageTexts,
  request: AuthorizationRequest,
  query: Readonly<Record<string, string>>,
  refusal?: string,
): string {
  const words: ConsentTexts = texts.consent;
  const redirectHost = new URL(request.redirectUri).host;
  const carried = CARRIED.filter((name) => query[name] !== undefined)
    .map((name) => `<input type="hidden" name="${name}" value="${escaped(query[name] ?? '')}">`)
    .join('\n      ');

  return `<!doctype html>
<html lang="${texts.language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escaped(words.title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <h1>${escaped(words.heading)}</h1>
  <dl>
    <dt>${escaped(words.client)}</dt><dd>${escaped(request.client.clientName)}</dd>
    <dt>${escaped(words.returnsTo)}</dt><dd>${escaped(redirectHost)}</dd>
    <dt>${escaped(words.resource)}</dt><dd>${escaped(request.resource)}</dd>
  </dl>
  <p>${escaped(words.explanation)}</p>
  ${refusal === undefined ? '' : `<p class="error">${escaped(refusal)}</p>`}
  <form method="post" action="/oauth/authorize">
      ${carried}
    <label for="passphrase">${escaped(words.passphrase)}</label>
    <input id="passphrase" type="password" name="passphrase" autocomplete="current-password" autofocus>
    <button type="submit" name="decision" value="allow">${escaped(words.allow)}</button>
    <button type="submit" name="decision" value="deny" formnovalidate>${escaped(words.deny)}</button>
  </form>
</body>
</html>
`;
}

/**
 * Renders the error page of an authorization request. Where to return is not yet known, so there
 * is no redirect. The description is the protocol `error_description` in English. It is evidence,
 * not the App's own word, so it is shown as is under a heading in the installation's language.
 */
export function errorPage(texts: PageTexts, description: string): string {
  return `<!doctype html>
<html lang="${texts.language}">
<head>
  <meta charset="utf-8">
  <title>${escaped(texts.consent.errorTitle)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <h1>${escaped(texts.consent.errorHeading)}</h1>
  <p class="error">${escaped(description)}</p>
</body>
</html>
`;
}
