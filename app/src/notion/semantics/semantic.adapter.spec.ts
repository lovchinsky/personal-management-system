import { Logger } from '@nestjs/common';
import {
  TASK_STATUS_ID,
  TASK_STATUS_SPELLED,
  VALID_BINDING_FILE,
} from '../../../test/fixtures/notion-mapping.fixture';
import {
  adapterWith,
  block,
  DATE,
  dateProperty,
  LAST_EDITED,
  misbound,
  numberFormula,
  numberRollup,
  optionProperty,
  pageFor,
  relationProperty,
  taskWithStatus,
  textProperty,
  without,
} from '../../../test/fixtures/notion-page.fixture';
import { BindingFile } from '../binding/binding.schema';
import { LiveProperty } from '../client/live-schema';
import { Page, PageBlock } from '../client/page';
import { PropertyId, propertyIdFromCanonical } from '../client/property-id';
import { PhysicalTypes, PropertyWrites } from '../client/property-write';
import { AdapterConfigurationError } from './adapter.error';
import { CanonicalWrite, canonicalWriteSchema } from './canonical-write';
import { FieldOf } from './decoded-record';
import { Reading } from './reading';
import { SemanticAdapter, ShownChange } from './semantic.adapter';
import { UnwritableOnPageError } from './unwritable-on-page.error';
import { UnwritableValueError } from './unwritable-value.error';

describe('SemanticAdapter', () => {
  let adapter: SemanticAdapter;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    adapter = await adapterWith();
  });

  const readingOf = (page: Page, slot: FieldOf<'task'>, body?: readonly PageBlock[]): Reading =>
    adapter.decode('task', page, body).readings[slot];

  it('covers every canonical field of the type with a reading, not only the filled ones', () => {
    const record = adapter.decode('task', pageFor('task'));

    expect(Object.keys(record.readings).sort()).toEqual(
      Object.keys(VALID_BINDING_FILE.fields.task).sort(),
    );
  });

  it('reads the name, the status and the relations', () => {
    const page = pageFor('task', {
      title: textProperty('title', 'Подзвонити в банк'),
      r_task_project: relationProperty('r_task_project', ['project-1']),
    });
    const record = adapter.decode('task', page);

    expect(record.pageId).toBe('page-1');
    expect(record.readings.name).toEqual({
      state: 'value',
      value: { type: 'text', text: 'Подзвонити в банк' },
    });
    expect(record.readings.status).toEqual({
      state: 'value',
      value: { type: 'option', option: 'Next Action' },
    });
    expect(record.readings.project).toEqual({
      state: 'value',
      value: { type: 'links', pageIds: ['project-1'], truncated: false },
    });
  });

  it('an empty relation stays a value: the carrier exists, there are no relations', () => {
    expect(readingOf(pageFor('task'), 'key_results')).toEqual({
      state: 'value',
      value: { type: 'links', pageIds: [], truncated: false },
    });
  });

  it('marks a truncated list of relations', () => {
    const page = pageFor('task', {
      r_task_key_results: relationProperty('r_task_key_results', ['kr-1'], true),
    });

    expect(readingOf(page, 'key_results')).toEqual({
      state: 'value',
      value: { type: 'links', pageIds: ['kr-1'], truncated: true },
    });
  });

  it('an empty text property yields `empty`: the carrier exists and holds nothing', () => {
    const page = pageFor('task', { title: textProperty('title', '   ') });

    expect(readingOf(page, 'name')).toEqual({ state: 'empty' });
  });

  it('returns an absence declared in the binding with its reason', () => {
    const record = adapter.decode('objective', pageFor('objective'));

    expect(record.readings.why_now).toEqual({
      state: 'absent',
      reason: 'why_now has no carrier',
    });
  });

  describe('Date and Deadline', () => {
    const dateOf = (page: Page) => readingOf(page, 'date');

    it.each([
      ['opt_next_action', 'Next Action'],
      ['opt_scheduled', 'Scheduled'],
      ['opt_waiting_for', 'Waiting For'],
      ['opt_someday', 'Someday/Maybe'],
      ['opt_done', 'Done'],
    ])('`Date` is read independently of the status: %s', (optionId, name) => {
      expect(dateOf(taskWithStatus(optionId, name))).toEqual({
        state: 'value',
        value: { type: 'date', start: DATE, end: null, timeZone: null },
      });
    });

    it('an unknown status does not stop the reading of the date', () => {
      const page = taskWithStatus('opt_unknown', 'Blocked');

      expect(readingOf(page, 'status').state).toBe('gap');
      expect(dateOf(page)).toEqual({
        state: 'value',
        value: { type: 'date', start: DATE, end: null, timeZone: null },
      });
    });

    it('`Deadline` is read independently of `Date`: both are on the same Task', () => {
      const page = taskWithStatus('opt_scheduled', 'Scheduled');

      expect(readingOf(page, 'date').state).toBe('value');
      expect(readingOf(page, 'deadline')).toEqual({
        state: 'value',
        value: { type: 'date', start: DATE, end: null, timeZone: null },
      });
    });

    it('an explicitly chosen time zone is not lost', () => {
      const page = pageFor('task', {
        p_task_date: {
          id: 'p_task_date',
          type: 'date',
          date: { start: DATE, end: null, time_zone: 'Europe/Kyiv' },
        },
      });

      expect(dateOf(page)).toEqual({
        state: 'value',
        value: { type: 'date', start: DATE, end: null, timeZone: 'Europe/Kyiv' },
      });
    });

    it('an empty date yields `empty`', () => {
      const page = pageFor('task', { p_task_date: dateProperty('p_task_date', null) });

      expect(dateOf(page)).toEqual({ state: 'empty' });
    });
  });

  describe('values outside the canonical model', () => {
    it('a registered non-canonical value is not mapped and raises no error', () => {
      const page = taskWithStatus('opt_hidden', 'Hidden');

      expect(readingOf(page, 'status')).toEqual({ state: 'non_canonical', value: 'Hidden' });
      expect(warn).not.toHaveBeenCalled();
    });

    it('an unknown status value yields `schema_gap`, not a default', () => {
      const page = taskWithStatus('opt_unknown', 'Blocked');
      const record = adapter.decode('task', page);

      expect(record.readings.status).toEqual({
        state: 'gap',
        gap: { kind: 'schema_gap', slot: 'task.status', value: 'Blocked (opt_unknown)' },
      });
      expect(record.readings.name.state).toBe('value');
    });

    it('a gap in the model does not stay silent', () => {
      adapter.decode('task', taskWithStatus('opt_unknown', 'Blocked'));

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('task.status = Blocked (opt_unknown)'),
      );
    });

    it('an unknown `Mode` option yields `schema_gap`', () => {
      const page = pageFor('area_of_focus', {
        p_area_of_focus_mode: optionProperty('p_area_of_focus_mode', 'opt_unknown', 'Sprint'),
      });

      expect(adapter.decode('area_of_focus', page).readings.mode).toEqual({
        state: 'gap',
        gap: { kind: 'schema_gap', slot: 'area_of_focus.mode', value: 'Sprint (opt_unknown)' },
      });
    });

    it('an unknown `Lifecycle` option yields `schema_gap`', () => {
      const page = pageFor('behavior_system', {
        p_behavior_system_lifecycle: optionProperty(
          'p_behavior_system_lifecycle',
          'opt_unknown',
          'Paused',
        ),
      });

      expect(adapter.decode('behavior_system', page).readings.lifecycle).toEqual({
        state: 'gap',
        gap: {
          kind: 'schema_gap',
          slot: 'behavior_system.lifecycle',
          value: 'Paused (opt_unknown)',
        },
      });
    });
  });

  describe('a carrier outside what was read', () => {
    it('a body that was not passed yields `unread`, not `absent`', () => {
      expect(readingOf(pageFor('task'), 'waiting_for')).toEqual({
        state: 'unread',
        carrier: 'page body',
      });
    });

    it('an empty body yields `empty` for all prose semantics of the record', () => {
      const record = adapter.decode('task', pageFor('task'), []);

      expect(record.readings.waiting_for).toEqual({ state: 'empty' });
      expect(record.readings.result_or_note).toEqual(record.readings.waiting_for);
    });

    it('the body is read whole and goes to every prose semantic', () => {
      const record = adapter.decode('task', pageFor('task'), [block]);
      const prose = { state: 'value', value: { type: 'prose', blocks: [block] } };

      expect(record.readings.waiting_for).toEqual(prose);
      expect(record.readings.result_or_note).toEqual(prose);
    });

    it('a relation traversal does not count as read', () => {
      expect(
        adapter.decode('objective', pageFor('objective')).readings.supporting_projects,
      ).toEqual({
        state: 'unread',
        carrier: 'traversal through_key_results through property aFBO',
      });
    });

    it('a GBrain anchor does not count as read', () => {
      expect(adapter.decode('area_of_focus', pageFor('area_of_focus')).readings.standard).toEqual({
        state: 'unread',
        carrier: 'GBrain anchor of this record',
      });
    });
  });

  describe('the binding names an unusable property', () => {
    it('the page has no property with that id', () => {
      const page = without(pageFor('task'), TASK_STATUS_SPELLED);

      expect(() => adapter.decode('task', page)).toThrow(AdapterConfigurationError);
    });

    it('lists all unusable slots in one pass', () => {
      const page = without(pageFor('task'), 'title', 'r_task_project');

      expect(misbound(() => adapter.decode('task', page)).map(({ slot }) => slot)).toEqual([
        'task.name',
        'task.project',
      ]);
    });

    it('the slot is bound as a relation, and the property is not a relation', () => {
      const page = pageFor('task', { r_task_project: dateProperty('r_task_project', DATE) });

      expect(() => adapter.decode('task', page)).toThrow(/binds this slot as a relation/);
    });

    it('a property of this type carries no canonical value', () => {
      const page = pageFor('task', { title: { id: 'title', type: 'checkbox', checkbox: false } });

      expect(() => adapter.decode('task', page)).toThrow(
        /a checkbox property carries no canonical value/,
      );
    });

    it('an option property without a bound set of option ids', () => {
      const page = pageFor('task', { title: optionProperty('title', 'opt_any', 'Any') });

      expect(() => adapter.decode('task', page)).toThrow(/needs a bound option set/);
    });
  });

  it('there are eight canonical types, and statuses are not among them', () => {
    expect(Object.keys(VALID_BINDING_FILE.fields)).toEqual([
      'identity',
      'area_of_focus',
      'objective',
      'key_result',
      'project',
      'behavior_system',
      'task',
      'inbox_item',
    ]);
  });

  it('the creation time is read as a canonical date', () => {
    const page = pageFor('inbox_item', {
      p_inbox_item_captured_at: {
        id: 'p_inbox_item_captured_at',
        type: 'created_time',
        created_time: '2026-09-22T08:00:00.000Z',
      },
    });

    expect(adapter.decode('inbox_item', page).readings.captured_at).toEqual({
      state: 'value',
      value: { type: 'date', start: '2026-09-22T08:00:00.000Z', end: null, timeZone: null },
    });
  });
});

/**
 * A binding with an ID written raw and REST returning the same ID encoded must still match,
 * because both sides are converted once, on the way in. The test catches a decoding that would
 * compare spellings and reject a binding written raw as `configuration_error`, although the gate
 * and the binding check let it through.
 */
describe('SemanticAdapter — a binding written raw', () => {
  it('reads a page on which REST returned the same ID encoded', async () => {
    const raw: BindingFile = {
      ...VALID_BINDING_FILE,
      fields: {
        ...VALID_BINDING_FILE.fields,
        task: {
          ...VALID_BINDING_FILE.fields.task,
          status: { kind: 'native', propertyId: 'p_task{status' },
        },
      },
    };
    const adapter = await adapterWith(raw);

    expect(adapter.decode('task', pageFor('task')).readings.status.state).toBe('value');
  });
});

describe('SemanticAdapter — properties whose change is visible in an event', () => {
  /**
   * Only property carriers are comparable with an event. The page body has no ID, and a
   * traversal's ID is not its own: it is that of the relation being followed, not of the
   * semantic's carrier.
   */
  it('a traversal and the page body do not become watched', async () => {
    const adapter = await adapterWith();
    const watched = adapter.watchedPropertyIds([
      'task.status',
      'objective.supporting_projects',
      'identity.meaning',
    ]);

    expect([...watched.ids]).toEqual([TASK_STATUS_ID]);
    expect(watched.unwatchable).toEqual(['objective.supporting_projects', 'identity.meaning']);
  });
});

describe('SemanticAdapter — workspace computations', () => {
  let adapter: SemanticAdapter;

  beforeEach(async () => {
    adapter = await adapterWith();
  });

  it('signals are separate from the canonical readings', () => {
    const record = adapter.decode('task', pageFor('task'));

    expect(Object.keys(record.signals).sort()).toEqual(['blocked', 'effective_areas_of_focus']);
    expect(record.readings).not.toHaveProperty('blocked');
  });

  it('only the signals that exist are bound; the rest are simply absent', () => {
    const record = adapter.decode('project', pageFor('project'));

    expect(Object.keys(record.signals)).toEqual(['blocked']);
  });

  it('a type without signals yields an empty set, not a missing field', () => {
    expect(adapter.decode('identity', pageFor('identity')).signals).toEqual({});
  });

  it('a numeric formula is read as a number', () => {
    const record = adapter.decode('behavior_system', pageFor('behavior_system'));

    expect(record.signals.streak).toEqual({ state: 'value', value: { type: 'number', number: 3 } });
  });

  /**
   * The workspace decides the property type: a signal that is a rollup there reads the same way.
   */
  it('a rollup is read as a number', () => {
    const record = adapter.decode(
      'project',
      pageFor('project', { f_project_blocked: numberRollup('f_project_blocked', 1) }),
    );

    expect(record.signals.blocked).toEqual({
      state: 'value',
      value: { type: 'number', number: 1 },
    });
  });

  it('an empty formula yields `empty`, not zero', () => {
    const page = pageFor('behavior_system', {
      f_behavior_system_streak: numberFormula('f_behavior_system_streak', null),
    });

    expect(adapter.decode('behavior_system', page).signals.streak).toEqual({ state: 'empty' });
  });

  it('a bound signal without a property on the page is a binding error', () => {
    const page = without(pageFor('task'), 'f_task%3Fblocked');

    expect(misbound(() => adapter.decode('task', page))).toEqual([
      // Worded as in the binding file, because that is the file the person will fix.
      expect.objectContaining({ slot: 'task.blocked', named: 'f_task%3Fblocked' }),
    ]);
  });

  it('the time of the last edit is returned as is: the time since attention is measured from it', () => {
    expect(adapter.decode('task', pageFor('task')).lastEditedAt).toBe(LAST_EDITED);
  });
});

/**
 * The encoding of a system write mirrors reading: the same representation kind, the same option
 * set, the physical type from the live schema.
 */
describe('SemanticAdapter: writing', () => {
  let adapter: SemanticAdapter;

  beforeEach(async () => {
    adapter = await adapterWith();
  });

  /** The live schema of the fixture's task database: these properties are in it. */
  const TASK_TYPES: PhysicalTypes = new Map([
    [propertyIdFromCanonical('title'), 'title'],
    [TASK_STATUS_ID, 'status'],
    [propertyIdFromCanonical('p_task_date'), 'date'],
    [propertyIdFromCanonical('p_task_deadline'), 'date'],
    [propertyIdFromCanonical('r_task_project'), 'relation'],
    [propertyIdFromCanonical('f_task_areas'), 'formula'],
  ]);

  const write = (request: unknown): CanonicalWrite => canonicalWriteSchema.parse(request);

  it('encodes the Task fields by the binding id and the live schema type', () => {
    const encoded = adapter.encode(
      'task',
      {
        name: write({ kind: 'text', text: 'Подзвонити в банк' }),
        status: write({ kind: 'option', option: 'Scheduled' }),
        date: write({ kind: 'date', start: '2026-10-01' }),
        project: write({ kind: 'links', pageIds: ['project-1'] }),
      },
      TASK_TYPES,
    );
    const expected: PropertyWrites = {
      title: { title: [{ type: 'text', text: { content: 'Подзвонити в банк' } }] },
      [TASK_STATUS_SPELLED]: { status: { id: 'opt_scheduled' } },
      p_task_date: { date: { start: '2026-10-01', end: null, time_zone: null } },
      r_task_project: { relation: [{ id: 'project-1' }] },
    };

    expect(encoded).toEqual(expected);
  });

  it('a carrier without a property cannot be written', () => {
    expect(() =>
      adapter.encode('task', { result_or_note: write({ kind: 'text', text: 'x' }) }, TASK_TYPES),
    ).toThrow('a page_body carrier cannot be written');
  });

  /**
   * The binding names a property the live schema does not know, which is drift, not a request
   * refusal.
   */
  it('a property missing from the live schema is a binding error', () => {
    expect(() => adapter.encode('task', { deadline: write({ kind: 'clear' }) }, new Map())).toThrow(
      AdapterConfigurationError,
    );
  });

  /** The fixture's Task page, which is in the task data source. */
  const TASK: Page = taskWithStatus('opt_next_action', 'Next Action');
  const DONE: CanonicalWrite = write({ kind: 'option', option: 'Done' });

  it('a write to an existing page uses the field of its type and the physical type from the page', () => {
    const expected: PropertyWrites = {
      [TASK_STATUS_SPELLED]: { status: { id: 'opt_done' } },
      p_task_date: { date: { start: '2026-10-01', end: null, time_zone: null } },
    };

    expect(
      adapter.encodeOn(
        TASK,
        new Map([
          [TASK_STATUS_ID, DONE],
          [propertyIdFromCanonical('p_task_date'), write({ kind: 'date', start: '2026-10-01' })],
        ]),
      ),
    ).toEqual(expected);
  });

  /**
   * The field is determined by the page type, not by the property id: `title` is in every data
   * source, and ids from different data sources can coincide. A Task status on an Identity page
   * is not a field.
   */
  it('a property of another type is not written to the page', () => {
    expect(() => adapter.encodeOn(pageFor('identity'), new Map([[TASK_STATUS_ID, DONE]]))).toThrow(
      `identity ${TASK_STATUS_ID}: the property carries no canonical field of this type`,
    );
  });

  it('a page outside the data sources of canonical types is not written', () => {
    const writes = new Map([[TASK_STATUS_ID, DONE]]);

    expect(() => adapter.encodeOn({ ...TASK, dataSourceId: null }, writes)).toThrow(
      'page page-1: lies in no data source of a canonical type',
    );
    expect(() => adapter.encodeOn({ ...TASK, dataSourceId: 'ds_elsewhere' }, writes)).toThrow(
      UnwritableValueError,
    );
  });

  /** A signal is computed by the workspace: nothing can be written to it, and it has no field. */
  it('a signal and a property without a canonical home are not written', () => {
    const signal = (): PropertyWrites =>
      adapter.encodeOn(
        TASK,
        new Map([[propertyIdFromCanonical('f_task_areas'), write({ kind: 'text', text: 'x' })]]),
      );

    expect(signal).toThrow(UnwritableValueError);
  });

  it('what was written is read back as the field of the page type', () => {
    const expected: Reading = { state: 'value', value: { type: 'option', option: 'Done' } };

    expect(adapter.readBack(taskWithStatus('opt_done', 'Done'), TASK_STATUS_ID)).toEqual(expected);
  });

  it('the data source of a type is the one in the binding', () => {
    expect(adapter.dataSourceOf('task')).toBe(VALID_BINDING_FILE.data_sources.task);
  });

  /**
   * `INV-005`: `Next Action` has no planned date, whether this request writes it or it is already
   * on the page. The rule checks the result of the write, not a single field of the request.
   * The refusal names the reason: with both halves in the request, the request is unacceptable in
   * any state (`UnwritableValueError`); with one half taken from the page, it is unacceptable for
   * that page (`UnwritableOnPageError`).
   */
  describe('Next Action has no planned date', () => {
    const DATE_ID = propertyIdFromCanonical('p_task_date');
    const DEADLINE_ID = propertyIdFromCanonical('p_task_deadline');
    const TITLE_ID = propertyIdFromCanonical('title');
    const NEXT_ACTION = write({ kind: 'option', option: 'Next Action' });
    const SCHEDULED = write({ kind: 'option', option: 'Scheduled' });
    const PLANNED = write({ kind: 'date', start: '2026-10-01' });
    const CLEAR = write({ kind: 'clear' });

    /** Returns a Task with a status, with or without a date: the fixture has a date by default. */
    const taskPage = (optionId: string, name: string, dated: boolean): Page =>
      pageFor('task', {
        [TASK_STATUS_SPELLED]: optionProperty(TASK_STATUS_SPELLED, optionId, name),
        p_task_date: dateProperty('p_task_date', dated ? DATE : null),
      });

    const WAITING_DATED = taskPage('opt_waiting_for', 'Waiting For', true);
    const WAITING_BARE = taskPage('opt_waiting_for', 'Waiting For', false);
    const NEXT_DATED = taskPage('opt_next_action', 'Next Action', true);
    const NEXT_BARE = taskPage('opt_next_action', 'Next Action', false);

    describe('a half from the page is a page refusal', () => {
      it('a status move to Next Action on a Task that keeps its date', () => {
        const refusal = (): unknown =>
          adapter.encodeOn(WAITING_DATED, new Map([[TASK_STATUS_ID, NEXT_ACTION]]));

        expect(refusal).toThrow(UnwritableOnPageError);
        expect(refusal).toThrow('the task still carries a planned date');
      });

      it('a planned date on Next Action', () => {
        const refusal = (): unknown => adapter.encodeOn(NEXT_BARE, new Map([[DATE_ID, PLANNED]]));

        expect(refusal).toThrow(UnwritableOnPageError);
        expect(refusal).toThrow('a planned date makes the task Scheduled');
      });
    });

    describe('both halves in the request are a request refusal', () => {
      const BOTH = new Map([
        [TASK_STATUS_ID, NEXT_ACTION],
        [DATE_ID, PLANNED],
      ]);

      it.each([
        ['an existing page', WAITING_BARE],
        ['an existing page that already has a date', NEXT_DATED],
      ])('%s', (_, page) => {
        expect(() => adapter.encodeOn(page, BOTH)).toThrow(UnwritableValueError);
        expect(() => adapter.encodeOn(page, BOTH)).toThrow('choose Scheduled or drop the date');
      });

      it('a new page: the status and the date are considered together', () => {
        expect(() =>
          adapter.encode('task', { status: NEXT_ACTION, date: PLANNED }, TASK_TYPES),
        ).toThrow(UnwritableValueError);
        expect(() => adapter.encode('task', { status: NEXT_ACTION }, TASK_TYPES)).not.toThrow();
      });

      it('a new page with a date and no status: the status is unknown, so the rule cannot stay silent', () => {
        const refusal = (): unknown => adapter.encode('task', { date: PLANNED }, TASK_TYPES);

        expect(refusal).toThrow(UnwritableValueError);
        expect(refusal).toThrow('names its status');
      });
    });

    describe('a write that agrees with the page passes', () => {
      it('a move together with clearing the date', () => {
        expect(() =>
          adapter.encodeOn(
            WAITING_DATED,
            new Map([
              [TASK_STATUS_ID, NEXT_ACTION],
              [DATE_ID, CLEAR],
            ]),
          ),
        ).not.toThrow();
      });

      it('a Task without a date moves into Next Action freely', () => {
        expect(() =>
          adapter.encodeOn(WAITING_BARE, new Map([[TASK_STATUS_ID, NEXT_ACTION]])),
        ).not.toThrow();
      });

      it('a move into Scheduled does not touch the date', () => {
        expect(() =>
          adapter.encodeOn(WAITING_DATED, new Map([[TASK_STATUS_ID, SCHEDULED]])),
        ).not.toThrow();
      });

      it('clearing the date on Next Action', () => {
        expect(() => adapter.encodeOn(NEXT_DATED, new Map([[DATE_ID, CLEAR]]))).not.toThrow();
      });

      it('a date on a page whose status is not Next Action', () => {
        expect(() => adapter.encodeOn(WAITING_BARE, new Map([[DATE_ID, PLANNED]]))).not.toThrow();
      });

      /**
       * An old page on which the person left a date on `Next Action` in Notion itself does not
       * become unwritable: the rule concerns writing a status or a date, not any write.
       */
      it('writing the name or the deadline on a Next Action page that has a date is not blocked', () => {
        expect(() =>
          adapter.encodeOn(
            NEXT_DATED,
            new Map([[TITLE_ID, write({ kind: 'text', text: 'нова назва' })]]),
          ),
        ).not.toThrow();
        expect(() =>
          adapter.encodeOn(
            NEXT_DATED,
            new Map([[DEADLINE_ID, write({ kind: 'date', start: '2026-10-09' })]]),
          ),
        ).not.toThrow();
      });
    });

    /**
     * A slot on which the answer depends and which cannot be read is a configuration refusal, not
     * “there is no date”; a slot on which the answer does not depend does not get in the way of
     * the write.
     */
    describe('a slot that cannot be read', () => {
      const NO_DATE = without(WAITING_BARE, 'p_task_date');
      const NO_STATUS = without(NEXT_BARE, TASK_STATUS_SPELLED);

      it('a date the answer needs has vanished from the page: a configuration refusal', () => {
        expect(() => adapter.encodeOn(NO_DATE, new Map([[TASK_STATUS_ID, NEXT_ACTION]]))).toThrow(
          AdapterConfigurationError,
        );
      });

      it('a status the answer needs has vanished from the page: a configuration refusal', () => {
        expect(() => adapter.encodeOn(NO_STATUS, new Map([[DATE_ID, PLANNED]]))).toThrow(
          AdapterConfigurationError,
        );
      });

      it('a request that removes one of the halves does not ask the page', () => {
        expect(() => adapter.encodeOn(NO_STATUS, new Map([[DATE_ID, CLEAR]]))).not.toThrow();
        expect(() =>
          adapter.encodeOn(NO_DATE, new Map([[TASK_STATUS_ID, SCHEDULED]])),
        ).not.toThrow();
      });
    });
  });

  /** One field of a page is read without the rest of the record. */
  describe('readField', () => {
    it('reads a value and an empty field', () => {
      const page = pageFor('task', {
        [TASK_STATUS_SPELLED]: optionProperty(TASK_STATUS_SPELLED, 'opt_done', 'Done'),
        p_task_date: dateProperty('p_task_date', null),
      });

      expect(adapter.readField('task', page, 'status')).toEqual({
        state: 'value',
        value: { type: 'option', option: 'Done' },
      });
      expect(adapter.readField('task', page, 'date')).toEqual({ state: 'empty' });
    });

    it('a slot the page does not carry is a configuration refusal, and the rest of the record is not asked', () => {
      const page = without(taskWithStatus('opt_done', 'Done'), 'p_task_date');

      expect(() => adapter.readField('task', page, 'date')).toThrow(AdapterConfigurationError);
      expect(adapter.readField('task', page, 'status').state).toBe('value');
    });

    it('reads what `decode` reads', () => {
      const page = taskWithStatus('opt_scheduled', 'Scheduled');

      expect(adapter.readField('task', page, 'status')).toEqual(
        adapter.decode('task', page).readings.status,
      );
    });
  });
});

/**
 * In the proposal's trail in the thread, a change is worded the way the person sees it: with the
 * property name and the option name that the workspace currently shows (ADR 0043), not the
 * canonical id.
 */
describe('SemanticAdapter — a change as the workspace shows it', () => {
  const DATE_ID = propertyIdFromCanonical('p_task_date');
  const live: ReadonlyMap<PropertyId, LiveProperty> = new Map([
    [
      TASK_STATUS_ID,
      {
        type: 'status',
        name: 'Статус',
        options: ['opt_done'],
        optionNames: new Map([['opt_done', 'Готово']]),
      },
    ],
    [DATE_ID, { type: 'date', name: 'Дата' }],
  ]);

  it('shows an option by its name from the workspace and a cleared date as a clearing', async () => {
    const adapter = await adapterWith();
    const writes = new Map<PropertyId, CanonicalWrite>([
      [TASK_STATUS_ID, { kind: 'option', option: 'Done' }],
      [DATE_ID, { kind: 'clear' }],
    ]);
    const expected: ShownChange[] = [
      { field: 'Статус', canonical: 'status', value: { kind: 'option', name: 'Готово' } },
      { field: 'Дата', canonical: 'date', value: { kind: 'clear' } },
    ];

    expect(adapter.shownOn(taskWithStatus('opt_next_action', 'Next Action'), live, writes)).toEqual(
      expected,
    );
  });

  it('an option the workspace did not name is shown by its canonical name', async () => {
    const adapter = await adapterWith();
    const writes = new Map<PropertyId, CanonicalWrite>([
      [TASK_STATUS_ID, { kind: 'option', option: 'Canceled' }],
    ]);
    const expected: ShownChange[] = [
      { field: 'Статус', canonical: 'status', value: { kind: 'option', name: 'Canceled' } },
    ];

    expect(adapter.shownOn(taskWithStatus('opt_next_action', 'Next Action'), live, writes)).toEqual(
      expected,
    );
  });
});
