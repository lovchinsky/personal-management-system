import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';

/**
 * Checks whether an error is a unique index violation, including a violation of a partial index,
 * through which a table enforces “at most one open row”.
 *
 * For the caller a violation is an answer, not a failure: such a row already exists, and the
 * table's owner decides what to do about it.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** The Postgres code that the driver puts in the `meta` of a query error. */
const postgresCode = z.object({ code: z.string() });

/**
 * Checks whether an error is `42P01`, `undefined_table`: the table the query refers to does not
 * exist in the database.
 */
export function isMissingTable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    postgresCode.safeParse(error.meta).data?.code === '42P01'
  );
}
