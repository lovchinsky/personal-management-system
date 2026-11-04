import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isElementAccessExpression,
  isIdentifier,
  isImportSpecifier,
  isPropertyAccessExpression,
  isStringLiteral,
  Node,
} from 'typescript';
import { APP, appSources, importsOf, locationsIn, SRC } from './sources';

/**
 * An App entry point that needs the environment before the settings: `app.module.ts` decides
 * whether to read `.env` (`NODE_ENV`).
 */
const ENTRY_POINTS: readonly string[] = [resolve(SRC, 'app.module.ts')];

/**
 * The gate boot is a test, not App code: it sets the environment of its own App instance before
 * importing the App.
 */
const GATE_BOOT = resolve(APP, 'test/gate/gate-boot.ts');

/**
 * Returns the files reached by the chain of imports from `entry`, static and dynamic `import()`
 * alike. The gate boot uses a dynamic `import()` to defer loading the application until the
 * environment is set, but those calls are in `test/gate/m*.gate.ts`, which are not the entry. The
 * entry is `test/gate/gate-boot.ts`, which does not import the application.
 */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [entry];

  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;

    seen.add(file);
    queue.push(...importsOf(file).flatMap(({ target }) => (target === null ? [] : [target])));
  }

  return seen;
}

/**
 * Checks whether the file is a config namespace factory, the only place where the environment
 * becomes a value.
 */
function isNamespace(file: string): boolean {
  return file.endsWith('.config.ts');
}

interface Mentions {
  /** Imports of `ConfigService`: settings by string key. */
  readonly configService: string[];
  /** References to `process.env`. */
  readonly env: string[];
}

/** Checks whether the node is `process.env` or `process['env']`. */
function readsEnv(node: Node): boolean {
  if (isPropertyAccessExpression(node)) {
    return (
      isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'
    );
  }

  return (
    isElementAccessExpression(node) &&
    isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === 'env'
  );
}

/** Checks whether the node is an import of `ConfigService`, under its own name or an alias. */
function importsConfigService(node: Node): boolean {
  return isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'ConfigService';
}

/** Finds every access to settings that bypasses the owner's namespace. */
function mentionsIn(file: string, code: string): Mentions {
  return {
    configService: locationsIn(file, code, importsConfigService),
    env: locationsIn(file, code, readsEnv),
  };
}

function mentions(file: string): Mentions {
  return mentionsIn(file, readFileSync(file, 'utf8'));
}

/**
 * `INV-093` Settings arrive typed, from the config namespace of the owning module: nobody imports
 * `ConfigService` in App code, and only the config namespace factories (`*.config.ts`) and the
 * entry point `app.module.ts` read the environment.
 */
describe('INV-093', () => {
  const shipped = appSources();

  it('nobody imports ConfigService in App code', () => {
    expect(shipped.flatMap((file) => mentions(file).configService)).toEqual([]);
  });

  it('only the namespace factories and the entry point read the environment', () => {
    const outside = shipped.filter((file) => !isNamespace(file) && !ENTRY_POINTS.includes(file));

    expect(outside.flatMap((file) => mentions(file).env)).toEqual([]);
  });

  /**
   * `gate-boot.ts` sets the environment before `AppModule` reads it. An import that leads to the
   * application module would run the environment check before the prelude, so this file stays
   * light.
   */
  it('gate-boot does not pull in the application through imports', () => {
    expect([...reachableFrom(GATE_BOOT)]).not.toContain(resolve(SRC, 'app.module.ts'));
    expect(reachableFrom(GATE_BOOT).size).toBeGreaterThan(1);
  });

  /** Otherwise an empty walk or a blind scanner would pass the checks above silently. */
  it('finds the namespace factories and the entry points', () => {
    const readers: string[] = [
      resolve(SRC, 'platform/db/database.config.ts'),
      resolve(SRC, 'claude/runner/runner.config.ts'),
      ...ENTRY_POINTS,
      GATE_BOOT,
    ];

    expect(readers.filter((file) => mentions(file).env.length === 0)).toEqual([]);
  });

  /** A scanner blind to one form would let that form through. */
  it('recognizes every form of access, but not a comment', () => {
    const imports: string[] = [
      "import { ConfigService } from '@nestjs/config';",
      "import { ConfigService as Settings } from '@nestjs/config';",
      "import { ConfigModule, type ConfigService } from '@nestjs/config';",
    ];
    const reads: string[] = [
      'const url = process.env.DATABASE_URL;',
      "const url = process.env['DATABASE_URL'];",
      "const env = process['env'];",
      'const { DATABASE_URL } = process.env;',
    ];
    const none: Mentions = { configService: [], env: [] };

    expect(
      imports.filter((code) => mentionsIn('probe.ts', code).configService.length === 0),
    ).toEqual([]);
    expect(reads.filter((code) => mentionsIn('probe.ts', code).env.length === 0)).toEqual([]);
    expect(mentionsIn('probe.ts', '// process.env.X і ConfigService у коментарі\n')).toEqual(none);
  });
});
