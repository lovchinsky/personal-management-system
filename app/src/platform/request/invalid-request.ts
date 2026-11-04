import { z } from 'zod';
import { AppError } from '../error/app-error';

/**
 * A request that the capability did not accept: a fault of whoever composed it, not a state of
 * the system.
 *
 * Retrying the same request yields the same refusal, so the request must change. The transport
 * (App MCP) needs a common class: it recognizes the refusal by that class and returns it to the
 * caller, who corrects the request, instead of hiding it in a failure that would only be
 * retried.
 */
export class InvalidRequestError extends AppError {}

/**
 * Returns a request checked against the capability's schema, or refuses with an error that names
 * all the request's problems together, not just the first.
 */
export function parsedRequest<Schema extends z.ZodType>(
  schema: Schema,
  request: unknown,
  what: string,
): z.output<Schema> {
  const parsed = schema.safeParse(request);
  if (!parsed.success) {
    throw new InvalidRequestError(`${what}: ${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
}
