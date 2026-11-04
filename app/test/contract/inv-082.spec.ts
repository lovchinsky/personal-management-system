import { resolve } from 'node:path';
import { isIdentifier, isStringLiteral, isTemplateLiteralToken, Node } from 'typescript';
import { appSources, locations, locationsIn, SRC, within } from './sources';

const QUEUE = resolve(SRC, 'platform/queue');

/** The Prisma client field by which the code refers to the lease. */
const LEASE_FIELD = 'lockedUntil';

/**
 * Checks whether a text refers to the lease, by the SQL column or by the client field. Case is
 * ignored, because an unquoted SQL identifier is case-insensitive.
 */
function namesLease(text: string): boolean {
  const lower = text.toLowerCase();

  return lower.includes('locked_until') || lower.includes(LEASE_FIELD.toLowerCase());
}

/**
 * Checks whether a node is a reference to the lease. The field identifier appears in a property
 * access, an object literal, a destructuring or a type. A string or template fragment that names
 * the field or the column appears in `Pick<…, 'lockedUntil'>`, `row['lockedUntil']` or SQL.
 */
function mentionsLease(node: Node): boolean {
  return isIdentifier(node)
    ? node.text === LEASE_FIELD
    : (isStringLiteral(node) || isTemplateLiteralToken(node)) && namesLease(node.text);
}

function mentionsIn(file: string, code: string): string[] {
  return locationsIn(file, code, mentionsLease);
}

function leaseMentions(file: string): string[] {
  return locations(file, mentionsLease);
}

/**
 * `INV-082` Queue leases — `locked_until` — are written and compared only in `platform/queue/`.
 */
describe('INV-082', () => {
  const outside = appSources().filter((file) => !within(QUEUE, file));

  it('nothing outside platform/queue touches the lease', () => {
    expect(outside.flatMap(leaseMentions)).toEqual([]);
  });

  /** Without this, an empty walk would pass the check above silently. */
  it('finds the queue repositories and the lease code itself', () => {
    expect(outside).toEqual(
      expect.arrayContaining([
        resolve(SRC, 'continuations/scheduled-check.repository.ts'),
        resolve(SRC, 'intake/notion/evaluation-window.repository.ts'),
        resolve(SRC, 'delivery/outbox/outbox.repository.ts'),
      ]),
    );
    expect(leaseMentions(resolve(QUEUE, 'lease-queue.ts'))).not.toHaveLength(0);
  });

  /** A scanner blind to one form would miss that form. */
  it('recognizes every form of reference but not a comment', () => {
    const forms: string[] = [
      'row.lockedUntil;',
      "type Claimed = Pick<Row, 'lockedUntil'>;",
      "row['lockedUntil'];",
      'const { lockedUntil } = row;',
      'const where = { lockedUntil: null };',
      'Prisma.sql`UPDATE "t" SET "locked_until" = NULL`;',
      'Prisma.sql`WHERE "id" = ${id} AND "locked_until" = ${token}`;',
      "Prisma.raw('LOCKED_UNTIL');",
    ];

    expect(forms.filter((code) => mentionsIn('probe.ts', code).length === 0)).toEqual([]);
    expect(mentionsIn('probe.ts', '// lockedUntil і "locked_until" у коментарі\n')).toEqual([]);
  });
});
