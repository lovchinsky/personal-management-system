/**
 * The window of a person's reply in a channel when the window's run did not reach Notion
 * (ADR 0045): which window, and which thread and page.
 */
export interface NotionWait {
  /**
   * The evaluation window. It also identifies the notice: there is one notice per window, however
   * often the window waits.
   */
  readonly windowId: string;
  /** The reply thread: whatever the person sends in answer to the notice also lands in it. */
  readonly discussionId: string;
  readonly pageId: string;
}

/**
 * Port for the notices to a person who replied in a channel while Notion is unavailable. Delivery
 * implements it (`delivery/`) because runs know neither channels nor the queue. Without an adapter
 * `AbsentNotionWaitNotice` implements the port.
 *
 * The person speaks and waits for an answer, so silence is not an option:
 *
 * - `waiting` means the window waits for Notion: “I will answer as soon as Notion is back”;
 * - `gaveUp` means the window waited a day and will not wait any longer: “please write again”.
 *
 * A repeated call for the same window duplicates nothing, because the window is the delivery key.
 */
export interface NotionWaitNotice {
  waiting(wait: NotionWait): Promise<void>;
  gaveUp(wait: NotionWait): Promise<void>;
}

export const NOTION_WAIT_NOTICE = Symbol('NotionWaitNotice');

/** The token under which an adapter plugs itself in from outside `runs/`. */
export const NOTION_WAIT_NOTICE_ADAPTER = Symbol('NotionWaitNoticeAdapter');

/** Wiring without delivery, so there is nobody to tell. */
export class AbsentNotionWaitNotice implements NotionWaitNotice {
  waiting(): Promise<void> {
    return Promise.resolve();
  }

  gaveUp(): Promise<void> {
    return Promise.resolve();
  }
}
