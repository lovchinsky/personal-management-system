import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { verificationSchema } from './notion-event.schema';
import { type NotionWebhookConfig } from './notion-webhook.config';

/**
 * Returns the `verification_token` from a provisioning request, or `null`. Outside the
 * subscription provisioning window there is no such request (`docs/2-system.md` § “Subscription
 * verification token”). The guard and the handler share this one question, because two copies
 * would diverge.
 */
export function handshakeOf(body: unknown, webhook: NotionWebhookConfig): string | null {
  if (!webhook.awaitingVerification) return null;

  const handshake = verificationSchema.safeParse(body);

  return handshake.success ? handshake.data.verification_token : null;
}

/**
 * Puts the `verification_token` where the person will pick it up, and **only** there: in a file
 * on tmpfs, not in the log (`docs/2-system.md` § “Subscription verification token”).
 *
 * The file has mode `0600` and the directory `0700`, so nobody but the App process can read the
 * copy of the secret on disk. A write failure propagates and yields a 5xx. The provider
 * redelivers, and the operator sees that the mount is missing.
 */
export async function storeVerificationToken(path: string, token: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, token, { encoding: 'utf8', mode: 0o600 });
}
