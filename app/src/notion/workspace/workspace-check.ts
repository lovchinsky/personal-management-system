import { existsSync, readFileSync } from 'node:fs';
import type { Client } from '@notionhq/client';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import type { WorkspaceContract } from './workspace-contract';
import { formulasToEnter, type FormulaToEnter } from './workspace-formulas';
import { COMMAND } from './workspace-installation';
import { dataSourceReader, differences, readWorkspace, workspaceIdOf } from './workspace-schema';

interface CheckOptions {
  readonly notion: Client;
  readonly contract: WorkspaceContract;
  readonly bindingFile: string;
  readonly log: (line: string) => void;
}

interface CheckReport {
  /** Differences between the schema and the contract. */
  readonly differences: readonly string[];
  /** Formulas whose expression differs from the contract's: they are optional. */
  readonly formulas: readonly FormulaToEnter[];
}

/**
 * The check only reads: the databases come from the installation's binding, the schema from
 * Notion, and the differences from the contract are only reported. That is how an installation
 * sees where it has fallen behind the contract.
 */
export async function checkWorkspace({
  notion,
  contract,
  bindingFile,
  log,
}: CheckOptions): Promise<CheckReport> {
  if (!existsSync(bindingFile)) {
    throw new Error(
      `${bindingFile} does not exist: build the workspace with \`${COMMAND} build\` first, or ` +
        `write the binding of a workspace of another shape from \`${COMMAND} template\``,
    );
  }

  const file = z
    .object({
      workspace: z.unknown(),
      data_sources: z.record(z.string(), z.string()),
    })
    .parse(parseDocument(readFileSync(bindingFile, 'utf8')).toJS());
  const workspace = await workspaceIdOf(notion, 'the integration');

  if (typeof file.workspace === 'string' && file.workspace !== workspace) {
    throw new Error(
      `${bindingFile} belongs to workspace ${file.workspace}, and the token belongs to ${workspace}`,
    );
  }

  const live = await readWorkspace(
    dataSourceReader(notion, 'the integration'),
    Object.values(file.data_sources),
  );
  const found = differences(contract.databases, live);
  const formulas = formulasToEnter(contract.databases, live);

  for (const line of found) log(line);
  for (const { database, property } of formulas) {
    log(`formula ${database}."${property}" differs from the contract (formulas are optional)`);
  }

  log(
    found.length === 0
      ? 'the schema matches the contract'
      : `${found.length} differences from the contract`,
  );

  return { differences: found, formulas };
}
