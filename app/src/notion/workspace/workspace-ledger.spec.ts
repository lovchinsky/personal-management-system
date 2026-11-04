import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLedger, writeLedger } from './workspace-ledger';

describe('the ledger of built databases', () => {
  const folder = mkdtempSync(join(tmpdir(), 'workspace-ledger-'));
  const file = join(folder, 'built.yaml');

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('reads as empty without a file: nothing is built yet', () => {
    expect(readLedger(file).size).toBe(0);
  });

  it('is written by database title and read back the same way, with a line saying whose it is', () => {
    const built = new Map([
      ['Tasks', 'ds-1'],
      ['Areas of Focus', 'ds-2'],
    ]);

    writeLedger(file, built, 'Databases built by a command.');

    expect(readFileSync(file, 'utf8')).toMatch(/^# Databases built by a command\.\ndata_sources:/);
    expect(readLedger(file)).toEqual(built);
  });

  it('refuses a shape the ledger does not have instead of substituting silently', () => {
    writeFileSync(file, 'data_sources:\n  Tasks: ds-1\nextra: true\n');

    expect(() => readLedger(file)).toThrow();

    writeFileSync(file, 'data_sources:\n  Tasks:\n    id: ds-1\n');

    expect(() => readLedger(file)).toThrow();
  });
});
