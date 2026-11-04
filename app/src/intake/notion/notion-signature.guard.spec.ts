import { createHmac } from 'node:crypto';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { NotionSignatureGuard } from './notion-signature.guard';
import { type NotionWebhookConfig } from './notion-webhook.config';

const SECRET = 'secret_' + 'a'.repeat(32);

const WEBHOOK: NotionWebhookConfig = {
  secret: SECRET,
  awaitingVerification: false,
  verificationTokenPath: '/run/app/verification_token',
};

interface FakeRequest {
  headers: Record<string, string | undefined>;
  body: unknown;
  rawBody?: Buffer;
}

function contextOf(request: FakeRequest): ExecutionContext {
  return new ExecutionContextHost([request]);
}

function signed(body: string, secret = SECRET): FakeRequest {
  const digest = createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');

  return {
    headers: { 'x-notion-signature': `sha256=${digest}` },
    body: JSON.parse(body),
    rawBody: Buffer.from(body),
  };
}

describe('NotionSignatureGuard', () => {
  const guard = new NotionSignatureGuard({ ...WEBHOOK, awaitingVerification: false });

  /** The same installation with the provisioning window open. */
  const provisioning = new NotionSignatureGuard({ ...WEBHOOK, awaitingVerification: true });

  const payload = JSON.stringify({ id: 'evt-1', type: 'page.properties_updated' });

  it('a signed delivery passes', () => {
    expect(guard.canActivate(contextOf(signed(payload)))).toBe(true);
  });

  it('a signature made with a different key does not pass', () => {
    expect(() => guard.canActivate(contextOf(signed(payload, 'other_secret')))).toThrow(
      UnauthorizedException,
    );
  });

  /** The signature is computed over the raw body, so reformatted JSON breaks it. */
  it('a substituted body does not pass', () => {
    const request = signed(payload);

    request.rawBody = Buffer.from(JSON.stringify({ id: 'evt-2' }));

    expect(() => guard.canActivate(contextOf(request))).toThrow(UnauthorizedException);
  });

  it('a delivery without a signature does not pass', () => {
    expect(() =>
      guard.canActivate(
        contextOf({ headers: {}, body: { id: 'evt-1' }, rawBody: Buffer.from(payload) }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('a signature without the prefix does not pass', () => {
    expect(() =>
      guard.canActivate(
        contextOf({
          headers: { 'x-notion-signature': 'deadbeef' },
          body: { id: 'evt-1' },
          rawBody: Buffer.from(payload),
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('a signature of a different length does not break the comparison', () => {
    expect(() =>
      guard.canActivate(
        contextOf({
          headers: { 'x-notion-signature': 'sha256=short' },
          body: { id: 'evt-1' },
          rawBody: Buffer.from(payload),
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  describe('provisioning window', () => {
    const handshake = (body: unknown): ExecutionContext => contextOf({ headers: {}, body });

    /** The one-time request brings the key itself, so it has no signature anywhere. */
    it('an open window lets through a request with a token and no signature', () => {
      expect(provisioning.canActivate(handshake({ verification_token: 'one-time-token' }))).toBe(
        true,
      );
    });

    /**
     * The most important claim in this file is that outside the provisioning window, the
     * installation's state decides whether a signature is required, not the shape of the body.
     */
    it('a closed window requires a signature even from a request with a token', () => {
      expect(() => guard.canActivate(handshake({ verification_token: 'one-time-token' }))).toThrow(
        UnauthorizedException,
      );
    });

    /**
     * A plain zod object would strip the extra keys from a body that contains both a token and a
     * full event, and the event would bypass the signature check.
     */
    it('a body with a token and an event is not a handshake', () => {
      expect(() =>
        provisioning.canActivate(
          handshake({
            verification_token: 'one-time-token',
            id: 'evt-1',
            type: 'page.properties_updated',
            timestamp: '2026-09-26T00:00:00.000Z',
            entity: { id: 'page-1', type: 'page' },
            authors: [],
          }),
        ),
      ).toThrow(UnauthorizedException);
    });

    /**
     * The token is written to a file the operator copies into a secret, so anything extra in it
     * would be copied there too.
     */
    it.each([
      ['a line break', 'token\nWARN forged line'],
      ['a space', 'one time token'],
      ['excess length', 'x'.repeat(201)],
    ])('%s in the token is not a handshake', (_case, token) => {
      expect(() => provisioning.canActivate(handshake({ verification_token: token }))).toThrow(
        UnauthorizedException,
      );
    });
  });
});
