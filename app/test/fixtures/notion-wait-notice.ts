import {
  NOTION_WAIT_NOTICE,
  NotionWait,
  NotionWaitNotice,
} from '../../src/runs/notion-wait-notice';

/** A port that only records what it was told and which window it was told about. */
export class RecordingNotionWaitNotice implements NotionWaitNotice {
  readonly told: (readonly ['waiting' | 'gaveUp', NotionWait])[] = [];

  waiting(wait: NotionWait): Promise<void> {
    this.told.push(['waiting', wait]);

    return Promise.resolve();
  }

  gaveUp(wait: NotionWait): Promise<void> {
    this.told.push(['gaveUp', wait]);

    return Promise.resolve();
  }
}

/** Port provider for tests that need no Notion-wait notices, or need them recorded. */
export const NOTION_WAIT_NOTICE_PROVIDER = {
  provide: NOTION_WAIT_NOTICE,
  useValue: new RecordingNotionWaitNotice(),
};
