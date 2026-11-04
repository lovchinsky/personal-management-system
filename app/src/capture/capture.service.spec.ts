import { CAPTURING, NOTICED } from '../../test/fixtures/actors';
import {
  A_CONVERSION,
  ANOTHER_TASK,
  BINDING_WITH_INBOX_TEXT,
  CaptureWorld,
  converted,
  CREATED_TASK,
  INBOX_ITEM,
  KEY_RESULT,
  ORIGIN_COMMENT,
  pageIn,
  PARKED_ITEM,
  PROJECT,
  REASONING_COMMENT,
  stepsBeforeStop,
  stepsOf,
  WriteCall,
} from '../../test/fixtures/capture-world';
import { projectPageOf, taskPageOf } from '../../test/fixtures/methodology-records';
import { echoOf } from '../../test/fixtures/notion-echo.fixture';
import { optionProperty } from '../../test/fixtures/notion-page.fixture';
import { InvalidRequestError } from '../platform/request/invalid-request';
import { CHAT } from '../runs/actor';
import { CaptureStep, ConversionStep } from './conversion';
import { InboxClosureRequest, inboxClosureSchema } from './inbox-closure.schema';
import {
  InboxConversionRequest,
  inboxConversionSchema,
  OPEN_TASK_STATUSES,
} from './inbox-conversion.schema';
import { InboxParkingRequest, inboxParkingSchema } from './inbox-parking.schema';

/** Returns the message of a check's refusal; any other error propagates. */
async function refusalOf(check: () => Promise<unknown>): Promise<string | null> {
  try {
    await check();

    return null;
  } catch (error) {
    if (error instanceof InvalidRequestError) return error.message;

    throw error;
  }
}

describe('Inbox item conversion', () => {
  describe('check', () => {
    it('accepts a conversion in a conversation and writes nothing', async () => {
      const world = new CaptureWorld();
      const service = await world.service();

      await expect(service.check(CAPTURING, A_CONVERSION)).resolves.toMatchObject({
        inboxPageId: INBOX_ITEM,
      });
      expect(world.writes).toEqual([]);
    });

    /**
     * An item becomes a Task in a conversation, because the evaluation of changes does not
     * process an Inbox item.
     */
    it('accepts a conversion only in a conversation', async () => {
      const service = await new CaptureWorld().service();

      await expect(
        refusalOf(() => service.check({ ...CAPTURING, mode: 'event_evaluation' }, A_CONVERSION)),
      ).resolves.toContain('only a dialogue step converts an Inbox item');
    });

    const refused: [string, (world: CaptureWorld) => InboxConversionRequest, string][] = [
      [
        'a page that is not from the Inbox database',
        () => ({ ...A_CONVERSION, inboxPageId: PROJECT }),
        `page ${PROJECT} is not an Inbox item`,
      ],
      [
        'an item already in the trash',
        (world) => {
          const item = world.pages.get(INBOX_ITEM);
          if (item) {
            world.pages.set(INBOX_ITEM, { ...item, inTrash: true });
          }

          return A_CONVERSION;
        },
        'is in the trash — it is resolved already',
      ],
      [
        'a missing item',
        () => ({ ...A_CONVERSION, inboxPageId: '6e7f8a9b-0c1d-4e2f-9a3b-4c5d6e7f8a9b' }),
        'is not found',
      ],
      [
        'a Project link that leads outside the Project database',
        () => ({ ...A_CONVERSION, task: { ...A_CONVERSION.task, project: [KEY_RESULT] } }),
        'the project link',
      ],
      [
        'a link that leads to the trash',
        (world) => {
          world.pages.set(PROJECT, { ...pageIn('project', PROJECT, 'ds_project'), inTrash: true });

          return { ...A_CONVERSION, task: { ...A_CONVERSION.task, project: [PROJECT] } };
        },
        `the project link ${PROJECT} is in the trash`,
      ],
      [
        'a link that leads to a closed Project (`Done`)',
        (world) => {
          world.pages.set(PROJECT, { ...projectPageOf({ status: 'Done' }), id: PROJECT });

          return { ...A_CONVERSION, task: { ...A_CONVERSION.task, project: [PROJECT] } };
        },
        `the project link ${PROJECT} leads to a project that is Done`,
      ],
      [
        'a link that leads to a closed Project (`Canceled`)',
        (world) => {
          world.pages.set(PROJECT, { ...projectPageOf({ status: 'Canceled' }), id: PROJECT });

          return { ...A_CONVERSION, task: { ...A_CONVERSION.task, project: [PROJECT] } };
        },
        `the project link ${PROJECT} leads to a project that is Canceled`,
      ],
      [
        'a Project status that does not read as canonical',
        (world) => {
          world.pages.set(PROJECT, { ...projectPageOf({ status: 'Sprint' }), id: PROJECT });

          return { ...A_CONVERSION, task: { ...A_CONVERSION.task, project: [PROJECT] } };
        },
        `the project link ${PROJECT}: the project status cannot be read as a canonical one`,
      ],
    ];

    it.each(refused)('%s is refused with a reason', async (_, request, reason) => {
      const world = new CaptureWorld();
      const service = await world.service();

      await expect(refusalOf(() => service.check(CAPTURING, request(world)))).resolves.toContain(
        reason,
      );
    });

    it.each(['Planning', 'Active', 'Paused'])(
      'a Project with status %s accepts a Task, because a pause suppresses Tasks instead of forbidding them',
      async (status) => {
        const world = new CaptureWorld();

        world.pages.set(PROJECT, { ...projectPageOf({ status }), id: PROJECT });

        const service = await world.service();

        await expect(
          refusalOf(() =>
            service.check(CAPTURING, {
              ...A_CONVERSION,
              task: { ...A_CONVERSION.task, project: [PROJECT] },
            }),
          ),
        ).resolves.toBeNull();
      },
    );

    it('links to their own databases are accepted', async () => {
      const service = await new CaptureWorld().service();
      const linked: InboxConversionRequest = {
        ...A_CONVERSION,
        task: {
          ...A_CONVERSION.task,
          project: [PROJECT],
          keyResults: [KEY_RESULT],
          dependencies: [ANOTHER_TASK],
        },
      };

      await expect(refusalOf(() => service.check(CAPTURING, linked))).resolves.toBeNull();
    });

    /**
     * The schema does not know a non-canonical or a closed status, because a Task from an item
     * can only be open.
     */
    it.each(['Done', 'Hidden', 'Canceled'])('status %s is refused by the schema', (status) => {
      const closed: Record<string, unknown> = {
        ...A_CONVERSION,
        task: { ...A_CONVERSION.task, status },
      };

      expect(inboxConversionSchema.safeParse(closed).success).toBe(false);
      expect(inboxConversionSchema.safeParse(A_CONVERSION).success).toBe(true);
    });
  });

  describe('execution', () => {
    it('writes the Task, an origin comment mentioning it, then the trash, in that order', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const conversion = await service.check(CAPTURING, A_CONVERSION);

      const done = await converted(service, conversion);

      expect(world.writes.map((call) => call.op)).toEqual(['createPage', 'comment', 'archive']);
      expect(world.threads).toEqual([]);
      expect(done).toEqual({
        taskPageId: CREATED_TASK,
        steps: [
          { step: 'task_created', pageId: CREATED_TASK },
          { step: 'origin_noted', commentId: 'origin-comment' },
          { step: 'item_archived', pageId: INBOX_ITEM },
        ],
      });
    });

    it('the comment is written on the item and mentions the Task', async () => {
      const world = new CaptureWorld();
      const service = await world.service();

      await converted(service, await service.check(CAPTURING, A_CONVERSION));

      const expected: WriteCall = {
        op: 'comment',
        target: { pageId: INBOX_ITEM },
        text: A_CONVERSION.comment,
        mention: CREATED_TASK,
      };

      expect(world.writes).toContainEqual(expected);
    });

    /**
     * A Task that reads back differently is not the one that was intended, so the conversion
     * goes no further.
     */
    it('a Task that does not read back as what was written stops the conversion', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const conversion = await service.check(CAPTURING, A_CONVERSION);

      world.echo = (id) => optionProperty(id, 'opt_done', 'Done');

      await expect(stepsBeforeStop(service, conversion)).resolves.toEqual([
        { step: 'task_created', pageId: CREATED_TASK },
      ]);
      expect(world.writes.map((call) => call.op)).toEqual(['createPage']);
    });

    /**
     * The system writes no time zones, so a time zone in the write response is a discrepancy,
     * not an annotation.
     */
    it('a date that Notion returned with a time zone stops the conversion', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const conversion = await service.check(CAPTURING, {
        ...A_CONVERSION,
        task: { name: 'Подзвонити в банк', status: 'Scheduled', date: '2026-10-01T09:00:00+03:00' },
      });

      world.echo = (id, write) => {
        const echoed = echoOf(id, write);

        return echoed.type === 'date' && echoed.date
          ? { ...echoed, date: { ...echoed.date, time_zone: 'Europe/Kyiv' } }
          : echoed;
      };

      await expect(stepsBeforeStop(service, conversion)).resolves.toEqual([
        { step: 'task_created', pageId: CREATED_TASK },
      ]);
    });

    const TASK_CREATED: ConversionStep = { step: 'task_created', pageId: CREATED_TASK };
    const ORIGIN_NOTED: ConversionStep = { step: 'origin_noted', commentId: ORIGIN_COMMENT };
    const ITEM_ARCHIVED: ConversionStep = { step: 'item_archived', pageId: INBOX_ITEM };

    const unconfirmed: [WriteCall['op'], ConversionStep[]][] = [
      ['createPage', [TASK_CREATED]],
      ['comment', [TASK_CREATED, ORIGIN_NOTED]],
      ['archive', [TASK_CREATED, ORIGIN_NOTED, ITEM_ARCHIVED]],
    ];

    /**
     * Notion accepted the write but did not confirm it in its response: the author is not the
     * integration bot. The write happened, so the step is kept in the run trace and the
     * conversion stops. Otherwise the created Task would not be visible, and a retry of the run
     * would create a second one.
     */
    it.each(unconfirmed)('an unconfirmed %s write leaves its own step too', async (op, steps) => {
      const world = new CaptureWorld();
      const service = await world.service();
      const conversion = await service.check(CAPTURING, A_CONVERSION);

      world.unconfirmedAt = op;

      await expect(stepsBeforeStop(service, conversion)).resolves.toEqual(steps);
    });

    const stops: [WriteCall['op'], ConversionStep['step'][]][] = [
      ['createPage', []],
      ['comment', ['task_created']],
      ['archive', ['task_created', 'origin_noted']],
    ];

    it.each(stops)(
      'a refusal at step %s leaves the completed steps in place',
      async (op, steps) => {
        const world = new CaptureWorld();
        const service = await world.service();
        const conversion = await service.check(CAPTURING, A_CONVERSION);

        world.failAt = op;

        const done = await stepsBeforeStop(service, conversion);

        expect(done.map((step) => step.step)).toEqual(steps);
      },
    );
  });
});

/** What the person said and what was left unresolved: an item the system parks. */
const A_PARKING: InboxParkingRequest = {
  title: 'Василь / контракт / maybe проблема',
  comment: 'Не зрозуміло, чи це задача: питання до людини — що саме з контрактом?',
};

describe('parking an item in the Inbox', () => {
  describe('check', () => {
    it.each([['chat', CHAT]])('parks %s and writes nothing', async (_, actor) => {
      const world = new CaptureWorld();
      const service = await world.service();

      await expect(service.checkPark(actor, A_PARKING)).resolves.toMatchObject({
        title: A_PARKING.title,
      });
      expect(world.writes).toEqual([]);
    });

    /** A run processes an item that already sits in the Inbox: it does not park a second one. */
    it.each([
      ['item processing', CAPTURING],
      ['evaluation of changes', NOTICED],
    ])('a run (%s) does not park items and gets a refusal with a reason', async (_, actor) => {
      const service = await new CaptureWorld().service();

      await expect(refusalOf(() => service.checkPark(actor, A_PARKING))).resolves.toContain(
        'a run clarifies an Inbox item that already exists',
      );
    });

    it('a text with no carrier in the Inbox binding is refused, not lost', async () => {
      const service = await new CaptureWorld().service();

      await expect(
        refusalOf(() => service.checkPark(CHAT, { ...A_PARKING, text: 'Повний текст' })),
      ).resolves.toContain('inbox_item.captured_text');
    });

    it('a text with a carrier is accepted', async () => {
      const service = await new CaptureWorld().service(BINDING_WITH_INBOX_TEXT);

      await expect(
        refusalOf(() => service.checkPark(CHAT, { ...A_PARKING, text: 'Повний текст' })),
      ).resolves.toBeNull();
    });

    it.each([
      ['an empty title', { ...A_PARKING, title: '  ' }],
      ['an empty comment', { ...A_PARKING, comment: '' }],
      ['an extra field', { ...A_PARKING, status: 'Inbox' }],
    ])('%s is refused by the schema', (_, request) => {
      expect(inboxParkingSchema.safeParse(request).success).toBe(false);
      expect(inboxParkingSchema.safeParse(A_PARKING).success).toBe(true);
    });
  });

  describe('execution', () => {
    /** The person replies to the reasoning, and the thread leads into processing the item. */
    it('writes the page, then a reasoning comment on it that starts a conversation thread', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const parking = await service.checkPark(CHAT, A_PARKING);

      const done = await stepsOf((step) => service.park(CHAT, parking, step));

      expect(world.writes.map((call) => call.op)).toEqual(['createPage', 'comment']);
      expect(world.writes[0]).toMatchObject({ dataSourceId: 'ds_inbox_item' });
      expect(world.writes[1]).toEqual({
        op: 'comment',
        target: { pageId: PARKED_ITEM },
        text: A_PARKING.comment,
        mention: undefined,
      });
      expect(world.threads).toEqual([
        {
          discussionId: 'origin-thread',
          pageId: PARKED_ITEM,
          blockId: null,
          commentId: REASONING_COMMENT,
          mode: 'dialogue',
        },
      ]);
      expect(done).toEqual({
        pageId: PARKED_ITEM,
        steps: [
          { step: 'item_parked', pageId: PARKED_ITEM },
          { step: 'origin_noted', commentId: REASONING_COMMENT },
        ],
      });
    });

    /** A channel message goes into the Inbox without reasoning, because the model will reason. */
    it('without a comment, writes only the page', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const parking = await service.checkPark(CHAT, { title: 'Купити молоко' });

      const done = await stepsOf((step) => service.park(CHAT, parking, step));

      expect(world.writes.map((call) => call.op)).toEqual(['createPage']);
      expect(done.steps).toEqual([{ step: 'item_parked', pageId: PARKED_ITEM }]);
    });

    it('the text goes into the carrier property, the title into the title', async () => {
      const world = new CaptureWorld();
      const service = await world.service(BINDING_WITH_INBOX_TEXT);
      const parking = await service.checkPark(CHAT, {
        title: 'Купити молоко',
        text: 'Купити молоко і хліб до вечора',
      });

      await stepsOf((step) => service.park(CHAT, parking, step));

      const [created] = world.writes;

      expect(created).toMatchObject({
        op: 'createPage',
        properties: {
          title: { title: [{ type: 'text', text: { content: 'Купити молоко' } }] },
          p_inbox_item_text: {
            rich_text: [{ type: 'text', text: { content: 'Купити молоко і хліб до вечора' } }],
          },
        },
      });
    });

    const stops: [WriteCall['op'], CaptureStep['step'][]][] = [
      ['createPage', []],
      ['comment', ['item_parked']],
    ];

    it.each(stops)(
      'a refusal at step %s leaves the completed steps in place',
      async (op, steps) => {
        const world = new CaptureWorld();
        const service = await world.service();
        const parking = await service.checkPark(CHAT, A_PARKING);
        const done: CaptureStep[] = [];

        world.failAt = op;

        await expect(service.park(CHAT, parking, (step) => done.push(step))).rejects.toThrow();
        expect(done.map((step) => step.step)).toEqual(steps);
      },
    );

    /** A write that Notion accepted without confirming has happened, so its step is kept. */
    it('an unconfirmed page leaves its step, and the comment is not written', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const parking = await service.checkPark(CHAT, A_PARKING);
      const done: CaptureStep[] = [];

      world.unconfirmedAt = 'createPage';

      await expect(service.park(CHAT, parking, (step) => done.push(step))).rejects.toThrow();
      expect(done).toEqual([{ step: 'item_parked', pageId: PARKED_ITEM }]);
      expect(world.writes.map((call) => call.op)).toEqual(['createPage']);
    });
  });
});

const A_CLOSURE: InboxClosureRequest = {
  inboxPageId: INBOX_ITEM,
  reason: 'trash',
  comment: 'Не дія і не довідка: прибрано',
};

describe('closing an Inbox item without a Task', () => {
  describe('check', () => {
    it.each([
      ['item processing', CAPTURING],
      ['chat', CHAT],
    ])('accepts closing by %s and writes nothing', async (_, actor) => {
      const world = new CaptureWorld();
      const service = await world.service();

      await expect(service.checkClose(actor, A_CLOSURE)).resolves.toMatchObject({
        inboxPageId: INBOX_ITEM,
        reason: 'trash',
      });
      expect(world.writes).toEqual([]);
    });

    it('refuses closing by the evaluation of changes, which does not process an Inbox item', async () => {
      const service = await new CaptureWorld().service();

      await expect(refusalOf(() => service.checkClose(NOTICED, A_CLOSURE))).resolves.toContain(
        'only a dialogue step closes an Inbox item',
      );
    });

    it('a duplicate of an existing Task is accepted', async () => {
      const world = new CaptureWorld();

      world.pages.set(ANOTHER_TASK, pageIn('task', ANOTHER_TASK, 'ds_task'));

      const service = await world.service();

      await expect(
        refusalOf(() =>
          service.checkClose(CAPTURING, {
            ...A_CLOSURE,
            reason: 'duplicate',
            duplicateOf: ANOTHER_TASK,
          }),
        ),
      ).resolves.toBeNull();
    });

    describe('duplicate: the existing Task must be open', () => {
      const duplicateOf = async (status: string): Promise<string | null> => {
        const world = new CaptureWorld();

        world.pages.set(ANOTHER_TASK, { ...taskPageOf({ status }), id: ANOTHER_TASK });

        const service = await world.service();

        return refusalOf(() =>
          service.checkClose(CAPTURING, {
            ...A_CLOSURE,
            reason: 'duplicate',
            duplicateOf: ANOTHER_TASK,
          }),
        );
      };

      it.each(OPEN_TASK_STATUSES)('an open Task (%s) is accepted', async (status) => {
        await expect(duplicateOf(status)).resolves.toBeNull();
      });

      /**
       * A closed Task is not what an open item repeats, because the item describes work that is
       * still waiting.
       */
      it.each(['Done', 'Canceled', 'Failed'])('a closed Task (%s) is refused', async (status) => {
        await expect(duplicateOf(status)).resolves.toContain(
          `the task ${ANOTHER_TASK} is ${status} — it cannot be what the item duplicates`,
        );
      });

      it('`Hidden` is outside the canonical model', async () => {
        await expect(duplicateOf('Hidden')).resolves.toContain(
          `the task ${ANOTHER_TASK} has a status outside the canonical model`,
        );
      });

      it('a status that does not read as canonical is refused', async () => {
        await expect(duplicateOf('Blocked')).resolves.toContain(
          `the task ${ANOTHER_TASK}: the task status cannot be read as a canonical one`,
        );
      });
    });

    const refused: [string, (world: CaptureWorld) => InboxClosureRequest, string][] = [
      [
        'a page that is not from the Inbox database',
        () => ({ ...A_CLOSURE, inboxPageId: PROJECT }),
        `page ${PROJECT} is not an Inbox item`,
      ],
      [
        'an item already in the trash',
        (world) => {
          const item = world.pages.get(INBOX_ITEM);
          if (item) world.pages.set(INBOX_ITEM, { ...item, inTrash: true });

          return A_CLOSURE;
        },
        'is in the trash — it is resolved already',
      ],
      [
        'a duplicate of a page that is not a Task',
        () => ({ ...A_CLOSURE, reason: 'duplicate', duplicateOf: PROJECT }),
        `page ${PROJECT} is not a task`,
      ],
      [
        'a duplicate of a Task in the trash',
        (world) => {
          world.pages.set(ANOTHER_TASK, {
            ...pageIn('task', ANOTHER_TASK, 'ds_task'),
            inTrash: true,
          });

          return { ...A_CLOSURE, reason: 'duplicate', duplicateOf: ANOTHER_TASK };
        },
        `the task ${ANOTHER_TASK} is in the trash`,
      ],
    ];

    it.each(refused)('%s is refused with a reason', async (_, request, reason) => {
      const world = new CaptureWorld();
      const service = await world.service();

      await expect(
        refusalOf(() => service.checkClose(CAPTURING, request(world))),
      ).resolves.toContain(reason);
    });

    it.each([
      ['a duplicate without a Task', { ...A_CLOSURE, reason: 'duplicate' }],
      ['a Task given with the reason `trash`', { ...A_CLOSURE, duplicateOf: ANOTHER_TASK }],
      ['an unknown reason', { ...A_CLOSURE, reason: 'later' }],
      ['an empty comment', { ...A_CLOSURE, comment: '' }],
      ['an extra field', { ...A_CLOSURE, status: 'Done' }],
    ])('%s is refused by the schema', (_, request) => {
      expect(inboxClosureSchema.safeParse(request).success).toBe(false);
      expect(inboxClosureSchema.safeParse(A_CLOSURE).success).toBe(true);
    });
  });

  describe('execution', () => {
    it('writes an origin comment, then the trash, and creates no Task', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const closure = await service.checkClose(CAPTURING, A_CLOSURE);

      const done = await stepsOf((step) => service.close(closure, step));

      expect(world.writes.map((call) => call.op)).toEqual(['comment', 'archive']);
      expect(world.threads).toEqual([]);
      expect(done).toEqual({
        pageId: INBOX_ITEM,
        steps: [
          { step: 'origin_noted', commentId: ORIGIN_COMMENT },
          { step: 'item_archived', pageId: INBOX_ITEM },
        ],
      });
    });

    it('the comment on a duplicate mentions the Task the item repeats', async () => {
      const world = new CaptureWorld();

      world.pages.set(ANOTHER_TASK, pageIn('task', ANOTHER_TASK, 'ds_task'));

      const service = await world.service();
      const closure = await service.checkClose(CAPTURING, {
        ...A_CLOSURE,
        reason: 'duplicate',
        duplicateOf: ANOTHER_TASK,
      });

      await stepsOf((step) => service.close(closure, step));

      expect(world.writes).toContainEqual({
        op: 'comment',
        target: { pageId: INBOX_ITEM },
        text: A_CLOSURE.comment,
        mention: ANOTHER_TASK,
      });
    });

    /**
     * When the comment stays and the trash step fails, the comment step is recorded in the run
     * trace, and the item is still in the Inbox.
     */
    it('a refusal at the trash step leaves the comment step in place', async () => {
      const world = new CaptureWorld();
      const service = await world.service();
      const closure = await service.checkClose(CAPTURING, A_CLOSURE);
      const done: CaptureStep[] = [];

      world.failAt = 'archive';

      await expect(service.close(closure, (step) => done.push(step))).rejects.toThrow();
      expect(done).toEqual([{ step: 'origin_noted', commentId: ORIGIN_COMMENT }]);
    });
  });
});
