import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isBinaryExpression,
  isCallExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isStringLiteral,
  Node,
  PropertyAccessExpression,
  SyntaxKind,
} from 'typescript';
import { environmentSchema } from '../../src/config/env.validation';
import { appSources, locations, locationsIn, nodesIn, SRC } from './sources';

/** Checks whether a node is `process.env.X`. */
function isEnvRead(node: Node): node is PropertyAccessExpression {
  return (
    isPropertyAccessExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'process' &&
    node.expression.name.text === 'env'
  );
}

/** Checks whether a node is a value passed to `optional()` or `required()`. */
function isNormalized(node: Node): boolean {
  const call = node.parent;

  return (
    isCallExpression(call) &&
    call.arguments[0] === node &&
    isIdentifier(call.expression) &&
    ['optional', 'required'].includes(call.expression.text)
  );
}

/** Checks whether a node is a value compared with a literal: `=== 'true'`, `!== 'false'`. */
function isCompared(node: Node): boolean {
  const comparison = node.parent;

  return (
    isBinaryExpression(comparison) &&
    [SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken].includes(
      comparison.operatorToken.kind,
    ) &&
    isStringLiteral(comparison.left === node ? comparison.right : comparison.left)
  );
}

/** Checks whether a node accesses an environment variable that takes an empty value as set. */
function takesEmptyAsSet(node: Node): boolean {
  return isEnvRead(node) && !isNormalized(node) && !isCompared(node);
}

/** Returns the names of the variables a file reads. */
function namesReadIn(file: string): string[] {
  return nodesIn(file, readFileSync(file, 'utf8'), isEnvRead).map(({ node }) => node.name.text);
}

/**
 * An empty value of an environment variable is the same as an absent one, because Compose passes an
 * unset variable as an empty string (`docs/2-system.md` § “Configuration contract App”). A
 * namespace factory takes the value through `optional()` or `required()`, or compares it with a
 * literal, and then “absent” has one form in every namespace.
 */
describe('environment variable values', () => {
  const namespaces = appSources().filter((file) => file.endsWith('.config.ts'));

  it('namespace factories do not take an empty value as set', () => {
    expect(namespaces.flatMap((file) => locations(file, takesEmptyAsSet))).toEqual([]);
  });

  /**
   * A variable with no shape in the environment check would pass a bad value on to the consumer
   * instead of stopping startup. `PATH` is the process environment, which the runner passes on.
   */
  it('the environment check knows every variable that a factory reads', () => {
    const unchecked = namespaces
      .flatMap(namesReadIn)
      .filter((name) => name !== 'PATH' && !(name in environmentSchema.shape));

    expect(unchecked).toEqual([]);
  });

  /** Without this, an empty walk would pass the check above silently. */
  it('finds the factories that read the environment', () => {
    const reader = resolve(SRC, 'telegram/telegram.config.ts');

    expect(namespaces).toContain(reader);
    expect(locations(reader, isEnvRead).length).toBeGreaterThan(0);
  });

  /** A scanner that is blind to one form would miss that form. */
  it('recognizes a bare read but not a normalized or compared one', () => {
    const bare: string[] = [
      "const token = process.env.TELEGRAM_BOT_TOKEN ?? '';",
      'const url = process.env.APP_MCP_URL;',
    ];
    const accepted: string[] = [
      'const url = optional(process.env.APP_MCP_URL);',
      "const url = required(process.env.DATABASE_URL, 'DATABASE_URL');",
      "const on = process.env.RUNNER_ENABLED === 'true';",
      "const on = 'false' !== process.env.WORKERS_ENABLED;",
    ];

    expect(
      bare.filter((code) => locationsIn('probe.ts', code, takesEmptyAsSet).length === 0),
    ).toEqual([]);
    expect(accepted.flatMap((code) => locationsIn('probe.ts', code, takesEmptyAsSet))).toEqual([]);
  });
});
