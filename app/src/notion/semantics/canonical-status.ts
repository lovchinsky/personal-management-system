import type { BindingFile } from '../binding/binding.schema';

/**
 * The canonical names of a set's options. There is one list of them, the one the binding accepts.
 */
type OptionsOf<K extends 'task.status' | 'project.status'> = keyof NonNullable<
  NonNullable<BindingFile['options']>[K]
>['canonical'];

/**
 * The canonical Task and Project statuses: the names by which the adapter reads them
 * (`docs/2-system.md` § “Separate status semantics”). Only `notion/binding/` and
 * `notion/semantics/` read the binding (`INV-081`), so it is this module that declares the list.
 * Rules over records already read take it from here, not from the binding.
 */
export type TaskStatus = OptionsOf<'task.status'>;
export type ProjectStatus = OptionsOf<'project.status'>;
