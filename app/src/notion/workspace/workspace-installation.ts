import { dirname, join } from 'node:path';

/**
 * The name of the operator command (`workspace-command.ts`): the engine's messages use it to refer
 * to the command's subcommands.
 */
export const COMMAND = 'notion';

/** The installation files the command works with. */
export interface InstallationFiles {
  /** The binding of the canonical model. */
  readonly binding: string;
  /** The ledger of built databases: the command touches only these databases. */
  readonly ledger: string;
  /** The formulas that are entered by hand. */
  readonly formulas: string;
}

/**
 * Returns the installation files. The ledger and the formulas live in the binding's directory,
 * which moves between machines whole, so the binding does not end up without the ledger it was
 * built from.
 */
export function installationFiles(binding: string): InstallationFiles {
  const folder = dirname(binding);

  return {
    binding,
    ledger: join(folder, 'workspace.yaml'),
    formulas: join(folder, 'formulas.md'),
  };
}
