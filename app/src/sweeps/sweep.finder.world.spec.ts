import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APIErrorCode } from '@notionhq/client';
import { Records } from '../../test/fixtures/methodology-records';
import { notionAnswer } from '../../test/fixtures/notion-answer.fixture';
import { RecordWorld } from '../../test/fixtures/record-world';
import { appConfig } from '../config/app.config';
import type { CanonicalType } from '../notion/binding/binding.schema';
import type { DecodedRecord } from '../notion/semantics/decoded-record';
import { NotionRecordQuery } from '../notion/semantics/record-query';
import { NotionRecordReader } from '../notion/semantics/record.reader';
import { sweepConfig } from './sweep.config';
import { Candidate, SweepFinder } from './sweep.finder';

const ZONE = 'Europe/Kyiv';
const NOW = new Date('2026-10-15T09:00:00.000Z');
const HORIZON = new Date('2026-10-12T09:00:00.000Z');
const { queryLimit } = sweepConfig();

/**
 * Sweep candidates over a world of records in which Notion applies the query conditions itself: the
 * recency threshold, the order and the limit on the number of rows are in the query. The test sees
 * what the answer looks like under them.
 */
describe('sweep candidates over a world of records', () => {
  let records: Records;
  let world: RecordWorld;
  let finder: SweepFinder;

  beforeAll(async () => {
    records = await Records.create();
  });

  beforeEach(async () => {
    world = new RecordWorld();

    const reader: Pick<NotionRecordReader, 'read'> = {
      read: <T extends CanonicalType>(type: T, pageId: string) => {
        const record = world.pages.find(
          (page): page is DecodedRecord<T> => page.type === type && page.pageId === pageId,
        );

        return record
          ? Promise.resolve(record)
          : Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404));
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SweepFinder,
        { provide: NotionRecordQuery, useValue: world },
        { provide: NotionRecordReader, useValue: reader },
        { provide: sweepConfig.KEY, useValue: sweepConfig() },
        { provide: appConfig.KEY, useValue: { ...appConfig(), timeZone: ZONE } },
      ],
    }).compile();

    finder = moduleRef.get(SweepFinder);
  });

  const rulesOf = (found: readonly Candidate[]): [string, string][] =>
    found.map((candidate) => [candidate.pageId, candidate.rule]);

  const waiting = (id: string, date: string, project?: string): DecodedRecord<'task'> =>
    records.task({ id, status: 'Waiting For', date, ...(project ? { project: [project] } : {}) });

  describe('recency threshold in the query', () => {
    /** Old dates do not use up the limit on the number of rows: the query itself cuts them off. */
    it('old check dates do not push out a fresh one', async () => {
      for (let index = 0; index < queryLimit + 10; index += 1) {
        world.pages.push(waiting(`old-${index}`, '2026-09-01'));
      }
      world.pages.push(waiting('fresh', '2026-10-15'));

      expect(rulesOf(await finder.find(NOW, HORIZON))).toEqual([['fresh', 'check_date_reached']]);
    });

    /**
     * There are more fresh ones than the limit: the freshest come first, and the truncation shows
     * in the log.
     */
    it('the older ones stay beyond the limit on the number of rows, and the log shows it', async () => {
      const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      for (let index = 0; index < queryLimit; index += 1) {
        world.pages.push(waiting(`earlier-${index}`, '2026-10-13'));
      }
      world.pages.push(waiting('latest', '2026-10-15'));

      const found = rulesOf(await finder.find(NOW, HORIZON));

      expect(found).toHaveLength(queryLimit);
      expect(found).toContainEqual(['latest', 'check_date_reached']);
      expect(warned).toHaveBeenCalledWith(
        expect.stringContaining(`check dates gave more than ${queryLimit} records`),
      );
    });
  });

  /**
   * A Task of a paused or closed Project is not woken separately: the Project carries the
   * situation.
   */
  describe('a Task and its Project', () => {
    it.each([
      ['Paused', false],
      ['Done', false],
      ['Canceled', false],
      ['Active', true],
      ['Planning', true],
    ])(
      'with a Project whose status is %s, the Task is woken separately: %s',
      async (status, woken) => {
        world.pages.push(records.project({ id: 'project-1', status, tasks: ['task-1'] }));
        world.pages.push(waiting('task-1', '2026-10-15', 'project-1'));

        const found = rulesOf(await finder.find(NOW, HORIZON)).filter(([id]) => id === 'task-1');

        expect(found).toEqual(woken ? [['task-1', 'check_date_reached']] : []);
      },
    );

    it('the deadline of a Task in a closed Project does not wake it separately', async () => {
      world.pages.push(records.project({ id: 'project-1', status: 'Done', tasks: ['task-1'] }));
      world.pages.push(
        records.task({
          id: 'task-1',
          status: 'Next Action',
          deadline: '2026-10-14',
          project: ['project-1'],
        }),
      );

      const found = rulesOf(await finder.find(NOW, HORIZON)).filter(([id]) => id === 'task-1');

      expect(found).toEqual([]);
    });

    it('a Project that was not read does not hide the Task', async () => {
      world.pages.push(waiting('task-1', '2026-10-15', 'project-gone'));

      expect(rulesOf(await finder.find(NOW, HORIZON))).toEqual([['task-1', 'check_date_reached']]);
    });

    it('a Task with no Project is woken', async () => {
      world.pages.push(waiting('task-1', '2026-10-15'));

      expect(rulesOf(await finder.find(NOW, HORIZON))).toEqual([['task-1', 'check_date_reached']]);
    });
  });
});
