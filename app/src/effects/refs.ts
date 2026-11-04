/**
 * The kind of a temporary reference between the writes of one run.
 *
 * A write that creates something new mints, before it is applied, a temporary id for what it will
 * create, and other writes of the same run can point to it. The reference gets its real id when
 * the write that minted it has been applied.
 */
export type RefKind = 'proposal' | 'discussion' | 'page';

/** What the check of a write sees of the temporary references. */
export interface RefView {
  /** Checks whether a write of this run minted this id as a reference of this kind. */
  minted(kind: RefKind, id: string): boolean;
}

/** What applying a write sees of the temporary references. */
export interface Refs extends RefView {
  /**
   * Returns the real id. For a reference minted by this run, that is the id the applied write got;
   * for any other, it is the id itself.
   */
  resolve(kind: RefKind, id: string): string;
}
