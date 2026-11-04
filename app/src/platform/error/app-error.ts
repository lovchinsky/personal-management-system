/**
 * The App's own error: the name is the class name, the cause is the error that caused it.
 *
 * The base class sets the name, instead of each subclass setting it with a string, because a
 * string that diverged from the class name would make the log lie.
 */
export abstract class AppError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);

    this.name = new.target.name;
  }
}
