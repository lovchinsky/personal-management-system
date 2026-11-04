import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@notionhq/client';
import { loadBinding } from '../../../src/notion/binding/load-binding';
import { generateBinding } from '../../../src/notion/workspace/workspace-binding';
import { readWorkspaceContract } from '../../../src/notion/workspace/workspace-contract';
import { formulasToEnter, writeFormulas } from '../../../src/notion/workspace/workspace-formulas';
import { readLedger, writeLedger } from '../../../src/notion/workspace/workspace-ledger';
import {
  dataSourceReader,
  differences,
  readWorkspace,
  unseenDatabases,
  workspaceIdOf,
} from '../../../src/notion/workspace/workspace-schema';
import { syncWorkspace } from '../../../src/notion/workspace/workspace-sync';
import { AppError } from '../../../src/platform/error/app-error';
import { messageOf, stackOf } from '../../../src/platform/error/message-of';
import { GATE_MAPPING_FILE } from '../gate-boot';
import { captureOverlayOf, capturePropertyId, withCaptureOverlay } from './capture-overlay';
import { connectorScopes, scopeProblems } from './connector-scopes';
import { assertNotWorking } from './working-guard';

/**
 * Preparation of the gate workspace (`bin/gate prepare`, ADR 0041) builds the schema of the
 * contract `contracts/notion-workspace.yaml` in the gate workspace, checks that the gate
 * integration sees every database, and writes the gate binding. The person enters the formula
 * expressions in the interface: preparation writes their text to a file and checks what was
 * entered. Finally it checks that the Notion MCP grant is issued on the gate workspace and that
 * the GBrain client writes to the gate source and reads only it.
 * `--check` writes nothing: it checks the schema, the formulas, the binding and the connector
 * credentials before a gate run.
 *
 * Preparation has no token of the main Notion integration: the schema comes from the contract, and
 * preparation learns that the gate is not in the main workspace from the `workspace` key of the
 * main binding.
 *
 * Exit code: 0 means the gate workspace is ready; 6 means a person's action is needed (integration
 * access, formulas, connector credentials, preparing again); 1 means a failure.
 */

const NOT_READY = 6;

/**
 * The contract sits next to the compiled gate: `/app/dist-gate/test/gate/workspace` →
 * `/app/contracts`.
 */
const CONTRACT_FILE = resolve(__dirname, '../../../../contracts/notion-workspace.yaml');

/**
 * What preparation has already built: database title → gate data source. It sits next to the gate
 * binding.
 */
const BUILT_FILE = join(dirname(GATE_MAPPING_FILE), 'workspace.yaml');

const BUILT_TITLE =
  "Databases of the gate's workspace built by `bin/gate prepare`: title -> data source.";

/**
 * The text of the formulas the person enters in the interface. On the host it is
 * `infra/gate/formulas.md` (Compose).
 */
const FORMULAS_FILE = join(dirname(GATE_MAPPING_FILE), 'formulas.md');

/** A discrepancy the person removes, not a retry: its text is the advice. */
class NotReady extends AppError {}

interface Environment {
  /** The main binding: only the workspace is taken from it, the one the gate must not be in. */
  readonly workingBindingFile: string | undefined;
  readonly gateToken: string;
  readonly personalToken: string | undefined;
  readonly version: string;
}

function environment(env: NodeJS.ProcessEnv, building: boolean): Environment {
  const value = (name: string): string => {
    const text = env[name];

    if (!text) throw new Error(`${name} is not set; run gate prepare through infra/bin/gate`);

    return text;
  };

  if (env.NOTION_MAPPING_FILE !== GATE_MAPPING_FILE) {
    throw new Error(
      `NOTION_MAPPING_FILE is not ${GATE_MAPPING_FILE}: this is not the gate environment`,
    );
  }

  return {
    workingBindingFile: env.GATE_SOURCE_MAPPING_FILE || undefined,
    gateToken: value('NOTION_API_TOKEN'),
    personalToken: building ? value('GATE_NOTION_PERSONAL_TOKEN') : undefined,
    version: value('NOTION_API_VERSION'),
  };
}

function notSeen(titles: readonly string[]): NotReady {
  return new NotReady(
    `the gate integration does not see ${titles.join(', ')}: open them to it in its settings ` +
      '(Notion → Settings → Connections → the gate integration → Access), then run bin/gate prepare',
  );
}

async function prepare(args: readonly string[], log: (line: string) => void): Promise<void> {
  const unknown = args.filter((arg) => arg !== '--check');

  if (unknown.length > 0) {
    throw new Error(`unknown arguments: ${unknown.join(' ')}; usage: prepare [--check]`);
  }

  const checking = args.includes('--check');
  const env = environment(process.env, !checking);
  const client = (auth: string): Client => new Client({ auth, notionVersion: env.version });
  const gateClient = client(env.gateToken);
  const gateWorkspace = await workspaceIdOf(gateClient, 'the gate integration');

  assertNotWorking(env.workingBindingFile, gateWorkspace, log);

  const contract = readWorkspaceContract(CONTRACT_FILE);
  // The schema the gate keeps: the contract plus the gate's overlay for the capture time — the
  // only deliberate divergence, so the check runs against it and not against the contract alone.
  const overlay = captureOverlayOf(contract);
  const target = withCaptureOverlay(contract.databases, overlay);
  let built = readLedger(BUILT_FILE);

  if (checking && built.size === 0) {
    throw new NotReady('the gate workspace is not built yet: run bin/gate prepare');
  }

  if (env.personalToken !== undefined) {
    const personal = client(env.personalToken);

    if ((await workspaceIdOf(personal, 'the personal token')) !== gateWorkspace) {
      throw new Error('the personal token and the gate integration belong to different workspaces');
    }

    built = await syncWorkspace({
      notion: personal,
      target,
      built,
      record: (recorded) => writeLedger(BUILT_FILE, recorded, BUILT_TITLE),
      log,
    });
    writeLedger(BUILT_FILE, built, BUILT_TITLE);

    const left = differences(
      target,
      await readWorkspace(dataSourceReader(personal, 'the personal token'), [...built.values()]),
    );

    if (left.length > 0) {
      throw new Error(`the gate workspace still differs after building:\n  ${left.join('\n  ')}`);
    }

    log("the gate workspace has the contract's schema and the gate's capture overlay");
  }

  const hidden = await unseenDatabases(gateClient, built);

  if (hidden.length > 0) throw notSeen(hidden);

  const gate = await readWorkspace(dataSourceReader(gateClient, 'the gate integration'), [
    ...built.values(),
  ]);
  const drift = differences(target, gate);

  if (drift.length > 0) {
    throw new NotReady(
      `the gate workspace differs from the contract with the gate's capture overlay — run bin/gate prepare:\n  ${drift.join('\n  ')}`,
    );
  }

  const binding = generateBinding({
    named: contract.binding,
    live: gate,
    workspace: gateWorkspace,
    command: 'bin/gate prepare',
    overrides: {
      'inbox_item.captured_at': { kind: 'native', propertyId: capturePropertyId(gate, overlay) },
    },
  }).text;

  loadBinding(binding, GATE_MAPPING_FILE);

  const formulas = formulasToEnter(target, gate);

  // A signal enters the binding only from a formula that has an expression: until the formulas
  // are entered, a binding without signals is the norm, and checking it makes no sense.
  if (checking) {
    const current = existsSync(GATE_MAPPING_FILE) ? readFileSync(GATE_MAPPING_FILE, 'utf8') : null;

    if (formulas.length === 0 && current !== binding) {
      throw new NotReady('the gate binding is out of date: run bin/gate prepare');
    }
  } else {
    writeFileSync(GATE_MAPPING_FILE, binding);
    log(`the gate binding is written to ${GATE_MAPPING_FILE}`);
    writeFormulas(FORMULAS_FILE, formulas, [
      'The gate does not start before every formula below is entered.',
      'Afterwards run `bin/gate prepare`: it reads the formulas back and binds their signals.',
    ]);
  }

  if (formulas.length > 0) {
    throw new NotReady(
      `${formulas.length} formulas are not yet entered in the gate workspace as in the contract: ` +
        `${formulas.map(({ database, property }) => `${database}."${property}"`).join(', ')}; ` +
        'their text is in infra/gate/formulas.md (bin/gate prepare writes it): paste each one ' +
        'into its property, then run bin/gate prepare',
    );
  }

  const problems = scopeProblems(await connectorScopes(), gateWorkspace);

  if (problems.length > 0) throw new NotReady(problems.join('; '));

  log(
    "the gate workspace, its formulas and its binding match the contract's; " +
      "the Notion MCP grant and the GBrain client are the gate's",
  );
}

const log = (line: string): void => {
  process.stderr.write(`gate prepare: ${line}\n`);
};

prepare(process.argv.slice(2), log).catch((error: unknown) => {
  if (error instanceof NotReady) {
    log(error.message);
    process.exitCode = NOT_READY;

    return;
  }

  log(stackOf(error) ?? messageOf(error));
  process.exitCode = 1;
});
