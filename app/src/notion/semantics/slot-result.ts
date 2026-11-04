import { MisboundSlot } from './adapter.error';
import { Reading } from './reading';

/**
 * The result of one slot: either a value that was read, or an unusable binding.
 *
 * The two are kept apart on purpose. `Reading` describes the state of a field on a record, and an
 * unusable binding is not a state of a field: its blast radius is different (all records of the
 * type) and so is the caller's behavior (stop). If an unusable binding arrived as one more
 * `Reading` state, a detector could read it as “the field is not there”.
 */
export type SlotResult =
  | { readonly ok: true; readonly reading: Reading }
  | { readonly ok: false; readonly problem: MisboundSlot };

export const Slot = {
  read: (reading: Reading): SlotResult => ({ ok: true, reading }),
  misbound: (slot: string, named: string, detail: string): SlotResult => ({
    ok: false,
    problem: { slot, named, detail },
  }),
} as const;
