import {
  APIErrorCode,
  type CommentObjectResponse,
  type PageObjectResponse,
} from '@notionhq/client';
import { LiveProperty } from '../../src/notion/client/live-schema';
import { RestProperty } from '../../src/notion/client/page';
import { PropertyId } from '../../src/notion/client/property-id';
import { PropertyWrite, PropertyWrites } from '../../src/notion/client/property-write';
import { notionAnswer } from './notion-answer.fixture';
import { INTEGRATION_BOT } from './notion-bot';
import { echoOf } from './notion-echo.fixture';
import { TASK_STATUS_ID, TASK_STATUS_SPELLED, VALID_BINDING_FILE } from './notion-mapping.fixture';
import { dateProperty, LAST_EDITED, optionProperty, textProperty } from './notion-page.fixture';

/** The Task every world starts with. */
export const TASK_PAGE_ID = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
export const A_PERSON = '61313cf4-0000-4000-8000-000000000001';
export const TASK_DATE_ID = 'p_task_date';
export const NEXT_ACTION = 'opt_next_action';
/** The Task status the way the workspace shows it: the person sees names, not ids. */
export const TASK_STATUS_LIVE: ReadonlyMap<PropertyId, LiveProperty> = new Map([
  [
    TASK_STATUS_ID,
    {
      type: 'status',
      name: 'Статус',
      options: [NEXT_ACTION, 'opt_done'],
      optionNames: new Map([
        [NEXT_ACTION, 'Наступна дія'],
        ['opt_done', 'Готово'],
      ]),
    },
  ],
]);
/** The minute after the last edit: Notion truncates the time to the minute. */
const LATER_MINUTE = '2026-09-24T08:01:00.000Z';

/** What reached Notion as a write: the body of `pages.update`, as the write boundary sent it. */
export interface Update {
  readonly page_id: string;
  readonly properties?: PropertyWrites;
  readonly in_trash?: boolean;
}

/** What reached Notion as a comment: where to, the text and the displayed name. */
export interface Note {
  readonly discussion_id?: string;
  readonly page_id?: string;
  readonly text: string;
  readonly label?: string;
}

/** An in-memory Task: properties in REST form, the time of the last edit, the trash. */
interface Task {
  properties: Record<string, RestProperty>;
  lastEdited: string;
  inTrash: boolean;
}

interface CommentRequest {
  readonly parent?: { readonly page_id: string };
  readonly discussion_id?: string;
  readonly rich_text: readonly { readonly text?: { readonly content: string } }[];
  readonly display_name?: { readonly type: string; readonly custom?: { readonly name: string } };
}

/**
 * An in-memory stand-in for the part of Notion that a proposal, its execution and the proposal
 * trail use: Tasks and comments.
 *
 * A read returns the Task as it currently is. A write applies the encoded properties the way
 * Notion returns them, moves the time of the last edit forward and attributes the response to
 * `author`. `refusal` is Notion's answer to subsequent writes instead of a write, `readRefusal` to
 * subsequent reads, `commentRefusal` to subsequent comments.
 */
export class TasksInNotion {
  readonly updates: Update[] = [];
  readonly notes: Note[] = [];
  readonly tasks = new Map<string, Task>();
  author = INTEGRATION_BOT;
  refusal: Error | null = null;
  readRefusal: Error | null = null;
  commentRefusal: Error | null = null;
  /** How Notion returns what was written: by default, exactly what was written. */
  echo: (id: string, write: PropertyWrite) => RestProperty = echoOf;

  readonly pages = {
    retrieve: ({ page_id }: { page_id: string }): Promise<PageObjectResponse> => {
      if (this.readRefusal) return Promise.reject(this.readRefusal);

      const task = this.tasks.get(page_id);
      if (!task) {
        return Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404));
      }

      return Promise.resolve(this.response(page_id, task, A_PERSON));
    },
    update: (update: Update): Promise<PageObjectResponse> => {
      this.updates.push(update);

      const task = this.tasks.get(update.page_id);

      if (this.refusal) return Promise.reject(this.refusal);
      if (!task) return Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404));

      for (const [id, write] of Object.entries(update.properties ?? {})) {
        task.properties[id] = this.echo(id, write);
      }

      task.lastEdited = LATER_MINUTE;

      return Promise.resolve(this.response(update.page_id, task, this.author));
    },
  };

  readonly comments = {
    create: (request: CommentRequest): Promise<CommentObjectResponse> => {
      if (this.commentRefusal) return Promise.reject(this.commentRefusal);

      const note: Note = {
        ...(request.discussion_id ? { discussion_id: request.discussion_id } : {}),
        ...(request.parent ? { page_id: request.parent.page_id } : {}),
        text: request.rich_text.map((run) => run.text?.content ?? '').join(''),
        ...(request.display_name?.custom ? { label: request.display_name.custom.name } : {}),
      };

      this.notes.push(note);

      const comment: CommentObjectResponse = {
        object: 'comment',
        id: `comment-${this.notes.length}`,
        parent: { type: 'page_id', page_id: request.parent?.page_id ?? TASK_PAGE_ID },
        discussion_id: request.discussion_id ?? 'discussion-new',
        created_time: LATER_MINUTE,
        last_edited_time: LATER_MINUTE,
        created_by: { object: 'user', id: this.author },
        rich_text: [],
        display_name: {
          type: request.display_name?.custom ? 'custom' : 'integration',
          resolved_name: request.display_name?.custom?.name ?? null,
        },
      };

      return Promise.resolve(comment);
    },
  };

  reset(): void {
    this.updates.length = 0;
    this.notes.length = 0;
    this.tasks.clear();
    this.author = INTEGRATION_BOT;
    this.refusal = null;
    this.readRefusal = null;
    this.commentRefusal = null;
    this.echo = echoOf;
    this.add(TASK_PAGE_ID);
  }

  /** Adds a Task with status `Next Action` and an empty date, as the person left it. */
  add(pageId: string): void {
    this.tasks.set(pageId, {
      properties: {
        title: textProperty('title', 'Подзвонити в банк'),
        [TASK_STATUS_SPELLED]: optionProperty(TASK_STATUS_SPELLED, NEXT_ACTION, 'Next Action'),
        [TASK_DATE_ID]: dateProperty(TASK_DATE_ID, null),
      },
      lastEdited: LAST_EDITED,
      inTrash: false,
    });
  }

  task(pageId = TASK_PAGE_ID): Task {
    const task = this.tasks.get(pageId);
    if (!task) {
      throw new Error(`no task ${pageId} in this Notion`);
    }

    return task;
  }

  /** Sets the status as if the person changed it by hand. */
  personSets(optionId: string, name: string): void {
    const task = this.task();

    task.properties[TASK_STATUS_SPELLED] = optionProperty(TASK_STATUS_SPELLED, optionId, name);
    task.lastEdited = LATER_MINUTE;
  }

  private response(pageId: string, task: Task, lastEditor: string): PageObjectResponse {
    return {
      object: 'page',
      id: pageId,
      created_time: '2026-09-20T08:00:00.000Z',
      last_edited_time: task.lastEdited,
      in_trash: task.inTrash,
      archived: task.inTrash,
      is_archived: task.inTrash,
      is_locked: false,
      url: `https://www.notion.so/${pageId}`,
      public_url: null,
      parent: {
        type: 'data_source_id',
        data_source_id: VALID_BINDING_FILE.data_sources.task,
        database_id: 'db_task',
      },
      properties: { ...task.properties },
      icon: null,
      cover: null,
      created_by: { object: 'user', id: A_PERSON },
      last_edited_by: { object: 'user', id: lastEditor },
    };
  }
}
