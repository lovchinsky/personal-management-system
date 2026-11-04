import type { WorkspaceContract } from '../../../src/notion/workspace/workspace-contract';
import type { DatabaseShape, Workspace } from '../../../src/notion/workspace/workspace-schema';

/**
 * The gate overlay on the contract schema is the capture-time date in the Inbox database, to which
 * `captured_at` of the gate binding points. It is the only deliberate divergence of the gate
 * workspace from the contract (ADR 0041). The check of the gate workspace runs against the
 * contract schema together with the overlay.
 */

/**
 * The capture-time date of an Inbox item in the gate: the gate writes it, and the gate's
 * `captured_at` reads it.
 */
export const CAPTURE_PROPERTY = 'Captured';

/** Where the overlay applies: the contract's Inbox database. */
interface CaptureOverlay {
  readonly database: string;
}

/** Returns the overlay for a contract: its Inbox database, where the capture time is a property. */
export function captureOverlayOf(contract: WorkspaceContract): CaptureOverlay {
  const title = contract.binding.data_sources.inbox_item;
  const inbox = contract.databases.find((database) => database.title === title);

  if (inbox === undefined) {
    throw new Error(`the contract's Inbox database ${title} is not among its databases`);
  }

  if (contract.binding.fields.inbox_item.captured_at?.kind !== 'native') {
    throw new Error(
      'the contract binds inbox_item.captured_at to no property, so gate cannot overlay it',
    );
  }

  if (inbox.properties.has(CAPTURE_PROPERTY)) {
    throw new Error(
      `the contract's ${inbox.title} already has "${CAPTURE_PROPERTY}", which gate reserves`,
    );
  }

  return { database: inbox.title };
}

/**
 * Returns the schema the gate brings its workspace to: the contract schema and the overlay date in
 * the Inbox database.
 */
export function withCaptureOverlay(
  target: readonly DatabaseShape[],
  overlay: CaptureOverlay,
): DatabaseShape[] {
  return target.map((database) => {
    if (database.title !== overlay.database) return database;

    return {
      ...database,
      properties: new Map([
        ...database.properties,
        [
          CAPTURE_PROPERTY,
          { description: 'The moment the Inbox item was captured', type: 'date' as const },
        ],
      ]),
    };
  });
}

/**
 * Returns the id of the overlay date in the gate's Inbox database, which is what the gate binds
 * `captured_at` to.
 */
export function capturePropertyId(gate: Workspace, overlay: CaptureOverlay): string {
  const inbox = [...gate.values()].find(({ shape }) => shape.title === overlay.database);
  const id = inbox?.propertyIds.get(CAPTURE_PROPERTY);

  if (id === undefined) {
    throw new Error(`${overlay.database}."${CAPTURE_PROPERTY}" is missing in the gate's`);
  }

  return id;
}
