import { Inject, Injectable } from '@nestjs/common';
import { checkAnchor, renderAnchor } from '../knowledge/anchor-page';
import { ANCHOR_TYPES, isAnchorType, type AnchorType } from '../knowledge/anchor-types';
import { anchorPlacement, slugsToRead, type AnchorPlacement } from '../knowledge/exact-identity';
import { GbrainShapeError, type PageRead } from '../knowledge/gbrain-pages';
import {
  entryWrite,
  storedAlready,
  type EntrySource,
  type GbrainEntryWrite,
} from '../knowledge/memory-entry';
import { isObjectNotFound, NotionAccessError } from '../notion/client/notion.error';
import { Page } from '../notion/client/page';
import { PageReader } from '../notion/client/page.reader';
import { FieldOf } from '../notion/semantics/decoded-record';
import { SemanticAdapter } from '../notion/semantics/semantic.adapter';
import { messageOf } from '../platform/error/message-of';
import { InvalidRequestError, parsedRequest } from '../platform/request/invalid-request';
import { Actor } from '../runs/actor';
import { AppliedEffect } from '../runs/run-effects';
import {
  GbrainCallError,
  GbrainReadIncompleteError,
  GbrainToolError,
  type GbrainClient,
} from './gbrain-client';
import { MemoryEntry, MemoryEntryRequest, memoryEntrySchema } from './memory-entry.schema';

/** What the memory service needs from GBrain: find an anchor, create it and write an entry. */
type MemoryGbrain = Pick<
  GbrainClient,
  'searchHits' | 'getPage' | 'putPage' | 'getTimeline' | 'facts' | 'addTimelineEntry' | 'remember'
>;

/** The token of the memory service's GBrain port. */
export const MEMORY_GBRAIN = Symbol('MemoryGbrain');

/**
 * The field that holds the object's name for each anchor type: the name of a new anchor is taken
 * from it.
 */
const NAME_FIELDS: { readonly [T in AnchorType]: FieldOf<T> } = {
  project: 'name',
  behavior_system: 'behavior',
  objective: 'desired_change',
  area_of_focus: 'name',
  identity: 'name',
};

/** The Notion object the entry is about: its anchor type, id and name. */
interface MemoryObject {
  readonly notionId: string;
  readonly type: AnchorType;
  readonly title: string;
}

/**
 * Checks whether the error means that GBrain did not answer or returned an unexpected answer. At
 * the check, a GBrain failure is a refusal, not a run failure.
 */
const isGbrainFailure = (error: unknown): boolean =>
  error instanceof GbrainCallError ||
  error instanceof GbrainToolError ||
  error instanceof GbrainShapeError ||
  error instanceof GbrainReadIncompleteError;

/**
 * The memory entries the system makes on its own behalf (`docs/2-system.md` § “Writes to
 * GBrain”): an event, a decision, a fact and an Area of Focus's acceptable state, about a Notion
 * object or with none.
 *
 * The model says what the entry is about and what it says. The App decides where and in what form
 * the entry lands. Exact identity finds the object's anchor, and when there is none the App
 * creates it by convention, only at a free address and only together with an entry. So there are
 * no empty anchors, and another page is never replaced. Entries about one object run one at a
 * time, because creating an anchor is a read followed by a write, and two entries together would
 * create it twice.
 */
@Injectable()
export class MemoryService {
  /** Work on each object runs in sequence; the key is the id of the Notion object. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly pages: PageReader,
    private readonly semantics: SemanticAdapter,
    @Inject(MEMORY_GBRAIN) private readonly gbrain: MemoryGbrain,
  ) {}

  /**
   * Accepts an entry, or refuses in a way that lets the model fix the request or tell the person
   * what was not saved: the object must be an object that has memory, and exactly one anchor
   * must be found or created for it.
   */
  async check(actor: Actor, request: MemoryEntryRequest): Promise<MemoryEntry> {
    const entry = parsedRequest(memoryEntrySchema, request, 'memory entry');

    if (actor.kind === 'run' && entry.sourcePageId === undefined) {
      throw new InvalidRequestError(
        'memory entry: name the page where you read or heard it (source_page_id), and the thread if there is one',
      );
    }

    if (entry.objectId !== undefined) {
      const object = await this.objectOf(entry.objectId, entry.kind);

      placed(await this.placementOf(object, 'check'));
    }

    return entry;
  }

  /**
   * Writes an entry that `check` accepted: the object's anchor, existing or created by
   * convention, and then the entry itself, if an identical one is not there yet. It returns the
   * slug of the page the entry landed on, or the id of a fact with no entity. A write to GBrain
   * can wait minutes while GBrain computes the embedding; the run's `deadline` aborts that wait.
   */
  async record(
    entry: MemoryEntry,
    applied: (effect: AppliedEffect) => void,
    deadline?: AbortSignal,
  ): Promise<string> {
    const content = {
      kind: entry.kind,
      text: entry.text,
      date: entry.date,
      source: sourceOf(entry),
    };

    if (entry.objectId === undefined) {
      const id = await this.write(entryWrite(content, null), deadline);

      applied({ kind: 'memory_entry', id });

      return id;
    }

    const object = await this.objectOf(entry.objectId, entry.kind);

    return this.oneAtATime(object.notionId, async () => {
      const slug = await this.anchorOf(object, applied, deadline);
      const write = entryWrite(content, slug);

      if (await this.stored(write, slug)) return slug;

      await this.write(write, deadline);
      applied({ kind: 'memory_entry', id: slug });

      return slug;
    });
  }

  /** Reads the Notion object the entry is about. Its type must have memory. */
  private async objectOf(notionId: string, kind: MemoryEntry['kind']): Promise<MemoryObject> {
    const page = await this.readable(notionId);
    const type =
      page.dataSourceId === null ? undefined : this.semantics.typeOfDataSource(page.dataSourceId);

    if (type === undefined || !isAnchorType(type)) {
      throw new InvalidRequestError(
        `memory entry: a ${type ?? 'page outside the workspace model'} keeps no memory of its own — name the ${ANCHOR_TYPES.join(', ')} it belongs to, or no object`,
      );
    }

    if (page.inTrash) {
      throw new InvalidRequestError(`memory entry: the object ${notionId} is in the trash`);
    }

    if (kind === 'standard' && type !== 'area_of_focus') {
      throw new InvalidRequestError(
        `memory entry: an acceptable state belongs to an Area of Focus, and ${notionId} is a ${type}`,
      );
    }

    return { notionId: page.id, type, title: this.nameOf(type, page) };
  }

  private nameOf<T extends AnchorType>(type: T, page: Page): string {
    const reading = this.semantics.readField(type, page, NAME_FIELDS[type]);
    const name =
      reading.state === 'value' && reading.value.type === 'text' ? reading.value.text.trim() : '';

    if (name.length === 0) {
      throw new InvalidRequestError(`memory entry: the name of the ${type} ${page.id} is empty`);
    }

    return name;
  }

  private async readable(notionId: string): Promise<Page> {
    try {
      return await this.pages.page(notionId);
    } catch (error) {
      if (isObjectNotFound(error)) {
        throw new InvalidRequestError(`memory entry: the object ${notionId} is not found`);
      }

      if (error instanceof NotionAccessError) {
        throw new InvalidRequestError(`memory entry: the object — ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Determines where the entry lands: exact identity over a search by id and the page at the
   * conventional address. At the check a GBrain failure is a refusal, so the model tells the
   * person that memory is unavailable. At the write it is a failure, and the run is retried.
   */
  private async placementOf(
    object: MemoryObject,
    moment: 'check' | 'record',
  ): Promise<AnchorPlacement> {
    try {
      const hits = await this.gbrain.searchHits(object.notionId, ANCHOR_TYPES);
      const read = await Promise.all(
        slugsToRead(hits, object.type, object.notionId).map((slug) => this.gbrain.getPage(slug)),
      );

      return anchorPlacement(
        object.type,
        object.notionId,
        read.filter((page): page is PageRead => page !== null),
      );
    } catch (error) {
      if (moment === 'check' && isGbrainFailure(error)) {
        throw new InvalidRequestError(
          `memory entry: memory cannot be read now, so nothing is recorded — ${messageOf(error)}`,
        );
      }

      throw error;
    }
  }

  /**
   * Returns the object's anchor: an existing one, or one created by convention and checked by
   * reading it back.
   */
  private async anchorOf(
    object: MemoryObject,
    applied: (effect: AppliedEffect) => void,
    deadline: AbortSignal | undefined,
  ): Promise<string> {
    const placement = placed(await this.placementOf(object, 'record'));

    if (placement.state === 'exact') return placement.slug;

    await this.gbrain.putPage(
      placement.slug,
      renderAnchor({
        type: object.type,
        title: object.title,
        notionId: object.notionId,
        aliases: [],
        paragraphs: [],
      }),
      deadline,
    );

    const written = await this.gbrain.getPage(placement.slug);
    const violations = written === null ? null : checkAnchor(written);

    if (violations === null || violations.length > 0) {
      throw new Error(
        `memory: the anchor written at ${placement.slug} does not read back as an anchor — ${
          violations === null ? 'the page is missing' : violations.map((v) => v.code).join(', ')
        }`,
      );
    }

    applied({ kind: 'memory_anchor', id: placement.slug });

    return placement.slug;
  }

  /**
   * Checks whether the same entry is already on the page. A fact with no entity cannot be found
   * reliably, so it is not compared.
   */
  private async stored(write: GbrainEntryWrite, slug: string): Promise<boolean> {
    switch (write.tool) {
      case 'timeline':
        return storedAlready(write, await this.gbrain.getTimeline(slug), []);

      case 'fact':
        return storedAlready(write, [], await this.gbrain.facts(slug));
    }
  }

  /** Performs a GBrain write and returns the slug of the event's page or the id of the fact. */
  private async write(write: GbrainEntryWrite, deadline: AbortSignal | undefined): Promise<string> {
    switch (write.tool) {
      case 'timeline':
        await this.gbrain.addTimelineEntry(
          {
            slug: write.slug,
            date: write.date,
            summary: write.summary,
            source: write.source,
          },
          deadline,
        );

        return write.slug;

      case 'fact':
        return this.gbrain.remember(
          {
            fact: write.fact,
            provenance: write.provenance,
            entity: write.entity,
            kind: write.kind,
          },
          deadline,
        );
    }
  }

  private async oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.then(work, work);

    this.queues.set(key, current);

    try {
      return await current;
    } finally {
      if (this.queues.get(key) === current) this.queues.delete(key);
    }
  }
}

/**
 * Derives the source of an entry: the page and thread where it was said or read, or a
 * conversation.
 */
function sourceOf(entry: MemoryEntry): EntrySource {
  return entry.sourcePageId === undefined
    ? { kind: 'conversation' }
    : {
        kind: 'notion',
        pageId: entry.sourcePageId,
        ...(entry.sourceDiscussionId === undefined
          ? {}
          : { discussionId: entry.sourceDiscussionId }),
      };
}

/** A place an entry can land: an existing anchor or a free conventional address. */
type Placed = Extract<AnchorPlacement, { readonly state: 'exact' | 'create' }>;

/** Refuses an entry with nowhere to land, with a reason the model can relay to the person. */
function placed(placement: AnchorPlacement): Placed {
  switch (placement.state) {
    case 'exact':
    case 'create':
      return placement;

    case 'integrity_error':
      throw new InvalidRequestError(
        `memory entry: what is stored about this object is inconsistent — ${placement.slugs.length} pages carry its id (${placement.slugs.join(', ')}), so nothing is recorded`,
      );

    case 'occupied':
      throw new InvalidRequestError(
        `memory entry: another page lies at ${placement.slug}, where this object's memory belongs, so nothing is recorded`,
      );
  }
}
