import { Test } from '@nestjs/testing';
import { APIErrorCode } from '@notionhq/client';
import { NOTICED } from '../../test/fixtures/actors';
import { FakeGbrain } from '../../test/fixtures/fake-gbrain.fixture';
import { notionAnswer } from '../../test/fixtures/notion-answer.fixture';
import { pageFor } from '../../test/fixtures/notion-page.fixture';
import { bindingProvider } from '../../test/fixtures/test-module';
import { anchorSlug, checkAnchor, describeAnchor, renderAnchor } from '../knowledge/anchor-page';
import type { AnchorType } from '../knowledge/anchor-types';
import { CanonicalType } from '../notion/binding/binding.schema';
import { Page } from '../notion/client/page';
import { PageReader } from '../notion/client/page.reader';
import { SemanticAdapter } from '../notion/semantics/semantic.adapter';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { Actor, CHAT } from '../runs/actor';
import { AppliedEffect } from '../runs/run-effects';
import { MemoryEntryRequest } from './memory-entry.schema';
import { MEMORY_GBRAIN, MemoryService } from './memory.service';

const PROJECT = '5edbcc8c-3b2f-e938-c6a8-0380c810bdf3';
const AREA_OF_FOCUS = 'a01025e1-832c-bd09-2113-53f232e480f3';
const TASK = 'b894eac2-4e9d-2db8-bfb5-482bdba6ea50';
const THREAD = '99377236-610e-7024-a5d5-c07ad8e47219';

const PROJECT_SLUG = anchorSlug('project', PROJECT);

/** Creates a Notion page of type `type` with the id `id`. */
const pageOf = (type: CanonicalType, id: string): Page => ({ ...pageFor(type), id });

/**
 * The memory service's world: Notion pages, a real adapter over the fixture binding, and GBrain.
 */
class MemoryWorld {
  readonly gbrain = new FakeGbrain();
  readonly pages = new Map<string, Page>([
    [PROJECT, pageOf('project', PROJECT)],
    [AREA_OF_FOCUS, pageOf('area_of_focus', AREA_OF_FOCUS)],
    [TASK, pageOf('task', TASK)],
  ]);
  readonly effects: AppliedEffect[] = [];

  async service(): Promise<MemoryService> {
    const reader: Pick<PageReader, 'page'> = {
      page: (id) => {
        const page = this.pages.get(id);

        return page
          ? Promise.resolve(page)
          : Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404));
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MemoryService,
        SemanticAdapter,
        bindingProvider(),
        { provide: PageReader, useValue: reader },
        { provide: MEMORY_GBRAIN, useValue: this.gbrain },
      ],
    }).compile();

    return moduleRef.get(MemoryService);
  }

  /** Plants the object's anchor before the run: by convention, under the slug passed in. */
  async plantAnchor(type: AnchorType, notionId: string, slug = anchorSlug(type, notionId)) {
    await this.gbrain.putPage(
      slug,
      renderAnchor({ type, title: 'Запуск сайту', notionId, aliases: [], paragraphs: [] }),
    );
  }

  /** Checks and writes, as the write policy does. */
  async keep(
    request: MemoryEntryRequest,
    actor: Actor = NOTICED,
    deadline?: AbortSignal,
  ): Promise<string> {
    const service = await this.service();
    const entry = await service.check(actor, request);

    return service.record(entry, (effect) => this.effects.push(effect), deadline);
  }
}

const DECISION: MemoryEntryRequest = {
  objectId: PROJECT,
  kind: 'decision',
  text: 'Беремо Kestrel для платежів',
  date: '2026-10-14',
  sourcePageId: TASK,
  sourceDiscussionId: THREAD,
};

/** The same decision without a source, as the person states it in a conversation. */
const SPOKEN: MemoryEntryRequest = {
  objectId: PROJECT,
  kind: 'decision',
  text: DECISION.text,
  date: DECISION.date,
};

/** The same decision with no Notion object. */
const OBJECTLESS: MemoryEntryRequest = {
  kind: 'decision',
  text: DECISION.text,
  date: DECISION.date,
  sourcePageId: TASK,
  sourceDiscussionId: THREAD,
};

const SOURCE = `Notion page ${TASK}, thread ${THREAD}, 2026-10-14`;

describe('MemoryService', () => {
  describe('check', () => {
    it('a run names the page where it read or heard the entry', async () => {
      const world = new MemoryWorld();
      await expect(world.keep(SPOKEN)).rejects.toThrow(/source_page_id/);
      expect(world.gbrain.written).toEqual([]);
    });

    it('a Task has no memory of its own: the refusal names the types that have it', async () => {
      const world = new MemoryWorld();

      await expect(world.keep({ ...DECISION, objectId: TASK })).rejects.toThrow(
        /task keeps no memory of its own .*project, behavior_system/,
      );
    });

    it('an acceptable state belongs only to an Area of Focus', async () => {
      const world = new MemoryWorld();

      await expect(
        world.keep({ ...DECISION, kind: 'standard', text: 'двічі на тиждень' }),
      ).rejects.toThrow(/acceptable state belongs to an Area of Focus/);
    });

    it('an event with no object is a schema refusal', async () => {
      const world = new MemoryWorld();
      await expect(world.keep({ ...OBJECTLESS, kind: 'event' })).rejects.toThrow(
        InvalidRequestError,
      );
    });

    it('reading an object that does not exist is a refusal', async () => {
      const world = new MemoryWorld();

      await expect(
        world.keep({ ...DECISION, objectId: '99c7deea-2ee0-6174-9ee9-d5e228b6a349' }),
      ).rejects.toThrow(/is not found/);
    });

    it('with several anchors nothing is written, and the refusal says that what is stored is inconsistent', async () => {
      const world = new MemoryWorld();

      await world.plantAnchor('project', PROJECT);
      await world.plantAnchor('project', PROJECT, 'projects/copy');

      const before = [...world.gbrain.written];

      await expect(world.keep(DECISION)).rejects.toThrow(/inconsistent — 2 pages carry its id/);
      expect(world.gbrain.written).toEqual(before);
      expect(world.gbrain.timelines.size).toBe(0);
    });

    it('another page at the address of an anchor is not replaced', async () => {
      const world = new MemoryWorld();

      await world.gbrain.putPage(PROJECT_SLUG, '---\ntype: note\ntitle: "Інше"\n---\n\nІнше');

      await expect(world.keep(DECISION)).rejects.toThrow(/another page lies at/);
      expect(world.gbrain.written).toEqual([PROJECT_SLUG]);
    });
  });

  describe('write', () => {
    it('with no anchor the App creates it by convention and puts the decision on it', async () => {
      const world = new MemoryWorld();

      expect(await world.keep(DECISION)).toBe(PROJECT_SLUG);

      const anchor = await world.gbrain.getPage(PROJECT_SLUG);

      expect(anchor && checkAnchor(anchor)).toEqual([]);
      expect(anchor && describeAnchor(anchor)).toMatchObject({
        type: 'project',
        notionId: PROJECT,
        title: 'text of name',
      });
      expect(world.gbrain.timelines.get(PROJECT_SLUG)).toEqual([
        {
          date: '2026-10-14',
          summary: 'Decision: Беремо Kestrel для платежів',
          source: SOURCE,
          detail: '',
        },
      ]);

      const effects: AppliedEffect[] = [
        { kind: 'memory_anchor', id: PROJECT_SLUG },
        { kind: 'memory_entry', id: PROJECT_SLUG },
      ];

      expect(world.effects).toEqual(effects);
    });

    it('with an anchor, a fact lands on it with the anchor as its entity, and no new anchor appears', async () => {
      const world = new MemoryWorld();

      await world.plantAnchor('project', PROJECT);
      await world.keep({ ...DECISION, kind: 'fact', text: 'Замовник дивиться макети в четвер' });

      expect(world.gbrain.written).toEqual([PROJECT_SLUG]);
      expect(world.gbrain.factsBy.get(PROJECT_SLUG)).toEqual([
        {
          fact: 'Замовник дивиться макети в четвер',
          kind: 'fact',
          entitySlug: PROJECT_SLUG,
          provenance: SOURCE,
        },
      ]);
      expect(world.effects).toEqual([{ kind: 'memory_entry', id: PROJECT_SLUG }]);
    });

    it('the acceptable state of an Area of Focus is a `preference` fact with the `Standard:` marker', async () => {
      const world = new MemoryWorld();
      const slug = anchorSlug('area_of_focus', AREA_OF_FOCUS);

      await world.keep({
        ...DECISION,
        objectId: AREA_OF_FOCUS,
        kind: 'standard',
        text: 'дві пробіжки',
      });

      expect(world.gbrain.factsBy.get(slug)).toEqual([
        {
          fact: 'Standard: дві пробіжки',
          kind: 'preference',
          entitySlug: slug,
          provenance: SOURCE,
        },
      ]);
    });

    it('an identical entry already on the anchor is not written twice', async () => {
      const world = new MemoryWorld();

      await world.keep(DECISION);
      world.effects.length = 0;
      await world.keep(DECISION);

      expect(world.gbrain.timelines.get(PROJECT_SLUG)).toHaveLength(1);
      expect(world.effects).toEqual([]);
    });

    it('two entries about a new object made together create one anchor', async () => {
      const world = new MemoryWorld();
      const service = await world.service();
      const fact: MemoryEntryRequest = { ...DECISION, kind: 'fact', text: 'Макети в четвер' };
      const entries = await Promise.all([
        service.check(NOTICED, DECISION),
        service.check(NOTICED, fact),
      ]);

      await Promise.all(
        entries.map((entry) => service.record(entry, (effect) => world.effects.push(effect))),
      );

      expect(world.gbrain.written).toEqual([PROJECT_SLUG]);
      expect(world.effects.filter((effect) => effect.kind === 'memory_anchor')).toHaveLength(1);
    });

    it('with no Notion object a decision is written as a fact with no entity, with the marker', async () => {
      const world = new MemoryWorld();
      await world.keep({ ...OBJECTLESS, text: 'Ескалація після двох днів' });

      expect(world.gbrain.written).toEqual([]);
      expect(world.gbrain.factsBy.get('')).toEqual([
        {
          fact: 'Decision: Ескалація після двох днів',
          kind: 'fact',
          entitySlug: null,
          provenance: SOURCE,
        },
      ]);
      expect(world.effects).toEqual([{ kind: 'memory_entry', id: '1' }]);
    });

    /**
     * A write to GBrain can wait minutes, and the run must reach its conclusion before the ticket
     * ends.
     */
    it('the run deadline reaches every write to GBrain: the anchor and the entry itself', async () => {
      const world = new MemoryWorld();
      const deadline = new AbortController().signal;

      await world.keep(DECISION, NOTICED, deadline);

      expect(world.gbrain.deadlines).toHaveLength(2);
      expect(world.gbrain.deadlines.every((given) => given === deadline)).toBe(true);
    });

    it('in a conversation with no page the source is a conversation', async () => {
      const world = new MemoryWorld();
      await world.keep(SPOKEN, CHAT);

      expect(world.gbrain.timelines.get(PROJECT_SLUG)?.[0]?.source).toBe(
        'Conversation, 2026-10-14',
      );
    });
  });
});
