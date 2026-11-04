import { resolve } from 'node:path';
import {
  readWorkspaceContract,
  type WorkspaceContract,
} from '../../../src/notion/workspace/workspace-contract';
import { differences, workspaceOf } from '../../../src/notion/workspace/workspace-schema';
import { liveWorkspaceOf } from '../../fixtures/fake-notion-workspace.fixture';
import { plainProperty } from '../../fixtures/notion-data-source.fixture';
import { titledDataSource } from '../../fixtures/notion-workspace.fixture';
import {
  CAPTURE_PROPERTY,
  captureOverlayOf,
  capturePropertyId,
  withCaptureOverlay,
} from './capture-overlay';

const CONTRACT = readWorkspaceContract(
  resolve(__dirname, '../../../../contracts/notion-workspace.yaml'),
);

/** Builds a contract whose Inbox already has a property with the reserved name. */
function contractWithReserved(): WorkspaceContract {
  return {
    ...CONTRACT,
    databases: CONTRACT.databases.map((database) =>
      database.title === 'Inbox'
        ? {
            ...database,
            properties: new Map([
              ...database.properties,
              [CAPTURE_PROPERTY, { description: null, type: 'date' as const }],
            ]),
          }
        : database,
    ),
  };
}

describe('the gate overlay for the capture time', () => {
  const overlay = captureOverlayOf(CONTRACT);

  it("applies to the contract's Inbox database", () => {
    expect(overlay).toEqual({ database: 'Inbox' });
  });

  /**
   * The only divergence of the gate from the main workspace: the capture-time date in the Inbox,
   * and nothing else.
   */
  it('adds exactly one Inbox property to the contract schema: the date', () => {
    const target = withCaptureOverlay(CONTRACT.databases, overlay);
    const built = liveWorkspaceOf(CONTRACT.databases);
    const inbox = target.find(({ title }) => title === 'Inbox');

    expect(differences(CONTRACT.databases, built)).toEqual([]);
    expect(differences(target, built)).toEqual([`Inbox."${CAPTURE_PROPERTY}" is missing`]);
    expect(inbox?.properties.get(CAPTURE_PROPERTY)?.type).toBe('date');
    expect(target.filter(({ title }) => title !== 'Inbox')).toEqual(
      CONTRACT.databases.filter(({ title }) => title !== 'Inbox'),
    );
  });

  it('a name the gate reserves for itself, found in the contract, is refused', () => {
    expect(() => captureOverlayOf(contractWithReserved())).toThrow(
      /already has "Captured", which gate reserves/,
    );
  });

  it('points the gate binding at the date in the gate Inbox, and refuses without it', () => {
    const gate = workspaceOf(
      new Map([
        [
          'gate_inbox',
          titledDataSource('gate_inbox', 'Inbox', [
            plainProperty('title', 'Name', 'title'),
            plainProperty('gd%3D', CAPTURE_PROPERTY, 'date'),
          ]),
        ],
      ]),
    );
    const without = workspaceOf(
      new Map([
        [
          'gate_inbox',
          titledDataSource('gate_inbox', 'Inbox', [plainProperty('title', 'Name', 'title')]),
        ],
      ]),
    );

    expect(capturePropertyId(gate, overlay)).toBe('gd%3D');
    expect(() => capturePropertyId(without, overlay)).toThrow(/"Captured" is missing/);
  });
});
