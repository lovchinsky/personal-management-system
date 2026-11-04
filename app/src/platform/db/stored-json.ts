import { Prisma } from '../../generated/prisma/client';

/**
 * Returns the value in the form in which it is written to a `jsonb` column.
 *
 * Passing the value through `JSON` does two necessary things: it removes `undefined`, which JSON
 * does not have, and strips `readonly` from arrays, which Prisma does not accept.
 *
 * The type assertion is kept in this one place on purpose: `JSON.parse` returns `any`, and
 * without the assertion one would have to either silence the lint rule in every repository or
 * declare one's own copy of Prisma's recursive type. There is nothing to check here, because the
 * value has just been serialized.
 */
export function storedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
