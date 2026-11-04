import { InvalidRequestError } from '../../platform/request/invalid-request';

/**
 * A write that cannot be accepted: the kind of value does not fit the property type, the value is
 * non-canonical, the carrier cannot be written at all, or the page belongs to no canonical type.
 * It is a refusal, not a failure, because it is the request that has to change.
 *
 * It does not depend on the page's data. A write that is unacceptable only together with what is
 * on the page is `UnwritableOnPageError`.
 */
export class UnwritableValueError extends InvalidRequestError {
  constructor(
    /** What the refusal is about: a slot, a field of the type or a page. */
    readonly subject: string,
    detail: string,
  ) {
    super(`${subject}: ${detail}`);
  }
}
