import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNotWorking } from './working-guard';

describe('the gate integration is not from the main workspace', () => {
  const folder = mkdtempSync(join(tmpdir(), 'working-guard-'));
  const binding = join(folder, 'notion-mapping.yaml');
  let lines: string[];
  const log = (line: string): void => {
    lines.push(line);
  };

  beforeEach(() => {
    lines = [];
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('the same workspace as in the main binding is refused', () => {
    writeFileSync(binding, 'workspace: working-1\n');

    expect(() => assertNotWorking(binding, 'working-1', log)).toThrow(/working workspace/);
  });

  it('another workspace passes silently', () => {
    writeFileSync(binding, 'workspace: working-1\n');

    expect(() => assertNotWorking(binding, 'gate-1', log)).not.toThrow();
    expect(lines).toEqual([]);
  });

  it('without a binding file the check is skipped with a log line, not refused', () => {
    expect(() => assertNotWorking(join(folder, 'absent.yaml'), 'gate-1', log)).not.toThrow();
    expect(() => assertNotWorking(undefined, 'gate-1', log)).not.toThrow();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/no working binding.*skipped/);
  });

  it('a binding that names no workspace is also only a log line', () => {
    writeFileSync(binding, 'workspace: null\ndata_sources: {}\n');

    expect(() => assertNotWorking(binding, 'gate-1', log)).not.toThrow();
    expect(lines).toEqual([
      'the working binding names no workspace: the check of the gate workspace is skipped',
    ]);
  });
});
