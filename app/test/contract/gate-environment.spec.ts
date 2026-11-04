import { resolve } from 'node:path';
import { isIdentifier, isPropertyAccessExpression, type Node } from 'typescript';
import { GATE_DATABASE, GATE_MAPPING_FILE } from '../gate/gate-boot';
import { composeFile, repoFile } from './contracts';
import { APP, locations, shippedSources } from './sources';

/**
 * The gate environment (ADR 0041) is stated in three places: the `gate` service in Compose sets the
 * values, the gate entry point checks them, and `infra/bin/gate` creates and migrates the
 * database. If they diverged, the gate would either refuse to start or migrate one database and
 * work in a different one.
 */
describe('the gate environment', () => {
  const gate = composeFile('infra/compose.yaml').services.gate;
  const app = composeFile('infra/compose.yaml').services.app;

  it('Compose sets the database and the binding that the gate entry point checks', () => {
    expect(gate?.environment?.DATABASE_URL).toMatch(new RegExp(`/${GATE_DATABASE}$`));
    expect(gate?.environment?.NOTION_MAPPING_FILE).toBe(GATE_MAPPING_FILE);
  });

  /**
   * The gate worlds and phrasing pools are Ukrainian and the gate checks the Ukrainian catalog, so
   * the gate App's language is fixed here instead of following the main installation's.
   */
  it('Compose fixes the gate App language at Ukrainian', () => {
    expect(gate?.environment?.APP_LANGUAGE).toBe('uk');
  });

  it('bin/gate creates and migrates the same database', () => {
    expect(repoFile('infra/bin/gate')).toMatch(new RegExp(`^GATE_DATABASE=${GATE_DATABASE}$`, 'm'));
  });

  /**
   * The gate has none of the main values: otherwise an App command in its container would write
   * to the main database.
   */
  it('the main database, token and binding are replaced in the gate', () => {
    for (const name of [
      'DATABASE_URL',
      'NOTION_API_TOKEN',
      'NOTION_MAPPING_FILE',
      'GBRAIN_CLIENT_ID',
    ]) {
      expect(gate?.environment?.[name]).not.toBe(app?.environment?.[name]);
    }
  });
});

/** Checks whether a node is `process.stdout`, both as a property access and when passed on. */
function writesStdout(node: Node): boolean {
  return (
    isPropertyAccessExpression(node) &&
    isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'stdout'
  );
}

/**
 * The gate verdict is one JSON document on stdout (`> gate-mN.json`). The stop guard writes it
 * through the session: the guard writes no verdict when the gate is stopped, and no stub after the
 * verdict. A gate that wrote to stdout itself would produce two documents in one file.
 */
describe('the gate verdict', () => {
  it('only the gate session writes to stdout', () => {
    const gate = resolve(APP, 'test/gate');
    const writers = shippedSources(gate).filter((file) => locations(file, writesStdout).length > 0);

    expect(writers).toEqual([resolve(gate, 'gate-session.ts')]);
  });
});
