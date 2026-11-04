import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { credentialsConfig, type CredentialsConfig } from './credentials.config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

/**
 * A value that must not be stored in the database in the clear.
 *
 * The key comes from the environment and is not stored in the table. That is what sets encrypted
 * technical state apart from a merely stored string.
 *
 * The version in the prefix names the **algorithm**, and only the algorithm: it knows nothing of
 * the key. An existing value survives a change of algorithm and is still recognized. It does not
 * survive a change of key, and a key change cannot be told apart from tampering with the row,
 * because GCM yields the same refusal in both cases. So a key change means re-authorizing the
 * connectors (RUNBOOK §6.3), not migrating data (`GAP-22`).
 */
@Injectable()
export class SecretBox {
  constructor(@Inject(credentialsConfig.KEY) private readonly config: CredentialsConfig) {}

  /**
   * `context` binds the ciphertext to the place where it is stored.
   *
   * Without it a value could be moved: one connector's `refresh_token` put in place of another's
   * `access_token`, and opening would succeed without complaint because the key is the same.
   * GCM can check this for free: it only has to be told what the value is.
   */
  seal(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);

    cipher.setAAD(Buffer.from(context, 'utf8'));

    const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return [
      VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      sealed.toString('base64'),
    ].join(':');
  }

  /**
   * Opening verifies integrity: the GCM tag does not match if the value was edited or the key is
   * wrong. An error here is not a degradation. It is either tampering in the database or a lost
   * key, and both cases need the person.
   */
  open(sealed: string, context: string): string {
    const parts = sealed.split(':');
    if (parts.length !== 4) {
      throw new Error('sealed value is malformed');
    }

    const [version, iv, tag, payload] = parts;
    if (version !== VERSION) {
      throw new Error(`sealed with unsupported version ${version}`);
    }

    const authTag = Buffer.from(tag, 'base64');
    if (authTag.length !== TAG_BYTES) {
      throw new Error('sealed value has a malformed auth tag');
    }

    const nonce = Buffer.from(iv, 'base64');
    if (nonce.length !== IV_BYTES) {
      throw new Error('sealed value has a malformed iv');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key(), nonce);

    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([
        decipher.update(Buffer.from(payload, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      // Node returns `Unsupported state or unable to authenticate data` for this, a message
      // that shows neither what happened nor what to do. There are exactly two causes, and both
      // are named, because neither this check nor the version prefix can tell them apart. Staying
      // silent about the key change would leave a key rotation looking like a break-in.
      throw new Error(
        'sealed value did not authenticate: either APP_ENCRYPTION_KEY changed ' +
          '(re-authorize the connector, RUNBOOK §6.3) or the stored row was tampered with',
        { cause: error },
      );
    }
  }

  private key(): Buffer {
    const key = Buffer.from(this.config.encryptionKey, 'hex');
    if (key.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }

    return key;
  }
}
