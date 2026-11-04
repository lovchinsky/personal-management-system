import { existsSync, writeFileSync } from 'node:fs';
import type { Client } from '@notionhq/client';
import { loadBinding } from '../binding/load-binding';
import { bindingWorkspaceOf, generateBinding } from './workspace-binding';
import type { WorkspaceContract } from './workspace-contract';
import { formulasToEnter, writeFormulas, type FormulaToEnter } from './workspace-formulas';
import { COMMAND, type InstallationFiles } from './workspace-installation';
import { readLedger, writeLedger } from './workspace-ledger';
import {
  dataSourceReader,
  differences,
  readWorkspace,
  unseenDatabases,
  workspaceIdOf,
} from './workspace-schema';
import { syncWorkspace } from './workspace-sync';

/** The subcommand that builds the databases. */
const BUILD = `${COMMAND} build`;

const LEDGER_TITLE = `Databases built by \`${BUILD}\`: title -> data source. Only these are changed.`;

/** What is said about the formulas: they are optional, and their text is in the file. */
const FORMULA_NOTES: readonly string[] = [
  'The formulas are optional: the system reads the same facts the longer way round without them.',
  `Once pasted, run \`${BUILD}\` again: it reads the workspace and adds the signals whose formulas are filled in to the binding.`,
];

interface BuildOptions {
  /** The personal token: only it creates databases at the top level of the workspace. */
  readonly personal: Client;
  /** The integration the App works through: it must see every database. */
  readonly integration: Client;
  readonly contract: WorkspaceContract;
  readonly files: InstallationFiles;
  readonly log: (line: string) => void;
}

interface BuildReport {
  readonly workspace: string;
  /** Formulas whose expression is not entered yet. */
  readonly formulas: readonly FormulaToEnter[];
  /** Signals that are not bound because their formula is empty. */
  readonly unbound: readonly string[];
}

/**
 * Builds the contract's databases at the top level of the workspace, reads them back, checks them
 * against the contract and writes the binding. The ledger `files.ledger` is written right after
 * each database is created, so running the command again finishes what is unbuilt and creates
 * nothing a second time.
 *
 * The command does not overwrite an installation binding that belongs to another workspace or has
 * no ledger. It checks this before the first change in Notion, so databases that would have
 * nowhere to be bound, or that already exist, are not built. The person opens to the integration
 * a database it does not see. The command names the databases the integration does not see and
 * stops, and running it again carries on.
 */
export async function buildWorkspace({
  personal,
  integration,
  contract,
  files,
  log,
}: BuildOptions): Promise<BuildReport> {
  const workspace = await workspaceIdOf(integration, 'the integration');

  if ((await workspaceIdOf(personal, 'the personal token')) !== workspace) {
    throw new Error('the personal token and the integration belong to different workspaces');
  }

  assertBindingFree(files.binding, workspace);
  assertBuiltHere(files);

  const built = await syncWorkspace({
    notion: personal,
    target: contract.databases,
    built: readLedger(files.ledger),
    record: (recorded) => writeLedger(files.ledger, recorded, LEDGER_TITLE),
    log,
  });
  const left = differences(
    contract.databases,
    await readWorkspace(dataSourceReader(personal, 'the personal token'), [...built.values()]),
  );

  if (left.length > 0) {
    throw new Error(`the workspace still differs from the contract:\n  ${left.join('\n  ')}`);
  }

  const hidden = await unseenDatabases(integration, built);

  if (hidden.length > 0) {
    throw new Error(
      `the integration does not see ${hidden.join(', ')}: open them to it in its settings ` +
        `(Notion → Settings → Connections → the integration → Access), then run \`${BUILD}\` again`,
    );
  }

  const live = await readWorkspace(dataSourceReader(integration, 'the integration'), [
    ...built.values(),
  ]);
  const formulas = formulasToEnter(contract.databases, live);

  writeFormulas(files.formulas, formulas, FORMULA_NOTES);

  const { text, unbound } = generateBinding({
    named: contract.binding,
    live,
    workspace,
    command: BUILD,
  });

  loadBinding(text, files.binding);
  writeFileSync(files.binding, text);

  log(`${built.size} databases match the contract; the binding is written to ${files.binding}`);
  reportFormulas(formulas, unbound, files, log);

  return { workspace, formulas, unbound };
}

function reportFormulas(
  formulas: readonly FormulaToEnter[],
  unbound: readonly string[],
  files: InstallationFiles,
  log: (line: string) => void,
): void {
  if (formulas.length === 0 && unbound.length === 0) return;

  log(
    `${formulas.length} formulas are not entered: Notion's REST API refuses a formula that reads a ` +
      `related database, so they are optional and are entered by hand; their text is in ${files.formulas}`,
  );
  log(
    `Paste each into its property in Notion, then run \`${BUILD}\` again: it adds the signals ` +
      `to the binding${unbound.length > 0 ? ` (not bound now: ${unbound.join(', ')})` : ''}`,
  );
}

function assertBindingFree(file: string, workspace: string): void {
  if (!existsSync(file)) return;

  const belongsTo = bindingWorkspaceOf(file);

  if (belongsTo !== workspace) {
    throw new Error(
      `${file} belongs to ${belongsTo === undefined ? 'no named workspace' : `workspace ${belongsTo}`}, ` +
        `not to ${workspace}: move it aside, and the binding of this workspace will be written ` +
        `in its place`,
    );
  }
}

/**
 * A binding without a ledger describes databases that were not built here: they were built on
 * another machine or bound by hand. Building with an empty ledger would create a second set of
 * databases at the top level.
 */
function assertBuiltHere(files: InstallationFiles): void {
  if (!existsSync(files.binding) || existsSync(files.ledger)) return;

  throw new Error(
    `${files.binding} exists, but ${files.ledger} does not: the databases of this binding were not ` +
      `built here, and building now would create them a second time. Bring the whole folder of the ` +
      `binding from the machine that built them, or compare it with \`${COMMAND} check\``,
  );
}
