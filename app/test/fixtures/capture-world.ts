import { Test } from '@nestjs/testing';
import { APIErrorCode } from '@notionhq/client';
import { ApprovalsService } from '../../src/approvals/approvals.service';
import { AttentionService } from '../../src/attention/attention.service';
import {
  SystemDiscussionRepository,
  SystemWrite,
} from '../../src/attention/system-discussion.repository';
import { CaptureService } from '../../src/capture/capture.service';
import { CaptureStep, ConversionStep } from '../../src/capture/conversion';
import { InboxConversion, InboxConversionRequest } from '../../src/capture/inbox-conversion.schema';
import { appConfig } from '../../src/config/app.config';
import { ContinuationsService } from '../../src/continuations/continuations.service';
import { BindingFile, CanonicalType } from '../../src/notion/binding/binding.schema';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { UnconfirmedWriteError, WriteOperation } from '../../src/notion/client/notion.error';
import { CommentTarget, NotionWriter, WrittenComment } from '../../src/notion/client/notion.writer';
import {
  canonicalPage,
  Page,
  PageProperty,
  RestPage,
  RestProperty,
} from '../../src/notion/client/page';
import { PageReader } from '../../src/notion/client/page.reader';
import { propertyIdFromCanonical } from '../../src/notion/client/property-id';
import { PhysicalTypes, PropertyWrites } from '../../src/notion/client/property-write';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { notionAnswer } from './notion-answer.fixture';
import { echoOf } from './notion-echo.fixture';
import { TASK_STATUS_ID, VALID_BINDING_FILE } from './notion-mapping.fixture';
import { pageFor } from './notion-page.fixture';
import { bindingProvider, unreached } from './test-module';

export const INBOX_ITEM = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
export const PROJECT = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
export const KEY_RESULT = '3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e';
export const ANOTHER_TASK = '5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a';
/** The Task the conversion creates. */
export const CREATED_TASK = '4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f';
/** The origin comment the conversion leaves. */
export const ORIGIN_COMMENT = 'origin-comment';

/** The Inbox item the system parks: Notion supplies its id on creation. */
export const PARKED_ITEM = '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
/** The reasoning comment that parking leaves. */
export const REASONING_COMMENT = 'reasoning-comment';

/** A conversion that the check accepts: an open status, a name, a comment. */
export const A_CONVERSION: InboxConversionRequest = {
  inboxPageId: INBOX_ITEM,
  task: { name: 'Подзвонити в банк', status: 'Next Action' },
  comment: 'Це задача: дзвінок у банк щодо рахунку',
};

/** What reached Notion as a write, in the order of the calls to the write boundary. */
export type WriteCall =
  | {
      readonly op: 'createPage';
      readonly dataSourceId: string;
      readonly properties: PropertyWrites;
    }
  | {
      readonly op: 'comment';
      readonly target: CommentTarget;
      readonly text: string;
      readonly mention?: string;
    }
  | { readonly op: 'archive'; readonly pageId: string }
  | { readonly op: 'updateProperties'; readonly pageId: string };

/** The live schema of the fixture's Task database: the physical types of its properties. */
export const TASK_TYPES: PhysicalTypes = new Map([
  [propertyIdFromCanonical('title'), 'title'],
  [TASK_STATUS_ID, 'status'],
  [propertyIdFromCanonical('p_task_date'), 'date'],
  [propertyIdFromCanonical('p_task_deadline'), 'date'],
  [propertyIdFromCanonical('r_task_project'), 'relation'],
  [propertyIdFromCanonical('r_task_area_of_focus'), 'relation'],
  [propertyIdFromCanonical('r_task_key_results'), 'relation'],
  [propertyIdFromCanonical('r_task{dependencies'), 'relation'],
  [propertyIdFromCanonical('r_task_behavior_system'), 'relation'],
]);

/**
 * The live schema of the fixture's Inbox database: the name, the creation time and, under a
 * binding with a text carrier, the text.
 */
const INBOX_TYPES: PhysicalTypes = new Map([
  [propertyIdFromCanonical('title'), 'title'],
  [propertyIdFromCanonical('p_inbox_item_captured_at'), 'created_time'],
  [propertyIdFromCanonical('p_inbox_item_text'), 'rich_text'],
]);

/** A binding in which the Inbox has a carrier for the text of the item. */
export const BINDING_WITH_INBOX_TEXT: BindingFile = {
  ...VALID_BINDING_FILE,
  fields: {
    ...VALID_BINDING_FILE.fields,
    inbox_item: {
      ...VALID_BINDING_FILE.fields.inbox_item,
      captured_text: { kind: 'native', propertyId: 'p_inbox_item_text' },
    },
  },
};

/** Builds a page of type `type` that sits in the data source `dataSourceId`. */
export function pageIn(type: CanonicalType, id: string, dataSourceId: string): Page {
  return { ...pageFor(type), id, dataSourceId };
}

/** The world in which capture converts: the pages, the live schema and the write boundary. */
export class CaptureWorld {
  readonly writes: WriteCall[] = [];
  /** The threads attention recorded in the registry. The world opens each of them once. */
  readonly threads: SystemWrite[] = [];
  /** The pages the App can read, by id. */
  readonly pages = new Map<string, Page>([
    [INBOX_ITEM, pageIn('inbox_item', INBOX_ITEM, VALID_BINDING_FILE.data_sources.inbox_item)],
    [PROJECT, pageIn('project', PROJECT, 'ds_project')],
    [KEY_RESULT, pageIn('key_result', KEY_RESULT, 'ds_key_results')],
    [ANOTHER_TASK, pageIn('task', ANOTHER_TASK, 'ds_dependencies')],
  ]);
  /** The step at which Notion refuses the write. */
  failAt: WriteCall['op'] | null = null;
  /**
   * The step that Notion accepts but does not confirm in its answer, because the author is not the
   * integration bot.
   */
  unconfirmedAt: WriteCall['op'] | null = null;
  /** How Notion returns the written properties: by default exactly what was written. */
  echo: (id: string, write: PropertyWrites[string]) => RestProperty = echoOf;

  readonly writer: Pick<NotionWriter, 'createPage' | 'comment' | 'archive' | 'updateProperties'> = {
    createPage: (dataSourceId, properties) => {
      const inbox = dataSourceId === VALID_BINDING_FILE.data_sources.inbox_item;

      this.record(
        { op: 'createPage', dataSourceId, properties },
        'creation of page',
        inbox ? PARKED_ITEM : CREATED_TASK,
      );

      return Promise.resolve(inbox ? this.parked(properties) : this.created(properties));
    },
    comment: (target, text, extras) => {
      const reasoning = 'pageId' in target && target.pageId === PARKED_ITEM;
      const commentId = reasoning ? REASONING_COMMENT : ORIGIN_COMMENT;

      this.record(
        { op: 'comment', target, text, mention: extras?.mention?.pageId },
        'comment',
        commentId,
      );

      const written: WrittenComment = {
        commentId,
        discussionId: 'origin-thread',
        pageId: 'pageId' in target ? target.pageId : null,
        blockId: null,
      };

      return Promise.resolve(written);
    },
    archive: (pageId) => {
      this.record({ op: 'archive', pageId }, 'archive of page', pageId);

      return Promise.resolve();
    },
    updateProperties: (pageId) => {
      this.record({ op: 'updateProperties', pageId }, 'update of page', pageId);

      return Promise.reject(new Error('the conversion updated an existing page'));
    },
  };

  /**
   * Builds capture over this world: the real adapter over the fixture binding and the real
   * attention.
   */
  async service(binding: BindingFile = VALID_BINDING_FILE): Promise<CaptureService> {
    const pages: Pick<PageReader, 'page'> = {
      page: (id) => {
        const page = this.pages.get(id);

        return page
          ? Promise.resolve(page)
          : Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404));
      },
    };
    const schema: Pick<LiveSchema, 'typesOf'> = {
      typesOf: (dataSourceId) =>
        Promise.resolve(
          dataSourceId === VALID_BINDING_FILE.data_sources.inbox_item ? INBOX_TYPES : TASK_TYPES,
        ),
    };

    const discussions: Pick<SystemDiscussionRepository, 'find' | 'wrote'> = {
      find: () => Promise.resolve(null),
      wrote: (write) => {
        this.threads.push(write);

        return Promise.resolve();
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CaptureService,
        AttentionService,
        SemanticAdapter,
        bindingProvider(binding),
        { provide: PageReader, useValue: pages },
        { provide: LiveSchema, useValue: schema },
        { provide: NotionWriter, useValue: this.writer },
        { provide: appConfig.KEY, useValue: appConfig() },
        { provide: SystemDiscussionRepository, useValue: discussions },
        unreached(ContinuationsService),
        unreached(ApprovalsService),
      ],
    }).compile();

    return moduleRef.get(CaptureService);
  }

  /**
   * Records a write that reached Notion: either a refusal, or an accepted write with no
   * confirmation (`id` is what it created).
   */
  private record(call: WriteCall, operation: WriteOperation, id: string): void {
    if (this.failAt === call.op) throw notionAnswer(APIErrorCode.ValidationError, 400);

    this.writes.push(call);

    if (this.unconfirmedAt === call.op) {
      throw new UnconfirmedWriteError(operation, id, 'attributed it to someone else');
    }
  }

  /** Builds an Inbox item as Notion returns it on creation: the written properties as written. */
  private parked(properties: PropertyWrites): Page {
    const item = pageFor('inbox_item');
    const blank = [...item.properties.values()].map((property): [string, RestProperty] => [
      String(property.id),
      restOf(property),
    ]);
    const echoed = Object.entries(properties).map(([key, write]): [string, RestProperty] => [
      key,
      this.echo(key, write),
    ]);

    return canonicalPage({
      id: PARKED_ITEM,
      parent: {
        type: 'data_source_id',
        data_source_id: VALID_BINDING_FILE.data_sources.inbox_item,
        database_id: 'db_inbox_item',
      },
      last_edited_time: item.last_edited_time,
      in_trash: false,
      properties: Object.fromEntries([...blank, ...echoed]),
    });
  }

  /**
   * Builds a Task as Notion returns it: all the database properties, the written ones as written.
   */
  private created(properties: PropertyWrites): Page {
    return canonicalPage(taskAsCreated(CREATED_TASK, properties, this.echo));
  }
}

/**
 * Builds a Task as Notion returns it on creation: all the properties of the Task database, with
 * the written ones as Notion returns them (`echo`).
 */
export function taskAsCreated(
  id: string,
  properties: PropertyWrites,
  echo: (id: string, write: PropertyWrites[string]) => RestProperty = echoOf,
): RestPage {
  const task = pageFor('task');
  const blank = [...task.properties.values()].map((property): [string, RestProperty] => [
    String(property.id),
    restOf(property),
  ]);
  const echoed = Object.entries(properties).map(([key, write]): [string, RestProperty] => [
    key,
    echo(key, write),
  ]);

  return {
    id,
    parent: {
      type: 'data_source_id',
      data_source_id: VALID_BINDING_FILE.data_sources.task,
      database_id: 'db_task',
    },
    last_edited_time: task.last_edited_time,
    in_trash: false,
    properties: Object.fromEntries([...blank, ...echoed]),
  };
}

/** Turns a canonical page property back into the REST form: the same payload, id as a string. */
function restOf(property: PageProperty): RestProperty {
  return { ...property, id: String(property.id) };
}

/** Carries a conversion through to the end and returns the steps it reported and the Task id. */
export async function converted(
  service: CaptureService,
  conversion: InboxConversion,
): Promise<{ readonly steps: readonly ConversionStep[]; readonly taskPageId: string }> {
  const steps: ConversionStep[] = [];
  const taskPageId = await service.convert(conversion, (step) => steps.push(step));

  return { steps, taskPageId };
}

/** Returns the steps of a `capture` intent that ran to the end. */
export async function stepsOf(
  run: (done: (step: CaptureStep) => void) => Promise<string>,
): Promise<{ readonly steps: readonly CaptureStep[]; readonly pageId: string }> {
  const steps: CaptureStep[] = [];
  const pageId = await run((step) => steps.push(step));

  return { steps, pageId };
}

/** Returns the steps a conversion that stopped managed to take. Throws if it did not stop. */
export async function stepsBeforeStop(
  service: CaptureService,
  conversion: InboxConversion,
): Promise<readonly ConversionStep[]> {
  const steps: ConversionStep[] = [];

  await expect(service.convert(conversion, (step) => steps.push(step))).rejects.toThrow();

  return steps;
}
