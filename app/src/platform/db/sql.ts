import { Prisma } from '../../generated/prisma/client';

/** Quotes an SQL identifier. The name comes only from constants in the code, not from data. */
function identifier(name: string): Prisma.Sql {
  return Prisma.raw(`"${name}"`);
}

/** Builds the condition that `"status"` equals `status`; `enumName` is the Postgres enum type. */
export function statusIs(enumName: string, status: string): Prisma.Sql {
  return Prisma.sql`"status" = ${status}::${identifier(enumName)}`;
}

/** Builds the condition that `"status"` is one of `statuses`. */
export function statusIn(enumName: string, statuses: readonly string[]): Prisma.Sql {
  return Prisma.sql`"status" = ANY(${[...statuses]}::${identifier(enumName)}[])`;
}

/**
 * Builds the condition that the time in column `column` is older than `days` days, by the
 * database's clock.
 */
export function olderThanDays(column: string, days: number): Prisma.Sql {
  return Prisma.sql`${identifier(column)} < now() - make_interval(days => ${days}::int)`;
}
