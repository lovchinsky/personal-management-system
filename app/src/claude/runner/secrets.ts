import { mapStrings } from '../../platform/text/map-strings';

/**
 * A Bearer in the text, whoever it belongs to: a header that ended up in a CLI message or an
 * error.
 */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

/**
 * Returns the text without the run's secrets, for errors, stderr and the run trace.
 *
 * A run's Bearers end up on the subprocess command line (`mcpServers` is passed to the CLI as an
 * argument) and can come back in its errors. They reach the log, an exception or the trace
 * neither by name nor in the form of a header.
 */
export function redacted(text: string, secrets: readonly string[]): string {
  const named = secrets
    .filter((secret) => secret.length >= 8)
    .reduce((scrubbed, secret) => scrubbed.split(secret).join('[redacted]'), text);

  return named.replace(BEARER, '$1[redacted]');
}

/**
 * Returns a record in which every text value is free of the run's secrets (`redacted`). Tool call
 * arguments can be nested (a list, an object), so all text values are redacted at every level.
 */
export function redactedValues(
  record: Readonly<Record<string, unknown>>,
  secrets: readonly string[],
): Record<string, unknown> {
  return mapStrings(record, (text) => redacted(text, secrets));
}

/** Returns any stream value (text, list or record) free of the run's secrets at every level. */
export function redactedValue(value: unknown, secrets: readonly string[]): unknown {
  return redactedValues({ value }, secrets).value;
}
