/**
 * A type-level assertion: `T` must be `true`. If the shapes it checks diverge, the build fails, not
 * the behavior at runtime.
 */
export type Assert<T extends true> = T;
