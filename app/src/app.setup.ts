import { NestApplicationOptions } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Options for creating the application, shared by every entry point: the main App process, the
 * gate command and e2e. `NotionSignatureGuard` needs the raw body because the webhook signature is
 * computed over the bytes, not over the parsed JSON. Without this option the guard rejects every
 * request.
 */
export const APP_OPTIONS: NestApplicationOptions = { rawBody: true };

/**
 * Configures the application's HTTP perimeter on top of the module: the proxy and the headers.
 *
 * It is separate from `main.ts` because `main.ts` is not the only thing that brings the
 * application up. E2e and the gate command must see the same perimeter as the main App process,
 * otherwise they check something other than what serves requests.
 */
export function configureApp(app: NestExpressApplication): void {
  // One trusted hop: the same Caddy for which GBrain already has `GBRAIN_HTTP_TRUST_PROXY`.
  // Without it `req.ip` is the proxy's address, so every client in the world shares one throttler
  // bucket, and exhausting it cuts off provider deliveries — exactly the events the system exists
  // for.
  app.set('trust proxy', 1);

  app.use(helmet());
}
