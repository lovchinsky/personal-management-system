/** Returns the text of an exception. In JavaScript anything can be thrown, not only an `Error`. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns the stack of an exception, if there is one. It is for the log, not for the person. */
export function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
