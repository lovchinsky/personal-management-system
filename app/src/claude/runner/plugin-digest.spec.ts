import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginDigest } from './plugin-digest';

function directory(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fingerprint-'));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

describe('pluginDigest', () => {
  it('is the same for identical content and different for different content', () => {
    const a = directory({ 'skills/run/SKILL.md': 'one', 'skills/run/claims.md': 'two' });
    const same = directory({ 'skills/run/claims.md': 'two', 'skills/run/SKILL.md': 'one' });
    const other = directory({ 'skills/run/SKILL.md': 'one', 'skills/run/claims.md': 'three' });

    expect(pluginDigest(a)).toBe(pluginDigest(same));
    expect(pluginDigest(a)).not.toBe(pluginDigest(other));
    expect(pluginDigest(a)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('differs after a rename with the same content, because the name is part of the Skill too', () => {
    const before = directory({ 'skills/run/claims.md': 'text' });
    const renamed = directory({ 'skills/run/rules.md': 'text' });

    expect(pluginDigest(before)).not.toBe(pluginDigest(renamed));
  });
});
