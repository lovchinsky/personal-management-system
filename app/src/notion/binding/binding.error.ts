import { AppError } from '../../platform/error/app-error';

/**
 * The binding is unusable. The list of problems is complete because the person must see it in one
 * launch.
 */
export class BindingError extends AppError {
  constructor(
    readonly origin: string,
    readonly problems: readonly string[],
  ) {
    super(
      [
        `Notion mapping ${origin} is unusable — problems: ${problems.length}`,
        ...problems.map((problem) => `  ${problem}`),
      ].join('\n'),
    );
  }
}
