import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';
import type { Built } from './workspace-sync';

const ledgerSchema = z.strictObject({ data_sources: z.record(z.string(), z.string()) });

/** Reads the ledger of built databases: title → data source. No file means nothing is built yet. */
export function readLedger(file: string): Built {
  if (!existsSync(file)) return new Map();

  const ledger = ledgerSchema.parse(parseDocument(readFileSync(file, 'utf8')).toJS());

  return new Map(Object.entries(ledger.data_sources));
}

/** Writes the ledger; `title` is the comment line at its start, saying whose ledger it is. */
export function writeLedger(file: string, built: Built, title: string): void {
  writeFileSync(file, `# ${title}\n${stringify({ data_sources: Object.fromEntries(built) })}`);
}
