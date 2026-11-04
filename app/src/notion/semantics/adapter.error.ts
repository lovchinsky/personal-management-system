import { AppError } from '../../platform/error/app-error';

/**
 * The errors of semantic resolution (`contracts/canonical.yaml`, key `adapter_errors`). There are
 * three kinds, and they are not three exception classes. What tells them apart is the caller's
 * behavior, and it differs in all three.
 *
 * `configuration_error` is defined here. The blast radius is all records of the type, because
 *   there is one binding per workspace, and until the file is edited a retry changes nothing. It
 *   is the only one of the three for which stopping is the right behavior, and so it is the only
 *   exception.
 *
 * `schema_gap` is not an exception but the state of one field: a `Reading` in state `gap`.
 *   Reading of the rest of the record continues.
 *
 * `ambiguous_input` does not arise in App code. Ambiguity lives in the person's wording of the
 *   input (“Friday” may mean the time of execution or a deadline), and the model resolves it with
 *   a question (`INV-007`), not a deterministic resolution.
 */

/** A slot for which the binding named an unusable property. */
export interface MisboundSlot {
  readonly slot: string;
  /** The id the binding named. */
  readonly named: string;
  readonly detail: string;
}

export class AdapterConfigurationError extends AppError {
  readonly kind = 'configuration_error';

  constructor(
    readonly type: string,
    readonly misbound: readonly MisboundSlot[],
  ) {
    super(
      [
        `Notion mapping cannot serve canonical type ${type} — misbound slots: ${misbound.length}`,
        ...misbound.map(({ slot, named, detail }) => `  ${slot} :: ${detail} (named ${named})`),
        'Fix infra/notion/mapping.yaml — retrying will not change the outcome.',
      ].join('\n'),
    );
  }
}
