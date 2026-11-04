import { resolve } from 'node:path';
import { isIdentifier, isStringLiteral, isTemplateLiteralToken, Node } from 'typescript';
import { appSources, locations, locationsIn, SRC, within } from './sources';

const RUNS = resolve(SRC, 'runs');
const QUEUE = resolve(SRC, 'platform/queue');

/** Columns that the rules of a run row are based on: the attempt and the attempt time. */
const RULE_COLUMNS: readonly string[] = ['attempt_count', 'last_attempt_at'];

/** The row's attempt limit is a number from the budget. */
const ATTEMPT_LIMIT = 'workRowMaxAttempts';

/**
 * Checks whether the text names a rule of a run row: the attempt column in any letter case (an
 * unquoted SQL identifier has no case) or the attempt limit.
 */
function namesRule(text: string): boolean {
  const lower = text.toLowerCase();

  return RULE_COLUMNS.some((column) => lower.includes(column)) || text.includes(ATTEMPT_LIMIT);
}

/**
 * Checks whether the node refers to the rules of a run row: the identifier of the attempt limit,
 * or a string or template piece that names the attempt column or the limit. The client field
 * `attemptCount`, read as a value, is not a rule.
 */
function mentionsRule(node: Node): boolean {
  return isIdentifier(node)
    ? node.text === ATTEMPT_LIMIT
    : (isStringLiteral(node) || isTemplateLiteralToken(node)) && namesRule(node.text);
}

function mentionsIn(file: string, code: string): string[] {
  return locationsIn(file, code, mentionsRule);
}

function ruleMentions(file: string): string[] {
  return locations(file, mentionsRule);
}

/**
 * `INV-091` The rules of a run row — recording an attempt, refunding it, the attempt limit — live
 * only in `runs/` and `platform/queue/`: outside them there is neither SQL that writes
 * `attempt_count` or `last_attempt_at` nor a read of the limit `work_row_max_attempts`. The run
 * queue provides a description and does not repeat the rules.
 */
describe('INV-091', () => {
  const outside = appSources().filter((file) => !within(RUNS, file) && !within(QUEUE, file));

  it('nobody outside runs/ and platform/queue writes the rules of a run row', () => {
    expect(outside.flatMap(ruleMentions)).toEqual([]);
  });

  /** Otherwise an empty walk would pass the check above silently. */
  it('finds the owners of the run queues and the rules themselves', () => {
    expect(outside).toEqual(
      expect.arrayContaining([
        resolve(SRC, 'continuations/scheduled-check.rows.ts'),
        resolve(SRC, 'continuations/scheduled-check.repository.ts'),
        resolve(SRC, 'intake/notion/evaluation-window.rows.ts'),
        resolve(SRC, 'intake/notion/evaluation-window.repository.ts'),
        resolve(SRC, 'delivery/outbox/outbox.repository.ts'),
      ]),
    );
    expect(ruleMentions(resolve(RUNS, 'run-row-source.ts'))).not.toHaveLength(0);
    expect(ruleMentions(resolve(RUNS, 'run-row.policy.ts'))).not.toHaveLength(0);
  });

  /** A scanner blind to one form would let that form through. */
  it('recognizes every form of reference, but not a comment or the attempt field', () => {
    const forms: string[] = [
      'Prisma.sql`"attempt_count" = "attempt_count" + 1`;',
      'Prisma.sql`"last_attempt_at" = now()`;',
      "Prisma.raw('ATTEMPT_COUNT');",
      "config.getOrThrow<number>('budget.workRowMaxAttempts');",
      'afterAttempts(budget.workRowMaxAttempts);',
    ];

    expect(forms.filter((code) => mentionsIn('probe.ts', code).length === 0)).toEqual([]);
    expect(mentionsIn('probe.ts', '// attempt_count і workRowMaxAttempts у коментарі\n')).toEqual(
      [],
    );
    expect(mentionsIn('probe.ts', 'const next = row.attemptCount + 1;')).toEqual([]);
  });
});
