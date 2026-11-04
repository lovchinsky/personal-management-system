import { resolve } from 'node:path';
import { Client } from '@notionhq/client';
import { required } from '../../platform/config/env-value';
import { messageOf } from '../../platform/error/message-of';
import { bindingConfig } from '../binding/binding.config';
import { notionConfig } from '../client/notion.config';
import { buildWorkspace } from './workspace-build';
import { checkWorkspace } from './workspace-check';
import { readWorkspaceContract } from './workspace-contract';
import { COMMAND, installationFiles } from './workspace-installation';
import { writeBindingTemplate } from './workspace-template';
import { workspaceConfig } from './workspace.config';

/**
 * The operator command for the Notion workspace databases as the contract defines them, and for
 * the binding to them (ADR 0048). It ships in the App image as a one-off action, the `notion`
 * service in Compose:
 *
 *   ./bin/dc run --rm notion build      databases at the workspace top level and their binding
 *   ./bin/dc run --rm notion check      check of binding databases against the contract, no changes
 *   ./bin/dc run --rm notion template   an empty binding for a workspace of another shape
 *
 * The binding is the file of the `binding` namespace; the ledger of built databases and the
 * formulas live in its directory. The integration token comes from the `notion` namespace, as in
 * the App. The personal token comes from the `workspace` namespace, only for the duration of the
 * build.
 *
 * Exit code: 0 means done, 1 means `check` found differences from the contract, 2 means the
 * command failed to run.
 */

const SUBCOMMANDS = ['build', 'check', 'template'] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];

const USAGE = `usage: ${COMMAND} build      build the databases at the top level of the workspace and write the binding
       ${COMMAND} check      compare the databases of the binding with the contract
       ${COMMAND} template   write an empty binding for a workspace of another shape`;

/**
 * The contracts sit next to the compiled command: `/app/dist/src/notion/workspace` →
 * `/app/contracts`.
 */
const CONTRACTS = resolve(__dirname, '../../../../contracts');

function isSubcommand(value: string | undefined): value is Subcommand {
  return SUBCOMMANDS.some((name) => name === value);
}

/** Returns the subcommand from the arguments. The command takes exactly one subcommand. */
export function subcommandOf(argv: readonly string[]): Subcommand {
  const [name] = argv;

  if (argv.length === 1 && isSubcommand(name)) return name;

  throw new Error(
    `${argv.length === 0 ? 'no subcommand' : `unknown arguments: ${argv.join(' ')}`}\n${USAGE}`,
  );
}

function client(auth: string): Client {
  return new Client({ auth, notionVersion: notionConfig().apiVersion });
}

/** Creates a client for the integration the App works through. */
function integration(): Client {
  return client(notionConfig().apiToken);
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(argv: readonly string[]): Promise<void> {
  const subcommand = subcommandOf(argv);
  const files = installationFiles(bindingConfig().file);

  switch (subcommand) {
    case 'template':
      writeBindingTemplate({
        canonical: resolve(CONTRACTS, 'canonical.yaml'),
        binding: files.binding,
        log: say,
      });
      return;

    case 'check': {
      const { differences } = await checkWorkspace({
        notion: integration(),
        contract: readWorkspaceContract(resolve(CONTRACTS, 'notion-workspace.yaml')),
        bindingFile: files.binding,
        log: say,
      });

      if (differences.length > 0) process.exitCode = 1;
      return;
    }

    case 'build':
      await buildWorkspace({
        personal: client(required(workspaceConfig().personalToken, 'NOTION_PERSONAL_TOKEN')),
        integration: integration(),
        contract: readWorkspaceContract(resolve(CONTRACTS, 'notion-workspace.yaml')),
        files,
        log: say,
      });
      return;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${COMMAND}: ${messageOf(error)}\n`);
    process.exitCode = 2;
  });
}
