import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EVALUATION_RESULT_JSON_SCHEMA } from '../../src/claude/result/evaluation-result';
import { gateDigest, schemaDigest, SURFACE_FILES } from './m6-fingerprint';

function directory(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fingerprint-'));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

describe('schemaDigest', () => {
  it('covers the schema with its field descriptions, which travel in the tool schema', () => {
    expect(schemaDigest()).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(EVALUATION_RESULT_JSON_SCHEMA)).toContain('"description"');
  });
});

describe('gateDigest', () => {
  /**
   * Builds a tree of built code: App surfaces, gate modules, App tools; `extra` overrides or adds
   * one.
   */
  const tree = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...Object.fromEntries(SURFACE_FILES.map((name) => [`${name}.js`, `surface ${name}`])),
    'gate/m6-scenarios.js': 'scenarios',
    'gate/m6-claims.js': 'claims',
    'gate/gate-attempts.js': 'attempts',
    'mcp/server/tools/delivery.tools.js': 'delivery',
    'knowledge/anchor-page.js': 'anchor page',
    'texts/uk.js': 'catalog uk',
    'delivery/channels/telegram/telegram.renderer.js': 'renderer',
    ...extra,
  });
  /** The tree is split into App code and gate modules, as in the gate build. */
  const digest = (extra: Record<string, string> = {}): string => {
    const files = Object.entries(tree(extra));
    const gate = files.filter(([path]) => path.startsWith('gate/'));
    const app = files.filter(([path]) => !path.startsWith('gate/'));

    return gateDigest(
      {
        app: directory(Object.fromEntries(app)),
        gate: directory(Object.fromEntries(gate.map(([path, text]) => [path.slice(5), text]))),
      },
      '.js',
    );
  };

  it('is changed by the content of any gate module or App tool', () => {
    const base = digest();

    for (const path of [
      'gate/m6-scenarios.js',
      'gate/m6-claims.js',
      'gate/gate-attempts.js',
      'mcp/server/tools/delivery.tools.js',
      'knowledge/anchor-page.js',
      'texts/uk.js',
      'delivery/channels/telegram/telegram.renderer.js',
    ]) {
      expect(digest({ [path]: 'changed' })).not.toBe(base);
    }
  });

  it('is changed by the content of any App surface the model sees', () => {
    const base = digest();

    for (const name of SURFACE_FILES) {
      expect(digest({ [`${name}.js`]: 'changed' })).not.toBe(base);
    }
  });

  /**
   * A hand-kept list of gate modules would be forgotten, so a new module must enter the digest by
   * itself.
   */
  it('takes in a new gate module or App tool without any edit to a list', () => {
    const base = digest();

    expect(digest({ 'gate/m6-new.js': 'new' })).not.toBe(base);
    expect(digest({ 'mcp/server/tools/new.tools.js': 'new' })).not.toBe(base);
    expect(digest({ 'knowledge/new.js': 'new' })).not.toBe(base);
  });

  it('leaves specs and type declarations out, because the build has none', () => {
    const base = digest();

    expect(digest({ 'gate/m6-claims.spec.js': 'a spec' })).toBe(base);
    expect(digest({ 'gate/m6-claims.d.ts': 'declarations' })).toBe(base);
  });

  it('produces the same digest for the same content in another directory', () => {
    expect(digest()).toBe(digest());
    expect(digest()).toMatch(/^[0-9a-f]{12}$/);
  });

  it('fails loudly on a missing surface instead of producing a digest without it', () => {
    const files = Object.entries(tree()).filter(([path]) => path !== 'runs/toolsets.js');
    const app = Object.fromEntries(files.filter(([path]) => !path.startsWith('gate/')));
    const gate = Object.fromEntries(
      files
        .filter(([path]) => path.startsWith('gate/'))
        .map(([path, text]) => [path.slice(5), text]),
    );

    expect(() => gateDigest({ app: directory(app), gate: directory(gate) }, '.js')).toThrow();
  });

  /** Surface names must match what exists, because a renamed file would switch the digest off. */
  it('finds every named surface in the source and computes the digest', () => {
    expect(gateDigest({ app: join(__dirname, '../../src'), gate: __dirname }, '.ts')).toMatch(
      /^[0-9a-f]{12}$/,
    );
  });
});
