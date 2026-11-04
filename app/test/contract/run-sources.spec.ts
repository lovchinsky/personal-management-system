import { readFileSync } from 'node:fs';
import { isClassDeclaration, isExpressionWithTypeArguments, SyntaxKind } from 'typescript';
import { runSourcesProvider } from '../../src/scheduling/run-sources.provider';
import { appSources, nodesIn } from './sources';

/** Lists the names of the classes that extend `RunRowSource`: each of them is a run source. */
function sourceClasses(): string[] {
  return appSources().flatMap((file) =>
    nodesIn(file, readFileSync(file, 'utf8'), isClassDeclaration).flatMap(({ node }) => {
      const extendsRows = (node.heritageClauses ?? []).some(
        (clause) =>
          clause.token === SyntaxKind.ExtendsKeyword &&
          clause.types.some(
            (type) =>
              isExpressionWithTypeArguments(type) && type.expression.getText() === 'RunRowSource',
          ),
      );

      return extendsRows && node.name ? [node.name.text] : [];
    }),
  );
}

/**
 * There is one list of run sources: the scheduler and pruning both read it
 * (`docs/2-system.md` § “Scheduler and outbox”). A source missing from the list is invisible
 * to the scheduler and untouched by pruning: its concluded rows would stay forever.
 */
describe('the list of run sources', () => {
  it('contains every source that exists in the code', () => {
    const listed = (runSourcesProvider.inject ?? []).flatMap((token) =>
      typeof token === 'function' ? [token.name] : [],
    );

    expect(listed.sort()).toEqual(sourceClasses().sort());
  });

  /** Without this, a traversal that sees no class at all would pass the check above silently. */
  it('finds all three existing sources', () => {
    expect(sourceClasses().sort()).toEqual([
      'EvaluationWindowRunSource',
      'ReviewOccurrenceRunSource',
      'ScheduledCheckRunSource',
    ]);
  });
});
