import { createHash, randomBytes } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request, { type Test } from 'supertest';
import { z } from 'zod';
import { appConfig } from '../src/config/app.config';
import { FREE_FAILURES } from '../src/mcp/oauth/owner-lock';
import { textsOf } from '../src/texts/texts';
import { bootApp } from './boot-app';

const RESOURCE = 'http://localhost:3000/mcp';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const registered = z.object({ client_id: z.string() });

/**
 * The consent page locked after failures, exercised through the real HTTP perimeter. The lock
 * lives in the App server, so the suite has its own App. Otherwise a closed lock would affect the
 * neighboring tests.
 */
describe('the consent page after failed passphrase attempts (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootApp({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());

  it('answers 429 after five wrong passphrases, saying how long to wait and carrying `Retry-After`', async () => {
    const { body } = await http()
      .post('/oauth/register')
      .send({ client_name: 'Claude', redirect_uris: [CALLBACK] })
      .expect(201);
    const challenge = createHash('sha256')
      .update(randomBytes(32).toString('base64url'))
      .digest('base64url');
    const form = {
      response_type: 'code',
      client_id: registered.parse(body).client_id,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
      decision: 'allow',
      passphrase: 'wrong',
    };
    const attempt = (): Test => http().post('/oauth/authorize').type('form').send(form);

    for (let failure = 0; failure < FREE_FAILURES; failure += 1) await attempt().expect(403);

    const locked = await attempt().expect(429);
    const seconds = Number(locked.headers['retry-after']);
    const { consent } = textsOf(appConfig().language);

    expect(seconds).toBeGreaterThan(0);
    expect(locked.headers.location).toBeUndefined();
    expect(locked.text).toContain(consent.locked(seconds));
  });
});
