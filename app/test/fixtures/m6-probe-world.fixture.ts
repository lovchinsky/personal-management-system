import { Test } from '@nestjs/testing';
import type { GbrainStore } from '../../src/memory/gbrain-client';
import { NotionRecordReader } from '../../src/notion/semantics/record.reader';
import type { PageSnapshot } from '../gate/gate-claims';
import type { Residue } from '../gate/gate-cleanup';
import type { World, WorldPage } from '../gate/m5-scenarios';
import { M6World } from '../gate/m6-world';
import type { MemoryPage } from '../gate/scenario-kit';
import type { Ids } from '../gate/scenario-world';
import { Records } from './methodology-records';

/** How the probe world answers what the gate asks it. */
export interface Behaviour {
  /** Slots the binding has no carrier for. */
  readonly missingSlots?: readonly string[];
  readonly channel?: 'reaches' | 'misses' | 'throws';
  readonly memory?: 'writes' | 'throws';
  /** Where the world reads differently than intended: page key → the status Notion returns. */
  readonly reads?: Readonly<Record<string, string>>;
  /**
   * How a Project or a Behavior System returns its Tasks: all of them (`listed`, the default), all
   * but one (`short`: Notion is still syncing the reverse side) or not as a list (`unreadable`: a
   * truncated list, a binding fault).
   */
  readonly links?: 'listed' | 'short' | 'unreadable';
  /** What cleanup leaves behind. */
  readonly left?: readonly string[];
  /** The GBrain the memory checks work in. Without it they do not call GBrain. */
  readonly gbrain?: GbrainStore;
}

/** A probe world that keeps a record of cleanups. */
type ProbeWorld = M6World & {
  readonly cleaned: Residue[];
  /** Whether page snapshots with comments were requested: the world check reads no comments. */
  readonly snapshotRequests: (boolean | undefined)[];
};

const idOf = (key: string): string => `${key}-id`;

/**
 * Builds a snapshot of a world page read as it is described. `status` overrides the status of a
 * Task or Project.
 */
function snapshotOf(page: WorldPage, status?: string): PageSnapshot {
  const read = (own: string | undefined): string | null => status ?? own ?? null;

  return {
    id: idOf(page.key),
    name: page.name,
    status: page.type === 'project' || page.type === 'task' ? read(page.status) : null,
    mode: page.type === 'area_of_focus' ? page.mode : null,
    lifecycle: page.type === 'behavior_system' ? page.lifecycle : null,
    date: page.type === 'task' && page.dateInDays !== undefined ? '2026-10-11' : null,
    deadline: page.type === 'task' && page.deadlineInDays !== undefined ? '2026-10-13' : null,
    inTrash: false,
    comments: [],
  };
}

/**
 * Builds a world without Notion: what the gate asks it is answered according to `behaviour`. The
 * record reader is faked too, but from real methodology records: the owners of relations return the
 * Tasks that `build` has just built, and the Tasks return the statuses and blockers from the world
 * description.
 */
export async function worldThat(behaviour: Behaviour = {}): Promise<ProbeWorld> {
  const records = await Records.create();
  const state: { pages: World } = { pages: [] };
  const cleaned: Residue[] = [];
  const snapshotRequests: (boolean | undefined)[] = [];

  const tasksOf = (owner: string, type: string): string[] =>
    state.pages
      .filter(
        (page) =>
          page.type === 'task' &&
          (type === 'project' ? page.project : page.behaviorSystem) === owner,
      )
      .map((page) => idOf(page.key));

  const reader = {
    read: (type: string, id: string): Promise<unknown> => {
      const key = id.replace(/-id$/, '');
      const page = state.pages.find((candidate) => candidate.key === key);

      if (type === 'task') {
        return Promise.resolve(
          records.task({
            id,
            status: behaviour.reads?.[key] ?? (page?.type === 'task' ? page.status : 'Next Action'),
            dependencies: page?.type === 'task' ? (page.blockedBy ?? []).map(idOf) : [],
            // The body is read and empty. Without that, `Waiting For` has nothing to say about its
            // reason.
            body: [],
          }),
        );
      }

      const listed = tasksOf(key, type);

      return Promise.resolve(
        records.project({
          id,
          status: 'Active',
          tasks: behaviour.links === 'short' ? listed.slice(0, -1) : listed,
          tasksTruncated: behaviour.links === 'unreadable',
        }),
      );
    },
  };
  const app = await Test.createTestingModule({
    providers: [{ provide: NotionRecordReader, useValue: reader }],
  }).compile();

  class Probe extends M6World {
    readonly cleaned = cleaned;
    readonly snapshotRequests = snapshotRequests;

    override propertyOf(slot: string): string {
      if (behaviour.missingSlots?.includes(slot)) {
        throw new Error(`the binding has no carrier of ${slot}`);
      }

      return `property-${slot}`;
    }

    override build(pages: World): Promise<Ids> {
      state.pages = pages;

      return Promise.resolve(Object.fromEntries(pages.map((page) => [page.key, idOf(page.key)])));
    }

    override snapshots(_ids: Ids, withComments?: boolean): Promise<Record<string, PageSnapshot>> {
      snapshotRequests.push(withComments);

      return Promise.resolve(
        Object.fromEntries(
          state.pages.map((page) => [page.key, snapshotOf(page, behaviour.reads?.[page.key])]),
        ),
      );
    }

    override channelReaches(page: string): Promise<{ ok: boolean; page: string; mode: string }> {
      if (behaviour.channel === 'throws') {
        return Promise.reject(new Error('the webhook answered 502'));
      }

      return Promise.resolve({
        ok: behaviour.channel !== 'misses',
        page,
        mode: 'event_evaluation',
      });
    }

    override gbrain(): GbrainStore {
      if (behaviour.gbrain === undefined) throw new Error('the probe world has no GBrain');

      return behaviour.gbrain;
    }

    /**
     * Behaves like the real one: a scenario with no memory does not call GBrain, so a GBrain
     * failure does not touch it.
     */
    override plantMemory(pages: readonly MemoryPage[]): Promise<void> {
      return behaviour.memory === 'throws' && pages.length > 0
        ? Promise.reject(new Error('gbrain put_page: 502'))
        : Promise.resolve();
    }

    override clean(residue: Residue): Promise<readonly string[]> {
      cleaned.push(residue);

      return Promise.resolve(behaviour.left ?? []);
    }
  }

  return new Probe(app, 'm6');
}
