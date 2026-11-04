import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { appConfig } from '../../config/app.config';
import type { OauthClient } from '../../generated/prisma/client';
import { textsOf } from '../../texts/texts';
import { OwnerLockedError, OwnerRefusedError } from './oauth-error';
import { AuthorizationRequest, OauthServer } from './oauth-server';
import { OauthController } from './oauth.controller';

const CLIENT: OauthClient = {
  id: 'client-1',
  clientName: 'Claude',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  createdAt: new Date('2026-10-22T10:00:00Z'),
};

const REQUEST: AuthorizationRequest = {
  client: CLIENT,
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  codeChallenge: 'challenge',
  resource: 'https://app.example.com/mcp',
};

const FORM = { client_id: 'client-1', decision: 'allow', passphrase: 'wrong' };

/**
 * Creates an application with the consent controller over a server that refuses the owner in the
 * way the test dictates.
 */
async function appRefusing(refusal: Error): Promise<NestExpressApplication> {
  const server = {
    enabled: true,
    authorizationRequest: () => Promise.resolve(REQUEST),
    approve: () => Promise.reject(refusal),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [OauthController],
    providers: [
      { provide: OauthServer, useValue: server },
      { provide: appConfig.KEY, useValue: { ...appConfig(), language: 'uk' } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  await app.init();

  return app;
}

describe('the decision of the owner on the consent page', () => {
  const { consent } = textsOf('uk');
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('a wrong passphrase yields 403 and the same page with a refusal', async () => {
    app = await appRefusing(new OwnerRefusedError());

    const response = await request(app.getHttpServer())
      .post('/oauth/authorize')
      .type('form')
      .send(FORM)
      .expect(403);

    expect(response.text).toContain(consent.refused);
  });

  /**
   * The lock is closed after failures: the owner sees how long to wait, the client when to retry.
   */
  it('a closed lock yields 429, how long to wait, and `Retry-After`', async () => {
    app = await appRefusing(new OwnerLockedError(30));

    const response = await request(app.getHttpServer())
      .post('/oauth/authorize')
      .type('form')
      .send(FORM)
      .expect(429);

    expect(response.headers['retry-after']).toBe('30');
    expect(response.text).toContain(consent.locked(30));
  });
});
