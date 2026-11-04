import { BindingFile, CanonicalType, SignalSlot } from '../binding/binding.schema';
import { Reading, SchemaGap } from './reading';

/** A field of a canonical type: a name from the binding schema, so a typo fails to compile. */
export type FieldOf<T extends CanonicalType> = keyof BindingFile['fields'][T] & string;

/** A signal of a canonical type without the type prefix: `task.blocked` → `blocked`. */
type SignalOf<T extends CanonicalType> = SignalSlot extends infer S
  ? S extends `${T}.${infer Name}`
    ? Name
    : never
  : never;

/**
 * One Notion record, as read by the canonical model.
 *
 * It holds no values, only **field states**. The difference matters: a detector that sees `absent`
 * where the field is really `unread` will assert an absence nobody checked (`INV-002`).
 */
export type DecodedRecord<T extends CanonicalType = CanonicalType> = T extends CanonicalType
  ? {
      readonly type: T;
      readonly pageId: string;
      /**
       * Time measured from this value is the time since the last recorded attention to the record.
       */
      readonly lastEditedAt: string;
      /** The key is a canonical field of the type; all fields are covered, not only filled ones. */
      readonly readings: Readonly<Record<FieldOf<T>, Reading>>;
      /**
       * Computations of the workspace bound to this type. They are kept apart from `readings` on
       * purpose, because they are not a claim of the model, and a detector must see the
       * difference. A signal that is not bound is simply absent here.
       */
      readonly signals: Readonly<Partial<Record<SignalOf<T>, Reading>>>;
    }
  : never;

/** Returns the gaps in the model found on this record. They must not be passed over in silence. */
export function gapsOf(record: DecodedRecord): readonly SchemaGap[] {
  const readings: readonly Reading[] = Object.values(record.readings);

  return readings.filter((reading) => reading.state === 'gap').map((reading) => reading.gap);
}
