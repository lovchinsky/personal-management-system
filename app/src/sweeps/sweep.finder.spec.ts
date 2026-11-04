import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APIErrorCode } from '@notionhq/client';
import { Records } from '../../test/fixtures/methodology-records';
import { notionAnswer } from '../../test/fixtures/notion-answer.fixture';
import { appConfig } from '../config/app.config';
import type { CanonicalType } from '../notion/binding/binding.schema';
import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { NotionRecordQuery, type RecordFilter } from '../notion/semantics/record-query';
import { NotionRecordReader } from '../notion/semantics/record.reader';
import { sweepConfig } from './sweep.config';
import { Candidate, SweepFinder } from './sweep.finder';

/** October in Kyiv is UTC+3: local midnight of the 15th is 21:00 UTC on the 14th. */
const ZONE = 'Europe/Kyiv';
const NOW = new Date('2026-10-15T09:00:00.000Z');
const HORIZON = new Date('2026-10-12T09:00:00.000Z');
const RECENT = '2026-10-15T06:00:00.000Z';
const LONG_AGO = '2026-09-01T06:00:00.000Z';

/** What the stubbed query answers: a test sets the records by type and conditions. */
type Answer = (type: CanonicalType, where: unknown) => readonly DecodedRecord[];

describe('sweep candidates', () => {
  let records: Records;
  let answer: Answer;
  let cutOff: (type: CanonicalType, where: unknown) => boolean;
  let byId: Map<string, DecodedRecord>;
  let withBody: Map<string, DecodedRecord>;
  let asked: [CanonicalType, unknown][];
  let finder: SweepFinder;

  beforeAll(async () => {
    records = await Records.create();
  });

  beforeEach(async () => {
    answer = () => [];
    cutOff = () => false;
    byId = new Map();
    withBody = new Map();
    asked = [];

    const ofType =
      <T extends CanonicalType>(type: T) =>
      (record: DecodedRecord): record is DecodedRecord<T> =>
        record.type === type;
    const query: Pick<NotionRecordQuery, 'records'> = {
      records: async <T extends CanonicalType>(type: T, where: readonly RecordFilter<T>[]) => {
        asked.push([type, where]);

        return Promise.resolve({
          records: answer(type, where).filter(ofType(type)),
          complete: !cutOff(type, where),
        });
      },
    };
    const reader: Pick<NotionRecordReader, 'read'> = {
      read: async <T extends CanonicalType>(
        type: T,
        pageId: string,
        options?: { readonly withBody?: boolean },
      ) => {
        const record = (options?.withBody ? withBody : byId).get(pageId);

        if (record && ofType(type)(record)) return Promise.resolve(record);

        throw notionAnswer(APIErrorCode.ObjectNotFound, 404);
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SweepFinder,
        { provide: NotionRecordQuery, useValue: query },
        { provide: NotionRecordReader, useValue: reader },
        { provide: sweepConfig.KEY, useValue: sweepConfig() },
        { provide: appConfig.KEY, useValue: { ...appConfig(), timeZone: ZONE } },
      ],
    }).compile();

    finder = moduleRef.get(SweepFinder);
  });

  /** Answers a query whose conditions contain `marker` (a field name or an edit flag). */
  const on =
    (type: CanonicalType, marker: string, found: readonly DecodedRecord[]): Answer =>
    (asked, where) =>
      asked === type && JSON.stringify(where).includes(marker) ? found : [];

  const edited = <T extends DecodedRecord>(record: T, at: string): T => ({
    ...record,
    lastEditedAt: at,
  });

  const rulesOf = (found: readonly Candidate[]): [string, string][] =>
    found.map((candidate) => [candidate.pageId, candidate.rule]);

  describe('check date', () => {
    it('a Waiting For Task whose date has come due in local time is a candidate from local midnight', async () => {
      const task = records.task({ id: 'task-1', status: 'Waiting For', date: '2026-10-15' });

      answer = on('task', '"date"', [task]);

      const found = await finder.find(NOW, HORIZON);

      expect(found).toEqual([
        {
          pageId: 'task-1',
          rule: 'check_date_reached',
          basis: 'date:2026-10-15/',
          since: new Date('2026-10-14T21:00:00.000Z'),
          pages: ['task-1'],
        },
      ]);
      expect(asked[0]).toEqual([
        'task',
        [
          { field: 'status', anyOf: ['Waiting For'] },
          { field: 'date', onOrBefore: '2026-10-16' },
          { field: 'date', onOrAfter: '2026-10-11' },
        ],
      ]);
    });

    it('a date not yet due is not a candidate, though the query is a day wider', async () => {
      answer = on('task', '"date"', [
        records.task({ id: 'task-1', status: 'Waiting For', date: '2026-10-16' }),
      ]);

      await expect(finder.find(NOW, HORIZON)).resolves.toEqual([]);
    });
  });

  describe('deadline', () => {
    it("has passed on an open Task: from the end of the deadline's local day", async () => {
      answer = on('task', '"deadline"', [
        records.task({ id: 'task-1', status: 'Next Action', deadline: '2026-10-14' }),
      ]);

      const [candidate] = await finder.find(NOW, HORIZON);

      expect(candidate).toMatchObject({
        rule: 'deadline_signal',
        basis: 'passed:2026-10-14/',
        since: new Date('2026-10-14T21:00:00.000Z'),
      });
    });

    it('draws near on a Waiting For Task: from the start of the window before the deadline', async () => {
      answer = on('task', '"deadline"', [
        records.task({ id: 'task-1', status: 'Waiting For', deadline: '2026-10-16' }),
        records.task({ id: 'task-2', status: 'Next Action', deadline: '2026-10-16' }),
      ]);

      const found = await finder.find(NOW, HORIZON);

      expect(found).toEqual([
        expect.objectContaining({
          pageId: 'task-1',
          basis: 'near:2026-10-16/',
          since: new Date('2026-10-14T21:00:00.000Z'),
        }),
      ]);
    });
  });

  describe('Projects edited within the recency threshold', () => {
    it('a Project in progress with no path is a candidate; recency is the latest edit of a participant', async () => {
      const project = edited(
        records.project({ id: 'project-1', status: 'Active', tasks: ['task-1'] }),
        LONG_AGO,
      );
      const done = edited(
        records.task({ id: 'task-1', status: 'Done', project: ['project-1'] }),
        RECENT,
      );

      answer = (type, where) => {
        const text = JSON.stringify(where);

        if (text.includes('editedOnOrAfter')) return type === 'task' ? [done] : [];
        if (text.includes('linksTo')) return [done];

        return [];
      };
      byId.set('project-1', project);

      await expect(finder.find(NOW, HORIZON)).resolves.toEqual([
        {
          pageId: 'project-1',
          rule: 'project_path',
          basis: `edited:${RECENT}`,
          since: new Date(RECENT),
          pages: ['project-1', 'task-1'],
        },
      ]);
    });

    it('a closed Project with an unfinished Task and a paused one with a deadline are candidates', async () => {
      const closed = edited(
        records.project({ id: 'project-1', status: 'Done', tasks: ['task-1'] }),
        RECENT,
      );
      const paused = edited(
        records.project({ id: 'project-2', status: 'Paused', tasks: ['task-2'] }),
        RECENT,
      );
      const open = records.task({ id: 'task-1', status: 'Next Action', project: ['project-1'] });
      const dated = records.task({
        id: 'task-2',
        status: 'Next Action',
        project: ['project-2'],
        deadline: '2026-11-01',
      });

      answer = (type, where) => {
        const text = JSON.stringify(where);

        if (text.includes('editedOnOrAfter')) return type === 'project' ? [closed, paused] : [];
        if (text.includes('"project-1"')) return [open];
        if (text.includes('"project-2"')) return [dated];

        return [];
      };

      expect(rulesOf(await finder.find(NOW, HORIZON)).sort()).toEqual([
        ['project-1', 'project_closure'],
        ['project-2', 'paused_commitment'],
      ]);
    });

    /**
     * The Task that moves the work may be the one beyond the limit, so the first Tasks alone would
     * show a Project in progress with no path that is not stalled.
     */
    it('judges nothing for a Project whose Tasks the query did not return in full, and logs it', async () => {
      const project = edited(
        records.project({ id: 'project-1', status: 'Active', tasks: ['task-1'] }),
        LONG_AGO,
      );
      const done = edited(
        records.task({ id: 'task-1', status: 'Done', project: ['project-1'] }),
        RECENT,
      );
      const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      answer = (type, where) => {
        const text = JSON.stringify(where);

        if (text.includes('editedOnOrAfter')) return type === 'task' ? [done] : [];
        if (text.includes('linksTo')) return [done];

        return [];
      };
      cutOff = (_type, where) => JSON.stringify(where).includes('linksTo');
      byId.set('project-1', project);

      await expect(finder.find(NOW, HORIZON)).resolves.toEqual([]);
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('project project-1 not judged'));
    });

    it('skips a Project that does not exist for the integration', async () => {
      answer = on('task', 'editedOnOrAfter', [
        records.task({ id: 'task-1', status: 'Done', project: ['missing'] }),
      ]);

      await expect(finder.find(NOW, HORIZON)).resolves.toEqual([]);
    });
  });

  describe('dependency', () => {
    it('a Next Action with an open blocker is a candidate with all participants', async () => {
      const task = edited(
        records.task({ id: 'task-1', status: 'Next Action', dependencies: ['blocker-1'] }),
        LONG_AGO,
      );

      answer = on('task', '"dependencies"', [task]);
      byId.set(
        'blocker-1',
        edited(records.task({ id: 'blocker-1', status: 'Next Action' }), RECENT),
      );

      await expect(finder.find(NOW, HORIZON)).resolves.toEqual([
        {
          pageId: 'task-1',
          rule: 'dependency_contradiction',
          basis: `edited:${RECENT}`,
          since: new Date(RECENT),
          pages: ['task-1', 'blocker-1'],
        },
      ]);
    });

    /**
     * A `Waiting For` says in its body whether there is still something to wait for, and only a
     * `Waiting For` Task has its body read.
     */
    it('a Waiting For Task whose blocker is resolved is judged by its body', async () => {
      const waiting = { id: 'task-1', status: 'Waiting For', dependencies: ['blocker-1'] };

      answer = on('task', '"dependencies"', [records.task(waiting)]);
      byId.set('blocker-1', records.task({ id: 'blocker-1', status: 'Done' }));
      withBody.set('task-1', records.task({ ...waiting, body: [] }));

      expect(rulesOf(await finder.find(NOW, HORIZON))).toEqual([
        ['task-1', 'dependency_contradiction'],
      ]);
    });
  });

  it('skips a group Notion did not return, but not the rest', async () => {
    answer = (_type, where) => {
      const text = JSON.stringify(where);

      if (text.includes('"deadline"')) throw notionAnswer(APIErrorCode.ServiceUnavailable, 503);
      if (text.includes('"date"')) {
        return [records.task({ id: 'task-1', status: 'Waiting For', date: '2026-10-15' })];
      }

      return [];
    };

    expect(rulesOf(await finder.find(NOW, HORIZON))).toEqual([['task-1', 'check_date_reached']]);
  });

  /**
   * A group is a unit of work: an unknown failure shows in the log as an error, and the tick
   * continues.
   */
  it('an unknown failure skips the group with an error in the log, but not the rest', async () => {
    const task = records.task({ id: 'task-1', status: 'Waiting For', date: '2026-10-15' });
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    answer = (type, where) => {
      if (JSON.stringify(where).includes('"deadline"')) throw new Error('mapping drifted');

      return on('task', '"date"', [task])(type, where);
    };

    expect(rulesOf(await finder.find(NOW, HORIZON))).toEqual([['task-1', 'check_date_reached']]);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('deadlines skipped this tick — unknown: mapping drifted'),
      expect.anything(),
    );
  });
});
