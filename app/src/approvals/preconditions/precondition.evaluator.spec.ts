import { Test } from '@nestjs/testing';
import { APIErrorCode, RequestTimeoutError } from '@notionhq/client';
import { notionAnswer } from '../../../test/fixtures/notion-answer.fixture';
import { TASK_STATUS_ID } from '../../../test/fixtures/notion-mapping.fixture';
import {
  dateProperty,
  LAST_EDITED,
  numberFormula,
  optionProperty,
  relationProperty,
  taskWithStatus,
} from '../../../test/fixtures/notion-page.fixture';
import { bindingProvider } from '../../../test/fixtures/test-module';
import { NotionAccessError } from '../../notion/client/notion.error';
import { canonicalPage, Page, RestProperty } from '../../notion/client/page';
import { PageReader } from '../../notion/client/page.reader';
import { propertyIdFromCanonical as id } from '../../notion/client/property-id';
import { SemanticAdapter } from '../../notion/semantics/semantic.adapter';
import { Precondition } from './precondition';
import { FailedVerdict, PreconditionEvaluator, Verdict } from './precondition.evaluator';

const PAGE_ID = 'page-1';
/** Canonical: the way the model supplies it, from the trigger envelope or `get_schema_mapping`. */
const STATUS_ID = TASK_STATUS_ID;

/** Returns a page with additional properties from REST, translated the same way as at reading. */
function withRest(page: Page, ...properties: RestProperty[]): Page {
  const extra = canonicalPage({
    in_trash: false,
    parent: { type: 'workspace', workspace: true },
    id: page.id,
    last_edited_time: page.last_edited_time,
    properties: Object.fromEntries(properties.map((property) => [property.id, property])),
  });

  return { ...page, properties: new Map([...page.properties, ...extra.properties]) };
}
const NEXT_ACTION = 'option_next_action';

class FakePages {
  page: Page | Error = taskWithStatus(NEXT_ACTION, 'Next Action');
  reads = 0;

  read(): Promise<Page> {
    this.reads += 1;

    if (this.page instanceof Error) return Promise.reject(this.page);

    return Promise.resolve(this.page);
  }
}

describe('revalidation of preconditions', () => {
  let pages: FakePages;
  let evaluator: PreconditionEvaluator;

  beforeEach(async () => {
    pages = new FakePages();

    const reader: Pick<PageReader, 'page'> = { page: () => pages.read() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PreconditionEvaluator,
        SemanticAdapter,
        bindingProvider(),
        { provide: PageReader, useValue: reader },
      ],
    }).compile();

    evaluator = moduleRef.get(PreconditionEvaluator);
  });

  const exists: Precondition = { kind: 'page_exists', pageId: PAGE_ID };

  it('an existing page satisfies `page_exists`', async () => {
    await expect(evaluator.evaluate(PAGE_ID, [exists])).resolves.toMatchObject({
      outcome: 'holds',
    });
  });

  /**
   * Lost access to the content is not a change of state, so this is `degraded`: the action stays
   * approved and will wait for access, just as it waits out a temporarily unresponsive Notion.
   * This test catches a `broken` verdict, which means `conflict`: terminal, with advice to the
   * model to compose a new proposal that would hit the same wall of permissions. The person's
   * approval would be spent on a diagnosis that has nothing to do with the domain.
   */
  it('lost access to a page is a degradation, not a change of state', async () => {
    pages.page = new NotionAccessError(`page ${PAGE_ID}`, 'archived');

    const verdict = await evaluator.evaluate(PAGE_ID, [exists]);

    expect(verdict.outcome).toBe('degraded');
  });

  /**
   * A rate limit, a server failure and a timeout say nothing about the domain, so they are also
   * `degraded`: the approval stands and waits for Notion. An error that propagated from here
   * would stop the executor's tick at the very first action that hit it. Nothing behind that
   * action would be executed on any tick, one every 15 seconds, with no time set for the next
   * attempt.
   */
  const unavailable: [string, Error][] = [
    ['rate limit', notionAnswer(APIErrorCode.RateLimited, 429)],
    ['server failure', notionAnswer(APIErrorCode.InternalServerError, 500)],
    ['service unavailable', notionAnswer(APIErrorCode.ServiceUnavailable, 503)],
    ['request timeout', new RequestTimeoutError()],
  ];

  it.each(unavailable)('%s is a degradation, not an exception', async (_, error) => {
    pages.page = error;

    const verdict = await evaluator.evaluate(PAGE_ID, [exists]);

    expect(verdict.outcome).toBe('degraded');
  });

  /**
   * A request or code defect is not unavailability: hiding it in `degraded` would mean staying
   * silent about it.
   */
  const defects: [string, Error][] = [
    ['rejected request', notionAnswer(APIErrorCode.ValidationError, 400)],
    ['code defect', new TypeError('defect')],
  ];

  it.each(defects)('%s propagates', async (_, error) => {
    pages.page = error;

    await expect(evaluator.evaluate(PAGE_ID, [exists])).rejects.toBe(error);
  });

  /**
   * A vanished page, though, really is gone, and that is the change of state that made the
   * action stop being correct.
   */
  it('a vanished page breaks the precondition', async () => {
    pages.page = notionAnswer(APIErrorCode.ObjectNotFound, 404);

    const verdict = await evaluator.evaluate(PAGE_ID, [exists]);

    expect(verdict.outcome).toBe('broken');
  });

  /** The write is encoded on the same state that was checked, not on one read a second time. */
  it('the preconditions hold, and the page for the write is the one that was checked', async () => {
    const page = taskWithStatus(NEXT_ACTION, 'Next Action');

    pages.page = page;

    const expected: Verdict = { outcome: 'holds', subject: page };

    await expect(
      evaluator.evaluate(PAGE_ID, [
        { kind: 'property_equals', pageId: PAGE_ID, propertyId: STATUS_ID, optionId: NEXT_ACTION },
      ]),
    ).resolves.toEqual(expected);
    expect(pages.reads).toBe(1);
  });

  /**
   * Writing to a page presupposes that it exists and is not in the trash: this precondition is
   * implicit in every proposal.
   */
  it('the target page in the trash breaks the check without preconditions about it', async () => {
    pages.page = { ...taskWithStatus(NEXT_ACTION, 'Next Action'), inTrash: true };

    const expected: FailedVerdict = {
      outcome: 'broken',
      failed: { kind: 'page_exists', pageId: PAGE_ID },
      detail: 'page is in the trash',
    };

    await expect(evaluator.evaluate(PAGE_ID, [])).resolves.toEqual(expected);
  });

  it('the page is read once for all preconditions about it', async () => {
    await evaluator.evaluate(PAGE_ID, [
      exists,
      { kind: 'property_equals', pageId: PAGE_ID, propertyId: STATUS_ID, optionId: NEXT_ACTION },
      { kind: 'unchanged_since', pageId: PAGE_ID, lastEditedTime: LAST_EDITED },
    ]);

    expect(pages.reads).toBe(1);
  });

  describe('property_equals', () => {
    const wants = (optionId: string): Precondition => ({
      kind: 'property_equals',
      pageId: PAGE_ID,
      propertyId: STATUS_ID,
      optionId,
    });

    it('the same option satisfies the precondition', async () => {
      await expect(evaluator.evaluate(PAGE_ID, [wants(NEXT_ACTION)])).resolves.toMatchObject({
        outcome: 'holds',
      });
    });

    /** This case turns a repeated execution into `conflict`, not into a second write. */
    it('a changed option breaks the precondition', async () => {
      pages.page = taskWithStatus('option_done', 'Done');

      const verdict = await evaluator.evaluate(PAGE_ID, [wants(NEXT_ACTION)]);

      expect(verdict.outcome).toBe('broken');
    });

    /**
     * REST returns the ID encoded, while the precondition has the canonical one, as the model
     * composed it.
     */
    it('a REST id in the Notion form matches the canonical id of the precondition', async () => {
      pages.page = withRest(
        taskWithStatus(NEXT_ACTION, 'Next Action'),
        optionProperty('K%7BhG', NEXT_ACTION, 'Next Action'),
      );

      await expect(
        evaluator.evaluate(PAGE_ID, [
          {
            kind: 'property_equals',
            pageId: PAGE_ID,
            propertyId: id('K{hG'),
            optionId: NEXT_ACTION,
          },
        ]),
      ).resolves.toMatchObject({ outcome: 'holds' });
    });

    it('a date is not a question `property_equals` can answer', async () => {
      const page = taskWithStatus(NEXT_ACTION, 'Next Action');

      pages.page = withRest(page, dateProperty('p_date', '2026-09-25'));

      const verdict = await evaluator.evaluate(PAGE_ID, [
        {
          kind: 'property_equals',
          pageId: PAGE_ID,
          propertyId: id('p_date'),
          optionId: NEXT_ACTION,
        },
      ]);

      expect(verdict.outcome).toBe('undecidable');
      expect(verdict.outcome !== 'holds' && verdict.detail).toContain('option ids');
    });

    it('a missing property breaks the precondition', async () => {
      const verdict = await evaluator.evaluate(PAGE_ID, [
        {
          kind: 'property_equals',
          pageId: PAGE_ID,
          propertyId: id('p_absent'),
          optionId: NEXT_ACTION,
        },
      ]);

      expect(verdict.outcome).toBe('broken');
    });
  });

  describe('property_empty', () => {
    const empty = (propertyId: string): Precondition => ({
      kind: 'property_empty',
      pageId: PAGE_ID,
      propertyId: id(propertyId),
    });

    it('an empty date satisfies the precondition', async () => {
      const page = taskWithStatus(NEXT_ACTION, 'Next Action');

      pages.page = withRest(page, dateProperty('p_date', null));

      await expect(evaluator.evaluate(PAGE_ID, [empty('p_date')])).resolves.toMatchObject({
        outcome: 'holds',
      });
    });

    it('a filled date breaks the precondition', async () => {
      const page = taskWithStatus(NEXT_ACTION, 'Next Action');

      pages.page = withRest(page, dateProperty('p_date', '2026-09-25'));

      const verdict = await evaluator.evaluate(PAGE_ID, [empty('p_date')]);

      expect(verdict.outcome).toBe('broken');
    });

    /**
     * Nobody fills in a computed property, so “empty” and “not empty” are equally groundless
     * for it. This test catches a `default` that would say “not empty”: along with computed
     * properties, `url`, `email`, `phone_number` and `files` would fall there, and these are the
     * very ones a person fills in by hand.
     */
    it('a computed property is not a question about emptiness', async () => {
      const page = taskWithStatus(NEXT_ACTION, 'Next Action');

      pages.page = withRest(page, numberFormula('p_formula', 3));

      const verdict = await evaluator.evaluate(PAGE_ID, [empty('p_formula')]);

      expect(verdict.outcome).toBe('undecidable');
    });

    it('an empty relation satisfies the precondition', async () => {
      const page = taskWithStatus(NEXT_ACTION, 'Next Action');

      pages.page = withRest(page, relationProperty('r_project', []));

      await expect(evaluator.evaluate(PAGE_ID, [empty('r_project')])).resolves.toMatchObject({
        outcome: 'holds',
      });
    });
  });

  /**
   * A precondition about the value the property currently reads as, in canonical form, by the
   * same reading the adapter uses to check every write. It is written by whoever changes a filled
   * date, text or relations.
   */
  describe('property_reads_as', () => {
    const DATE_ID = 'p_task_date';
    const readsAsDate = (start: string, propertyId = DATE_ID): Precondition => ({
      kind: 'property_reads_as',
      pageId: PAGE_ID,
      propertyId: id(propertyId),
      value: { kind: 'date', start, end: null },
    });

    const withDate = (start: string | null, timeZone: string | null = null): Page =>
      withRest(taskWithStatus(NEXT_ACTION, 'Next Action'), dateProperty(DATE_ID, start, timeZone));

    it('a date that reads as named satisfies the precondition', async () => {
      pages.page = withDate('2026-09-25');

      await expect(evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25')])).resolves.toMatchObject(
        { outcome: 'holds' },
      );
    });

    /**
     * An instant is compared as an instant, not as a string: Notion returns it in its own
     * spelling.
     */
    it('the same instant in a different spelling satisfies the precondition', async () => {
      pages.page = withDate('2026-09-25T09:00:00.000+03:00');

      await expect(
        evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25T06:00:00.000Z')]),
      ).resolves.toMatchObject({ outcome: 'holds' });
    });

    /**
     * The time zone the person set on a date in Notion is an annotation of the instant: a
     * precondition about state compares the instant. Otherwise nothing could observe a second
     * “clear the date” effect for a Task whose date has a time zone.
     */
    it('a time zone on a date with an offset does not change the instant', async () => {
      pages.page = withDate('2026-09-25T09:00:00.000+03:00', 'Europe/Kyiv');

      await expect(
        evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25T06:00:00.000Z')]),
      ).resolves.toMatchObject({ outcome: 'holds' });
      await expect(
        evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25T07:00:00.000Z')]),
      ).resolves.toMatchObject({ outcome: 'broken' });
    });

    /**
     * The host clock cannot read an instant without an offset: a precondition about it does not
     * hold, whatever time zone the host is in.
     */
    it('the instant of a zoned date without an offset cannot be placed in time', async () => {
      const local = '2026-09-25T09:00:00';

      pages.page = withDate(local, 'Europe/Kyiv');

      await expect(
        evaluator.evaluate(PAGE_ID, [readsAsDate(new Date(local).toISOString())]),
      ).resolves.toMatchObject({ outcome: 'broken' });
    });

    it('a different value breaks the precondition', async () => {
      pages.page = withDate('2026-10-01');

      const verdict = await evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25')]);

      expect(verdict.outcome).toBe('broken');
    });

    it('a cleared property reads as `empty`, not as the named value', async () => {
      pages.page = withDate(null);

      const verdict = await evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25')]);

      expect(verdict.outcome).toBe('broken');
    });

    it('a missing property breaks the precondition', async () => {
      const verdict = await evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25', 'p_gone')]);

      expect(verdict.outcome).toBe('broken');
    });

    /**
     * A property that has no canonical field cannot be read as a canonical value by anything:
     * this is an authoring defect, not a defect of state, and a new proposal would hit the same
     * wall.
     */
    it('a property without a canonical field is `undecidable`', async () => {
      pages.page = withRest(
        taskWithStatus(NEXT_ACTION, 'Next Action'),
        dateProperty('p_stranger', '2026-09-25'),
      );

      const verdict = await evaluator.evaluate(PAGE_ID, [readsAsDate('2026-09-25', 'p_stranger')]);

      expect(verdict.outcome).toBe('undecidable');
    });
  });

  describe('unchanged_since', () => {
    it('the same edit time satisfies the precondition', async () => {
      await expect(
        evaluator.evaluate(PAGE_ID, [
          { kind: 'unchanged_since', pageId: PAGE_ID, lastEditedTime: LAST_EDITED },
        ]),
      ).resolves.toMatchObject({ outcome: 'holds' });
    });

    /**
     * `unchanged_since` reacts to any edit of the page by someone else, and the corpus states this
     * as its cost.
     */
    it('any edit of the page breaks the precondition', async () => {
      const verdict = await evaluator.evaluate(PAGE_ID, [
        { kind: 'unchanged_since', pageId: PAGE_ID, lastEditedTime: '2026-01-01T00:00:00.000Z' },
      ]);

      expect(verdict.outcome).toBe('broken');
    });
  });

  it('the first broken precondition stops the check', async () => {
    const verdict = await evaluator.evaluate(PAGE_ID, [
      { kind: 'unchanged_since', pageId: PAGE_ID, lastEditedTime: 'колись' },
      { kind: 'property_equals', pageId: PAGE_ID, propertyId: STATUS_ID, optionId: NEXT_ACTION },
    ]);

    expect(verdict.outcome).toBe('broken');
    expect(verdict.outcome !== 'holds' && verdict.failed.kind).toBe('unchanged_since');
  });
});
