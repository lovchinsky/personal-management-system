import { InvalidRequestError } from '../../platform/request/invalid-request';

/**
 * A write that cannot be accepted **for what is currently on the page**: the request is correct
 * in itself, but together with the page's data it would leave the page in a state the model does
 * not allow (`Next Action` with a planned date, `INV-005`).
 *
 * It differs from `UnwritableValueError` by its cause, not by its tone. An `UnwritableValueError`
 * refusal is caused by the request, whatever the state of the page, and the request has to
 * change. An `UnwritableOnPageError` refusal is caused by the state of the page, and with a
 * different state the answer would be different. So when the proposal is made, the error is the
 * same refusal with a reason, and at execution it is a change of state after the proposal
 * (`conflict`, `INV-027`), not an authoring fault (`failed`).
 *
 * It covers only a refusal caused by the page's **data**. Refusals caused by its identity (a page
 * outside a canonical type) and by the schema (the physical type of a property) are
 * `UnwritableValueError`.
 */
export class UnwritableOnPageError extends InvalidRequestError {
  constructor(
    /** What the refusal is about: the field of the type that the write would leave inconsistent. */
    readonly subject: string,
    detail: string,
  ) {
    super(`${subject}: ${detail}`);
  }
}
