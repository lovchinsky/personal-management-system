import { SecretBox } from './secret-box';

const KEY = 'a'.repeat(64);
const HERE = 'notion_mcp:refresh_token';
const ELSEWHERE = 'notion_mcp:access_token';

describe('SecretBox', () => {
  const box = new SecretBox({ encryptionKey: KEY });

  it('opens what it sealed', () => {
    expect(box.open(box.seal('refresh-token', HERE), HERE)).toBe('refresh-token');
  });

  it('seals the same value twice into different ciphertexts', () => {
    expect(box.seal('same', HERE)).not.toBe(box.seal('same', HERE));
  });

  it('carries the version in the prefix', () => {
    expect(box.seal('x', HERE).startsWith('v1:')).toBe(true);
  });

  /**
   * Binding to the place: a value moved to another column or to another connector does not open,
   * even though the key is the same.
   */
  it('does not open a ciphertext in a different place', () => {
    const sealed = box.seal('refresh-token', HERE);

    expect(() => box.open(sealed, ELSEWHERE)).toThrow();
    expect(() => box.open(sealed, 'gbrain:refresh_token')).toThrow();
  });

  /** Tampering in the database does not pass quietly: the GCM tag catches it. */
  it('does not open an altered ciphertext', () => {
    const [version, iv, tag, payload] = box.seal('refresh-token', HERE).split(':');
    const flipped = Buffer.from(payload, 'base64');

    flipped[0] ^= 0xff;

    expect(() =>
      box.open([version, iv, tag, flipped.toString('base64')].join(':'), HERE),
    ).toThrow();
  });

  it('does not open a ciphertext with a different key', () => {
    const other = new SecretBox({ encryptionKey: 'b'.repeat(64) });

    expect(() => other.open(box.seal('refresh-token', HERE), HERE)).toThrow();
  });

  /**
   * GCM does not tell “the key is different” from “the row was edited”, and Node returns
   * `Unsupported state or unable to authenticate data` for both, a message that shows neither
   * what happened nor what to do. The version prefix is no help here: it knows the algorithm and
   * not the key. What remains is to name both causes.
   */
  it('names both causes in its refusal, not the state of the cipher', () => {
    const other = new SecretBox({ encryptionKey: 'b'.repeat(64) });

    expect(() => other.open(box.seal('refresh-token', HERE), HERE)).toThrow(
      /APP_ENCRYPTION_KEY changed.*tampered with/s,
    );
  });

  it.each([
    ['no version', 'iv:tag:payload'],
    ['unknown version', 'v9:aaaa:bbbb:cccc'],
    ['empty', ''],
  ])('rejects a sealed value: %s', (_case, value) => {
    expect(() => box.open(value, HERE)).toThrow();
  });

  /** The IV length is part of the format, not something that comes from the database row. */
  it('rejects an IV of the wrong length', () => {
    const [version, , tag, payload] = box.seal('refresh-token', HERE).split(':');
    const shortIv = Buffer.alloc(8).toString('base64');

    expect(() => box.open([version, shortIv, tag, payload].join(':'), HERE)).toThrow(/iv/);
  });

  it('stops working with a key of the wrong length', () => {
    const short = new SecretBox({ encryptionKey: 'abcd' });

    expect(() => short.seal('x', HERE)).toThrow(/64 hex/);
  });

  it('round-trips a long value', () => {
    const long = 'т'.repeat(10_000);

    expect(box.open(box.seal(long, HERE), HERE)).toBe(long);
  });
});
