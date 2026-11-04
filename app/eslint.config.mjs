// @ts-check
import eslint from '@eslint/js';
import jest from 'eslint-plugin-jest';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Constructs the code does not contain, or contains in one place only. A construct with a `home`
 * is allowed only in that file: the single implementation lives there, and the rest of the code
 * calls it.
 */
const ONE_PLACE = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Use new Date() and date-fns for time: addSeconds, differenceInMilliseconds, etc.',
  },
  {
    home: 'src/platform/error/message-of.ts',
    selector:
      "ConditionalExpression[test.type='BinaryExpression'][test.operator='instanceof'][test.right.name='Error']",
    message:
      'Use messageOf and stackOf for the text and stack of an exception (platform/error/message-of).',
  },
  {
    home: 'src/platform/error/app-error.ts',
    selector: "ClassDeclaration[superClass.name='Error']",
    message: 'Derive a custom error from AppError (platform/error/app-error).',
  },
  {
    // `SchemaMapping*` and `get_schema_mapping` are external names: that is the name of an App MCP
    // tool.
    selector: 'Identifier[name=/^(?!(schema|Schema)Mapping|get_schema_mapping$)\\w*[Mm]apping/]',
    message:
      'Use `binding`, not `mapping`: the word `mapping` stays in external names (`SchemaMapping*`, `get_schema_mapping`, `NOTION_MAPPING_FILE`, the file `infra/notion/mapping.yaml`).',
  },
];

/**
 * Returns the `no-restricted-syntax` setting with all the constructs except those allowed in the
 * `home` file.
 */
function restricted(home) {
  return [
    'error',
    ...ONE_PLACE.filter((rule) => home === undefined || rule.home !== home).map(
      ({ selector, message }) => ({
        selector,
        message,
      }),
    ),
  ];
}

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'build/**',
      'prisma/**',
      'node_modules/**',
      'coverage/**',
      'src/generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      // A braceless body on the next line is a trap: a line added under it looks like part of
      // the condition, and `--fix` silently shifts it to the left.
      curly: ['error', 'multi-line'],
      // Without `await`, an exception from the `return` expression does not reach the `catch` of
      // the same function.
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      'no-restricted-syntax': restricted(undefined),
      // zod validates the shape of data, with a schema next to the code; the App has no
      // decorator-based validation library.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'class-validator', message: 'Validate the shape with zod.' },
            { name: 'class-transformer', message: 'Validate the shape with zod.' },
          ],
        },
      ],
    },
  },
  {
    // Production code: a function that outgrows these limits is split into steps, and a module
    // boundary names its types explicitly.
    files: ['src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      complexity: ['error', 20],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  ...ONE_PLACE.filter((rule) => rule.home !== undefined).map(({ home }) => ({
    files: [home],
    rules: { 'no-restricted-syntax': restricted(home) },
  })),
  {
    // Test data gets its type from its structure, not from a type assertion; `as const` is not a
    // type assertion.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    ...jest.configs['flat/recommended'],
    rules: {
      ...jest.configs['flat/recommended'].rules,
      'jest/unbound-method': 'error',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      'jest/expect-expect': [
        'warn',
        { assertFunctionNames: ['expect', 'request.**.expect', '**.expect'] },
      ],
    },
  },
  {
    // The contract lane reads YAML and code through a schema or the compiler, not through a type
    // assertion: `any` is not allowed in it, even in specs, where the rule is turned off above.
    files: ['test/contract/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
    },
  },
);
