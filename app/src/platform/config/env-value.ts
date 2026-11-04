/**
 * Returns the value of an environment variable, if it is set. An empty value counts as absent,
 * because Compose passes an unset variable as an empty string and “absent” must have one form in
 * every config namespace.
 */
export function optional(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

/**
 * Returns a setting value that is needed to continue, or refuses with an error that names the
 * environment variable.
 *
 * The same refusal serves both cases. The namespace factory requires the mandatory values at
 * startup. A consumer requires a value that is needed only when the runner is enabled, at the
 * point where it is needed.
 */
export function required(value: string | undefined, name: string): string {
  const present = optional(value);
  if (present === undefined) {
    throw new Error(`${name} is not set`);
  }

  return present;
}
