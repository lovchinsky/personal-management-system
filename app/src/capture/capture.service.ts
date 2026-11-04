import { Injectable } from '@nestjs/common';
import { AttentionService } from '../attention/attention.service';
import { lifecycleOf, phaseOf } from '../methodology/lifecycle';
import { LiveSchema } from '../notion/client/live-schema';
import { canonicalNotionId } from '../notion/client/notion-id';
import {
  isObjectNotFound,
  NotionAccessError,
  UnconfirmedWriteError,
} from '../notion/client/notion.error';
import { NotionWriter } from '../notion/client/notion.writer';
import { Page } from '../notion/client/page';
import { PageReader } from '../notion/client/page.reader';
import { PhysicalTypes } from '../notion/client/property-write';
import { CanonicalWrite, confirmsWrite } from '../notion/semantics/canonical-write';
import { FieldOf } from '../notion/semantics/decoded-record';
import { SemanticAdapter } from '../notion/semantics/semantic.adapter';
import { InvalidRequestError, parsedRequest } from '../platform/request/invalid-request';
import { Actor } from '../runs/actor';
import { CaptureStep, ConversionStep } from './conversion';
import { InboxClosure, InboxClosureRequest, inboxClosureSchema } from './inbox-closure.schema';
import {
  ConvertedTask,
  InboxConversion,
  InboxConversionRequest,
  inboxConversionSchema,
} from './inbox-conversion.schema';
import { InboxParking, InboxParkingRequest, inboxParkingSchema } from './inbox-parking.schema';

/** The Task fields a conversion writes, in canonical terms. */
type TaskWrites = Partial<Record<FieldOf<'task'>, CanonicalWrite>>;

/** The Inbox item fields the system writes, in canonical terms. */
type InboxWrites = Partial<Record<FieldOf<'inbox_item'>, CanonicalWrite>>;

/** The links a new Task can have: the binding field and the request key. */
const LINK_FIELDS = [
  ['project', 'project'],
  ['area_of_focus', 'areaOfFocus'],
  ['key_results', 'keyResults'],
  ['dependencies', 'dependencies'],
] as const satisfies readonly (readonly [FieldOf<'task'>, keyof ConvertedTask])[];

/** Every field a conversion can write, which the read-back is checked against. */
const WRITTEN_FIELDS: readonly FieldOf<'task'>[] = [
  'name',
  'status',
  'date',
  'deadline',
  ...LINK_FIELDS.map(([field]) => field),
];

/** The Inbox item fields the system writes, which the read-back is checked against. */
const INBOX_WRITTEN_FIELDS: readonly FieldOf<'inbox_item'>[] = ['captured_title', 'captured_text'];

/**
 * System intents over the Inbox: converting an item into a Task (ADR 0017), closing an item
 * without a Task (ADR 0023) and parking an item that was left unresolved
 * (`contracts/canonical.yaml`, key `capture_policy_rules`).
 *
 * A conversion is one intent with three steps in a fixed order: the Task, an origin comment on
 * the item that mentions the Task, the trash. A closure is two of the three: the comment and
 * the trash. Notion does not accept a comment on a page in the trash, so the trash comes last.
 */
@Injectable()
export class CaptureService {
  constructor(
    private readonly pages: PageReader,
    private readonly schema: LiveSchema,
    private readonly semantics: SemanticAdapter,
    private readonly writer: NotionWriter,
    private readonly attention: AttentionService,
  ) {}

  /**
   * Checks a conversion without writing anything, by running every check the write would run:
   * the Inbox item, the Task's limits, the links and the encoding against the live schema of
   * the Task database. A conversion that cannot be performed gets a refusal while the run can
   * still correct it.
   */
  async check(actor: Actor, request: InboxConversionRequest): Promise<InboxConversion> {
    if (actor.kind === 'run' && actor.mode !== 'dialogue') {
      throw new InvalidRequestError(
        'inbox conversion: only a dialogue step converts an Inbox item — a person put it there to be clarified',
      );
    }

    const conversion = parsedRequest(inboxConversionSchema, request, 'inbox conversion');
    const { task } = conversion;

    await this.inboxItem(conversion.inboxPageId);
    // Encoded the way the conversion will write it: against the live schema of the Task
    // database and with the write rules of the semantic model (`INV-005`).
    this.semantics.encode('task', writesOf(task), await this.taskTypes());
    await this.linksLand(task);

    return conversion;
  }

  /**
   * Performs a conversion that `check` has already accepted. Each step is kept as soon as it
   * has happened and is reported to `done`: a system write to Notion cannot be undone, so what
   * was done is recorded in the run trace even when the next step fails. A write that Notion
   * accepted but did not confirm in its response has happened too: its step is kept, and the
   * conversion stops there. The Task that results must read back as what was written.
   * Returns the Task id.
   */
  async convert(
    conversion: InboxConversion,
    done: (step: ConversionStep) => void,
  ): Promise<string> {
    const writes = writesOf(conversion.task);
    const properties = this.semantics.encode('task', writes, await this.taskTypes());
    const task = await taken(
      () => this.writer.createPage(this.semantics.dataSourceOf('task'), properties),
      (id) => done(taskCreated(id)),
    );

    done(taskCreated(task.id));
    this.confirm(task, writes);

    const item = { pageId: conversion.inboxPageId };
    const origin = await taken(
      () => this.writer.comment(item, conversion.comment, { mention: { pageId: task.id } }),
      (id) => done(originNoted(id)),
    );

    done(originNoted(origin.commentId));
    await taken(
      () => this.writer.archive(conversion.inboxPageId),
      () => done(itemArchived(conversion.inboxPageId)),
    );
    done(itemArchived(conversion.inboxPageId));

    return canonicalNotionId(task.id);
  }

  /**
   * Checks parking an item without writing anything. An item is parked by a step in which the
   * person speaks: a chat where they left something unresolved. A run processes an item that
   * already sits in the Inbox; it does not need to park a second one.
   */
  async checkPark(actor: Actor, request: InboxParkingRequest): Promise<InboxParking> {
    if (actor.kind === 'run') {
      throw new InvalidRequestError(
        'Inbox parking: a run clarifies an Inbox item that already exists — leave it there with a comment, do not park a second one',
      );
    }

    const parking = parsedRequest(inboxParkingSchema, request, 'Inbox parking');

    // Encoded the way `park` will write it: against the live schema of the Inbox database.
    this.semantics.encode('inbox_item', parkWrites(parking), await this.inboxTypes());

    return parking;
  }

  /**
   * Parks an item that `checkPark` has already accepted: a page in the Inbox database written
   * on behalf of the bot and, when there is one, a comment with the reasoning. Attention writes
   * the comment, because the person replies to it and the thread leads into processing the
   * item. Each step is kept as soon as it has happened; a write that Notion accepted without
   * confirming has happened too. Returns the item id.
   */
  async park(
    actor: Actor,
    parking: InboxParking,
    done: (step: CaptureStep) => void,
  ): Promise<string> {
    const writes = parkWrites(parking);
    const properties = this.semantics.encode('inbox_item', writes, await this.inboxTypes());
    const item = await taken(
      () => this.writer.createPage(this.semantics.dataSourceOf('inbox_item'), properties),
      (id) => done(itemParked(id)),
    );

    done(itemParked(item.id));
    this.confirmItem(item, writes);

    const { comment } = parking;

    if (comment !== undefined) {
      const reasoning = await taken(
        () => this.attention.comment(actor, { pageId: item.id, text: comment }),
        (id) => done(originNoted(id)),
      );

      done(originNoted(reasoning.commentId));
    }

    return canonicalNotionId(item.id);
  }

  /**
   * Checks closing an item without a Task, writing nothing: that the Inbox item is still there
   * and, for a duplicate, that the existing Task it repeats is there too. A conversation step
   * closes it (a `dialogue` run or the chat), because the evaluation of changes does not
   * process an Inbox item.
   */
  async checkClose(actor: Actor, request: InboxClosureRequest): Promise<InboxClosure> {
    if (actor.kind === 'run' && actor.mode !== 'dialogue') {
      throw new InvalidRequestError(
        'Inbox closure: only a dialogue step closes an Inbox item — a person put it there to be clarified',
      );
    }

    const closure = parsedRequest(inboxClosureSchema, request, 'Inbox closure');

    await this.inboxItem(closure.inboxPageId);

    if (closure.duplicateOf !== undefined) {
      await this.openTask(closure.duplicateOf);
    }

    return closure;
  }

  /**
   * Closes an item that `checkClose` has already accepted: an origin comment (for a duplicate,
   * mentioning the Task it repeats) and the trash. Returns the item id.
   */
  async close(closure: InboxClosure, done: (step: CaptureStep) => void): Promise<string> {
    const item = { pageId: closure.inboxPageId };
    const origin = await taken(
      () =>
        this.writer.comment(
          item,
          closure.comment,
          closure.duplicateOf === undefined ? {} : { mention: { pageId: closure.duplicateOf } },
        ),
      (id) => done(originNoted(id)),
    );

    done(originNoted(origin.commentId));
    await taken(
      () => this.writer.archive(closure.inboxPageId),
      () => done(itemArchived(closure.inboxPageId)),
    );
    done(itemArchived(closure.inboxPageId));

    return canonicalNotionId(closure.inboxPageId);
  }

  /**
   * Checks that an Inbox item is not yet resolved: it exists, sits in the Inbox database and is
   * not in the trash.
   */
  private async inboxItem(pageId: string): Promise<void> {
    const page = await this.readable(pageId, 'the Inbox item');
    const type =
      page.dataSourceId === null ? undefined : this.semantics.typeOfDataSource(page.dataSourceId);

    if (type !== 'inbox_item') {
      throw new InvalidRequestError(`inbox conversion: page ${pageId} is not an Inbox item`);
    }

    if (page.inTrash) {
      throw new InvalidRequestError(
        `inbox conversion: the Inbox item ${pageId} is in the trash — it is resolved already`,
      );
    }
  }

  /**
   * Checks that every link leads to an existing page that is not in the trash and is in the
   * database its property points to. Notion would reject a page from another database at the
   * write itself, when the run cannot correct it.
   */
  private async linksLand(task: ConvertedTask): Promise<void> {
    for (const [field, key] of LINK_FIELDS) {
      const target = this.semantics.linkTargetOf('task', field);

      for (const pageId of task[key] ?? []) {
        const page = await this.readable(pageId, `the ${field} link`);
        if (page.inTrash) {
          throw new InvalidRequestError(
            `inbox conversion: the ${field} link ${pageId} is in the trash`,
          );
        }

        const lands =
          target !== undefined &&
          page.dataSourceId !== null &&
          canonicalNotionId(page.dataSourceId) === canonicalNotionId(target);

        if (!lands) {
          throw new InvalidRequestError(
            `inbox conversion: the ${field} link ${pageId} leads outside the data source the property points to`,
          );
        }

        if (field === 'project') this.projectInWork(pageId, page);
      }
    }
  }

  /**
   * Checks that a new open Task is not attached to a closed Project, because active Tasks must
   * not stay attached to a `Done` or `Canceled` Project out of sight (`docs/1-methodology.md`
   * § “Project Status”). A paused Project accepts the Task, because a pause suppresses Tasks in
   * views instead of forbidding them.
   */
  private projectInWork(pageId: string, page: Page): void {
    const phase = phaseOf(this.semantics.readField('project', page, 'status'));

    if (phase.state === 'terminal') {
      throw new InvalidRequestError(
        `inbox conversion: the project link ${pageId} leads to a project that is ${phase.status} — an open task cannot stay attached to a closed project`,
      );
    }

    if (phase.state === 'undetermined') {
      throw new InvalidRequestError(
        `inbox conversion: the project link ${pageId}: the project status cannot be read as a canonical one (${phase.because})`,
      );
    }
  }

  /** Returns the page, or refuses with an explanation of why it cannot be read. */
  private async readable(pageId: string, what: string): Promise<Page> {
    try {
      return await this.pages.page(pageId);
    } catch (error) {
      if (isObjectNotFound(error)) {
        throw new InvalidRequestError(`inbox conversion: ${what} ${pageId} is not found`);
      }

      if (error instanceof NotionAccessError) {
        throw new InvalidRequestError(`inbox conversion: ${what} — ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Checks that the existing Task a duplicate points to sits in the Task database, is not in
   * the trash and is **open**. An Inbox item describes work that is still waiting, so a closed
   * Task (`Done`, `Canceled`, `Failed`) cannot be what it repeats; the same applies to a status
   * outside the model or one that does not read as canonical.
   */
  private async openTask(pageId: string): Promise<void> {
    const page = await this.readable(pageId, 'the duplicated task');
    const type =
      page.dataSourceId === null ? undefined : this.semantics.typeOfDataSource(page.dataSourceId);

    if (type !== 'task') {
      throw new InvalidRequestError(`Inbox closure: page ${pageId} is not a task`);
    }

    if (page.inTrash) {
      throw new InvalidRequestError(
        `Inbox closure: the task ${pageId} is in the trash — it cannot be what the item duplicates`,
      );
    }

    const lifecycle = lifecycleOf(this.semantics.readField('task', page, 'status'));

    switch (lifecycle.state) {
      case 'open':
        return;

      case 'terminal':
        throw new InvalidRequestError(
          `Inbox closure: the task ${pageId} is ${lifecycle.status} — it cannot be what the item duplicates`,
        );

      case 'out_of_scope':
        throw new InvalidRequestError(
          `Inbox closure: the task ${pageId} has a status outside the canonical model (${lifecycle.value}) — it cannot be what the item duplicates`,
        );

      case 'undetermined':
        throw new InvalidRequestError(
          `Inbox closure: the task ${pageId}: the task status cannot be read as a canonical one (${lifecycle.because})`,
        );
    }
  }

  /**
   * Checks that an Inbox item reads back as what was written; otherwise it is not what the
   * person said.
   */
  private confirmItem(item: Page, writes: InboxWrites): void {
    const mismatched = INBOX_WRITTEN_FIELDS.filter((field) => {
      const write = writes[field];

      return (
        write !== undefined &&
        !confirmsWrite(write, this.semantics.readField('inbox_item', item, field))
      );
    });

    if (mismatched.length > 0) {
      throw new UnconfirmedWriteError(
        'creation of page',
        item.id,
        `reads back otherwise: ${mismatched.join(', ')}`,
      );
    }
  }

  /** Returns the physical types of the Inbox database from the live schema at write time. */
  private inboxTypes(): Promise<PhysicalTypes> {
    return this.schema.typesOf(this.semantics.dataSourceOf('inbox_item'));
  }

  /**
   * Checks that a Task reads back as what was written; otherwise it is not the one that was
   * intended.
   */
  private confirm(task: Page, writes: TaskWrites): void {
    const mismatched = WRITTEN_FIELDS.filter((field) => {
      const write = writes[field];

      return (
        write !== undefined && !confirmsWrite(write, this.semantics.readField('task', task, field))
      );
    });

    if (mismatched.length > 0) {
      throw new UnconfirmedWriteError(
        'creation of page',
        task.id,
        `reads back otherwise: ${mismatched.join(', ')}`,
      );
    }
  }

  /** Returns the physical types of the Task database from the live schema at write time. */
  private taskTypes(): Promise<PhysicalTypes> {
    return this.schema.typesOf(this.semantics.dataSourceOf('task'));
  }
}

const itemParked = (id: string): CaptureStep => ({
  step: 'item_parked',
  pageId: canonicalNotionId(id),
});

const taskCreated = (id: string): ConversionStep => ({
  step: 'task_created',
  pageId: canonicalNotionId(id),
});

const originNoted = (commentId: string): ConversionStep => ({ step: 'origin_noted', commentId });

const itemArchived = (pageId: string): ConversionStep => ({ step: 'item_archived', pageId });

/**
 * A write that Notion accepted but did not confirm in its response (`UnconfirmedWriteError`)
 * has happened all the same: `noted` reports its step under the id Notion returned, and only
 * then does the error propagate.
 */
async function taken<T>(write: () => Promise<T>, noted: (id: string) => void): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof UnconfirmedWriteError) noted(error.id);

    throw error;
  }
}

/** Returns the fields parking writes to an Inbox item, in canonical terms. */
function parkWrites(parking: InboxParking): InboxWrites {
  return {
    captured_title: { kind: 'text', text: parking.title },
    ...(parking.text === undefined
      ? {}
      : { captured_text: { kind: 'text' as const, text: parking.text } }),
  };
}

/** Returns the Task fields a conversion writes, in canonical terms. */
function writesOf(task: ConvertedTask): TaskWrites {
  const writes: TaskWrites = {
    name: { kind: 'text', text: task.name },
    status: { kind: 'option', option: task.status },
  };

  if (task.date) writes.date = { kind: 'date', start: task.date, end: null };
  if (task.deadline) writes.deadline = { kind: 'date', start: task.deadline, end: null };

  for (const [field, key] of LINK_FIELDS) {
    const pageIds = task[key];
    if (pageIds) {
      writes[field] = { kind: 'links', pageIds };
    }
  }

  return writes;
}
